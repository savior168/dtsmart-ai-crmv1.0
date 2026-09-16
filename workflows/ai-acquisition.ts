import { sleep } from "workflow";
import { start } from "workflow/api";
import { createAdminClient } from "../lib/supabase/admin";
import { aiScreeningWorkflow } from "./ai-screening";
import { discoverBusinesses, discoveryCandidateLooksRelevant, type DiscoveredBusiness } from "../lib/ai-acquisition/discovery";
import type { AcquisitionCountry } from "../lib/ai-acquisition/config";
import { evaluateAcquisitionGate } from "../lib/ai-acquisition/quality-gate";

type AcquisitionTask = {
  id: string; user_id: string; task_number: string; name: string; cost_mode: "FREE_ONLY" | "ADAPTIVE";
  countries: AcquisitionCountry[]; industry: string; industries?: string[]; keywords: string[]; excluded_keywords: string[];
  target_count: number; discovered_count: number; task_cost_limit_usd: number | null; status: string; cancel_requested: boolean;
};

async function readTask(taskId: string) {
  "use step";
  const result = await createAdminClient().from("ai_acquisition_tasks").select("*").eq("id", taskId).single();
  if (result.error || !result.data) throw result.error || new Error("ACQUISITION_TASK_NOT_FOUND");
  return result.data as AcquisitionTask;
}

async function beginTask(taskId: string) {
  "use step";
  const now = new Date().toISOString();
  const result = await createAdminClient().from("ai_acquisition_tasks").update({ status: "RUNNING", current_stage:"DISCOVERY", current_stage_detail:"正在按国家和本地化检索表达发现目标商家", active_executor: "VERCEL_WORKFLOW", started_at: now, executor_heartbeat_at: now, last_dispatch_at: now, error_message: null, updated_at: now }).eq("id", taskId).in("status", ["QUEUED", "RUNNING"]);
  if (result.error) throw result.error;
}

async function createScreeningTask(task: AcquisitionTask) {
  "use step";
  const admin = createAdminClient();
  const existing = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${task.id}`).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return String(existing.data.id);
  const inserted = await admin.from("ai_screening_tasks").insert({
    user_id: task.user_id, task_number: `${task.task_number}-VERIFY`, name: `${task.name} · 获客核验`, strategy: "SMART", strategy_version: "1.0",
    status: "QUEUED", total_count: 0, pending_count: 0, selection_mode: "FILTERED",
    filters: { service: "AI_ACQUISITION", acquisition_task_id: task.id, force_fresh_analysis: true }, request_key: `acquisition:${task.id}`,
    cost_mode: task.cost_mode, task_cost_limit_usd: task.task_cost_limit_usd, execution_mode: "VERCEL_ONLY", dispatch_policy: "VERCEL_ONLY",
    archived_at: new Date().toISOString(),
  }).select("id").single();
  if (inserted.error || !inserted.data) throw inserted.error || new Error("ACQUISITION_SCREENING_TASK_CREATE_FAILED");
  return String(inserted.data.id);
}

async function stageCandidates(task: AcquisitionTask, screeningTaskId: string) {
  "use step";
  const admin = createAdminClient();
  const industries = task.industries?.length ? task.industries : [task.industry];
  // target_count is an internal discovery safety ceiling, not a requested
  // number of successful public-pool imports. The UI intentionally does not
  // ask users to predict how many qualified businesses exist.
  const discoveryCeiling = Math.max(1, task.target_count);
  const perCountry = Math.min(200, Math.max(20, Math.ceil(discoveryCeiling / task.countries.length)));
  const unique = new Map<string, DiscoveredBusiness>();
  let discoveryControl: "PAUSED" | "CANCELLED" | "BUDGET_LIMITED" | null = null;
  for (const country of task.countries) {
    if (unique.size >= discoveryCeiling) break;
    const latest = await readTask(task.id);
    if (latest.cancel_requested) break;
    const discovery = await discoverBusinesses({ acquisitionTaskId: task.id, screeningTaskId, userId: task.user_id, costMode: task.cost_mode, country, industries, keywords: task.keywords, excludedKeywords: task.excluded_keywords, limit: perCountry });
    discovery.businesses.forEach((business) => {
      if (unique.size < discoveryCeiling) unique.set(business.placeId, business);
    });
    if(discovery.control){discoveryControl=discovery.control;break;}
  }
  const stageUpdate=await admin.from("ai_acquisition_tasks").update({current_stage:"DEDUPLICATING",current_stage_detail:"正在保存候选、系统去重并执行非目标早停",executor_heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",task.id).eq("status","RUNNING");
  if(stageUpdate.error)throw stageUpdate.error;
  let candidateIndex=0;
  for (const candidate of unique.values()) {
    candidateIndex+=1;
    if(candidateIndex===1||candidateIndex%20===0){
      const current=await readTask(task.id);
      if(current.cancel_requested){discoveryControl="CANCELLED";break;}
      if(["PAUSING","PAUSED"].includes(current.status)){discoveryControl="PAUSED";break;}
      const heartbeat=await admin.from("ai_acquisition_tasks").update({executor_heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",task.id).eq("status","RUNNING");
      if(heartbeat.error)throw heartbeat.error;
    }
    const already = await admin.from("ai_acquisition_candidates").select("id").eq("task_id", task.id).eq("place_id", candidate.placeId).maybeSingle();
    if (already.error) throw already.error;
    if (already.data) continue;
    const existingCustomer = await admin.from("customers").select("id").eq("google_place_id", candidate.placeId).is("deleted_at", null).limit(1).maybeSingle();
    if (existingCustomer.error) throw existingCustomer.error;
    if (existingCustomer.data) {
      const duplicate = await admin.from("ai_acquisition_candidates").insert({ task_id: task.id, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms, source_snapshot: candidate, decision: "DUPLICATE", decision_reason: "Google Place ID已存在于系统客户资料", imported_customer_id: existingCustomer.data.id, processed_at: new Date().toISOString() });
      if (duplicate.error) throw duplicate.error;
      continue;
    }
    const historyCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const previous = await admin.from("ai_acquisition_candidates").select("id,task_id,decision,processed_at").eq("place_id", candidate.placeId).neq("task_id", task.id).gte("created_at", historyCutoff).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previous.error) throw previous.error;
    if (previous.data) {
      const repeated = await admin.from("ai_acquisition_candidates").insert({
        task_id: task.id, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address,
        google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms,
        source_snapshot: { ...candidate, previous_candidate_id: previous.data.id, previous_task_id: previous.data.task_id, previous_decision: previous.data.decision },
        decision: "DUPLICATE", decision_reason: "近90天已有AI获客核验记录，本次保留检索命中但不重复产生补证费用", processed_at: new Date().toISOString(),
      });
      if (repeated.error) throw repeated.error;
      continue;
    }
    if (candidate.businessStatus === "CLOSED_PERMANENTLY") {
      const closed = await admin.from("ai_acquisition_candidates").insert({ task_id: task.id, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms, source_snapshot: candidate, decision: "REJECTED", decision_reason: "Google 商家明确标记永久停业，已在补证前停止", processed_at: new Date().toISOString() });
      if (closed.error) throw closed.error;
      continue;
    }
    if (!discoveryCandidateLooksRelevant(candidate, industries, task.keywords)) {
      const rejected = await admin.from("ai_acquisition_candidates").insert({ task_id: task.id, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms, source_snapshot: candidate, decision: "REJECTED", decision_reason: "公开商家基础类别与目标行业缺少直接相关信号，已在补证前停止", processed_at: new Date().toISOString() });
      if (rejected.error) throw rejected.error;
      continue;
    }
    const customer = await admin.from("customers").insert({
      company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl,
      google_place_id: candidate.placeId, industry: task.industry, category: task.industry, source: "AI_ACQUISITION_STAGING", source_channel: "GOOGLE_MAPS",
      source_batch: task.task_number, source_reference: task.id, origin_source: "AI_ACQUISITION", status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: task.user_id,
      owner_id: null, owner_user_id: null, acquisition_scope: "PRIVATE", pool_status: "AI_STAGING", assigned_via: null, acquisition_match_keywords: candidate.matchedTerms,
    }).select("id").single();
    if (customer.error || !customer.data) throw customer.error || new Error("ACQUISITION_STAGING_CUSTOMER_FAILED");
    const source = await admin.from("customer_sources").insert({
      customer_id: customer.data.id,
      source_type: "AI_ACQUISITION",
      source_reference: task.id,
      metadata: {
        acquisition_task_id: task.id,
        acquisition_task_number: task.task_number,
        acquisition_task_name: task.name,
        acquisition_user_id: task.user_id,
        discovered_at: new Date().toISOString(),
        source_channel: "GOOGLE_MAPS",
        exact_source_url: candidate.googleUrl,
        source_query: candidate.query,
        matched_search_terms: candidate.matchedTerms,
        country: candidate.country,
        target_industries: industries,
        cost_mode: task.cost_mode,
      },
    });
    if (source.error) throw source.error;
    const item = await admin.from("ai_screening_task_items").insert({ task_id: screeningTaskId, customer_id: customer.data.id, status: "PENDING", strategy: "SMART", strategy_version: "1.0" }).select("id").single();
    if (item.error || !item.data) throw item.error || new Error("ACQUISITION_SCREENING_ITEM_FAILED");
    const row = await admin.from("ai_acquisition_candidates").insert({ task_id: task.id, screening_task_id: screeningTaskId, screening_task_item_id: item.data.id, staging_customer_id: customer.data.id, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms, source_snapshot: candidate, decision: "ANALYZING" });
    if (row.error) throw row.error;
  }
  const counts = await admin.from("ai_acquisition_candidates").select("id,decision").eq("task_id", task.id);
  if (counts.error) throw counts.error;
  const analyzing = (counts.data || []).filter((row) => row.decision === "ANALYZING").length;
  const updatedScreening = await admin.from("ai_screening_tasks").update({ total_count: analyzing, pending_count: analyzing, updated_at: new Date().toISOString() }).eq("id", screeningTaskId);
  if (updatedScreening.error) throw updatedScreening.error;
  const updatedTask = await admin.from("ai_acquisition_tasks").update({ discovered_count: counts.data?.length || 0, updated_at: new Date().toISOString() }).eq("id", task.id);
  if (updatedTask.error) throw updatedTask.error;
  return { analyzing, control: discoveryControl };
}

async function dispatchScreening(screeningTaskId: string) {
  "use step";
  const run = await start(aiScreeningWorkflow, [{ taskId: screeningTaskId, strategy: "SMART", scheduledAt: null }]);
  const update = await createAdminClient().from("ai_screening_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", updated_at: new Date().toISOString() }).eq("id", screeningTaskId);
  if (update.error) throw update.error;
  return run.runId;
}

async function setTaskStage(taskId:string,stage:"VERIFYING"|"FINALIZING",detail:string) {
  "use step";
  const saved=await createAdminClient().from("ai_acquisition_tasks").update({current_stage:stage,current_stage_detail:detail,executor_heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",taskId).eq("status","RUNNING");
  if(saved.error)throw saved.error;
}

async function screeningState(screeningTaskId: string) {
  "use step";
  const result = await createAdminClient().from("ai_screening_tasks").select("status,pending_count,error_message").eq("id", screeningTaskId).single();
  if (result.error || !result.data) throw result.error || new Error("ACQUISITION_SCREENING_STATE_FAILED");
  return result.data as { status: string; pending_count: number; error_message: string | null };
}

async function verificationState(taskId: string, screeningTaskId: string) {
  "use step";
  const admin = createAdminClient();
  const [acquisition, screening] = await Promise.all([
    admin.from("ai_acquisition_tasks").select("status,cancel_requested,started_at,elapsed_ms,pause_started_at,paused_duration_ms").eq("id", taskId).single(),
    admin.from("ai_screening_tasks").select("status,pending_count,error_message").eq("id", screeningTaskId).single(),
  ]);
  if (acquisition.error || !acquisition.data) throw acquisition.error || new Error("ACQUISITION_CONTROL_STATE_FAILED");
  if (screening.error || !screening.data) throw screening.error || new Error("ACQUISITION_SCREENING_STATE_FAILED");
  const now = new Date();
  if (acquisition.data.cancel_requested) {
    await admin.from("ai_screening_tasks").update({ cancel_requested: true, updated_at: now.toISOString() }).eq("id", screeningTaskId).in("status", ["QUEUED","RUNNING","PAUSING","PAUSED"]);
    return { control: "CANCELLED" as const, screening: screening.data };
  }
  if (acquisition.data.status === "PAUSING") {
    const started = acquisition.data.started_at ? new Date(acquisition.data.started_at).getTime() : NaN;
    const elapsed = Number(acquisition.data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
    await Promise.all([
      admin.from("ai_acquisition_tasks").update({ status: "PAUSED", elapsed_ms: elapsed, started_at: null, pause_started_at: now.toISOString(), executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", taskId),
      admin.from("ai_screening_tasks").update({ status: "PAUSING", updated_at: now.toISOString() }).eq("id", screeningTaskId).eq("status", "RUNNING"),
    ]);
    return { control: "PAUSED" as const, screening: screening.data };
  }
  await admin.from("ai_acquisition_tasks").update({ executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", taskId);
  return { control: acquisition.data.status === "PAUSED" ? "PAUSED" as const : "RUNNING" as const, screening: screening.data };
}

async function acquisitionControlState(taskId: string, screeningTaskId: string) {
  "use step";
  const admin = createAdminClient();
  const result = await admin.from("ai_acquisition_tasks").select("status,cancel_requested,started_at,elapsed_ms,pause_started_at,paused_duration_ms").eq("id", taskId).single();
  if (result.error || !result.data) throw result.error || new Error("ACQUISITION_CONTROL_STATE_FAILED");
  const now = new Date();
  if (result.data.cancel_requested) {
    await admin.from("ai_screening_tasks").update({ cancel_requested: true, updated_at: now.toISOString() }).eq("id", screeningTaskId).in("status", ["QUEUED","RUNNING","PAUSING","PAUSED"]);
    return "CANCELLED" as const;
  }
  if (result.data.status === "PAUSING") {
    const started = result.data.started_at ? new Date(result.data.started_at).getTime() : NaN;
    const elapsed = Number(result.data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
    await Promise.all([
      admin.from("ai_acquisition_tasks").update({ status: "PAUSED", elapsed_ms: elapsed, started_at: null, pause_started_at: now.toISOString(), executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", taskId),
      admin.from("ai_screening_tasks").update({ status: "PAUSING", updated_at: now.toISOString() }).eq("id", screeningTaskId).eq("status", "RUNNING"),
    ]);
    return "PAUSED" as const;
  }
  await admin.from("ai_acquisition_tasks").update({ executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", taskId);
  return result.data.status === "PAUSED" ? "PAUSED" as const : "RUNNING" as const;
}

async function finalizeCandidates(task: AcquisitionTask) {
  "use step";
  const admin = createAdminClient();
  const candidates = await admin.from("ai_acquisition_candidates").select("*").eq("task_id", task.id).eq("decision", "ANALYZING");
  if (candidates.error) throw candidates.error;
  for (const candidate of candidates.data || []) {
    const customerId = String(candidate.staging_customer_id || "");
    const itemId = String(candidate.screening_task_item_id || "");
    const [customer, result, contacts, evidence] = await Promise.all([
      admin.from("customers").select("*").eq("id", customerId).maybeSingle(),
      admin.from("ai_screening_results").select("id,score,grade,automation_status,target_decision,identity_status,evidence_sufficiency_score,short_reason").eq("task_item_id", itemId).eq("is_latest_valid", true).maybeSingle(),
      admin.from("customer_contacts").select("id,type,value_raw,value_normalized,verification_status,identity_match_status,exact_source_url").eq("customer_id", customerId),
      admin.from("ai_screening_evidence").select("id,source_url,evidence_strength").eq("task_item_id", itemId),
    ]);
    if (customer.error || result.error || contacts.error || evidence.error) throw customer.error || result.error || contacts.error || evidence.error;
    const gate = evaluateAcquisitionGate({ automationStatus: result.data?.automation_status, targetDecision: result.data?.target_decision, score: result.data?.score, identityStatus: result.data?.identity_status, evidenceUrls: evidence.data || [], contacts: contacts.data || [] });
    const verifiedContacts = gate.actionableContacts;
    const evidenceComplete = gate.evidenceComplete;
    const accepted = gate.accepted;
    let decision: "ACCEPTED" | "REVIEW" | "REJECTED" | "DUPLICATE" = accepted ? "ACCEPTED" : result.data ? "REJECTED" : "REVIEW";
    let reason = accepted ? "目标行业、主体、在营证据和可用联系方式均已核验" : String(result.data?.short_reason || "核验证据不足，未进入客户公海");
    if (accepted) {
      const normalized = verifiedContacts.map((row) => String(row.value_normalized || "")).filter(Boolean);
      const duplicateContacts = normalized.length ? await admin.from("customer_contacts").select("customer_id").in("value_normalized", normalized).neq("customer_id", customerId).limit(1) : { data: [], error: null };
      if (duplicateContacts.error) throw duplicateContacts.error;
      if (duplicateContacts.data?.length) { decision = "DUPLICATE"; reason = "核验联系方式已存在于系统其他客户，未重复入池"; }
    }
    if (decision === "ACCEPTED") {
      const promoted = await admin.from("customers").update({ source: "AI_ACQUISITION", acquisition_scope: "PUBLIC_POOL", pool_status: "AVAILABLE", status: "UNCLAIMED", owner_id: null, owner_user_id: null, assigned_via: null, updated_at: new Date().toISOString() }).eq("id", customerId).eq("pool_status", "AI_STAGING").select("id").maybeSingle();
      if (promoted.error) throw promoted.error;
      if (!promoted.data) {
        const current = await admin.from("customers").select("source,acquisition_scope,pool_status,deleted_at").eq("id", customerId).maybeSingle();
        if (current.error) throw current.error;
        const alreadyInSystem = current.data?.source === "AI_ACQUISITION"
          && current.data?.acquisition_scope === "PUBLIC_POOL"
          && ["AVAILABLE", "CLAIMED"].includes(String(current.data?.pool_status || ""))
          && !current.data?.deleted_at;
        if (!alreadyInSystem) {
          decision = "REVIEW";
          reason = "质量门槛已通过，但客户入池写入未确认，等待人工复核或重试";
        }
      }
    } else {
      const hidden = await admin.from("customers").update({ deleted_at: new Date().toISOString(), pool_status: "INVALID", updated_at: new Date().toISOString() }).eq("id", customerId).eq("pool_status", "AI_STAGING");
      if (hidden.error) throw hidden.error;
    }
    const saved = await admin.from("ai_acquisition_candidates").update({ decision, decision_reason: reason, imported_customer_id: decision === "ACCEPTED" ? customerId : null, ai_score: result.data?.score || null, ai_level: result.data?.grade || null, is_target_customer: result.data?.target_decision === "VALID", has_actionable_contact: verifiedContacts.length > 0, evidence_complete: evidenceComplete, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", candidate.id);
    if (saved.error) throw saved.error;
  }
}

async function finishTask(taskId: string, status: "COMPLETED" | "FAILED" | "CANCELLED", errorMessage?: string) {
  "use step";
  const admin = createAdminClient();
  const rows = await admin.from("ai_acquisition_candidates").select("decision").eq("task_id", taskId);
  if (rows.error) throw rows.error;
  const count = (decision: string) => (rows.data || []).filter((row) => row.decision === decision).length;
  const now = new Date();
  const task = await admin.from("ai_acquisition_tasks").select("started_at,elapsed_ms").eq("id", taskId).single();
  if (task.error) throw task.error;
  const started = task.data.started_at ? new Date(task.data.started_at).getTime() : NaN;
  const elapsed = Number(task.data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const finalStage=status==="COMPLETED"?"FINISHED":status;
  const update = await admin.from("ai_acquisition_tasks").update({ status, current_stage:finalStage, current_stage_detail:status==="COMPLETED"?"检索、去重、核验和准入判定均已完成":errorMessage?.slice(0,500)||null, processed_count: rows.data?.length || 0, accepted_count: count("ACCEPTED"), review_count: count("REVIEW"), rejected_count: count("REJECTED"), duplicate_count: count("DUPLICATE"), elapsed_ms: elapsed, started_at: null, finished_at: now.toISOString(), active_executor: null, executor_heartbeat_at: now.toISOString(), error_message: errorMessage?.slice(0, 1000) || null, updated_at: now.toISOString() }).eq("id", taskId);
  if (update.error) throw update.error;
}

export async function aiAcquisitionWorkflow(taskId: string, scheduledAt: string | null = null) {
  "use workflow";
  try {
    if (scheduledAt && new Date(scheduledAt).getTime() > Date.now()) await sleep(new Date(scheduledAt));
    const task = await readTask(taskId);
    if (task.cancel_requested) { await finishTask(taskId, "CANCELLED"); return; }
    await beginTask(taskId);
    const screeningTaskId = await createScreeningTask(task);
    let staging=await stageCandidates(task,screeningTaskId);
    while(staging.control==="PAUSED") {
      const control=await acquisitionControlState(taskId,screeningTaskId);
      if(control==="CANCELLED"){await finishTask(taskId,"CANCELLED");return;}
      if(control==="PAUSED"){await sleep("10s");continue;}
      staging=await stageCandidates(await readTask(taskId),screeningTaskId);
    }
    if(staging.control==="CANCELLED"){await finishTask(taskId,"CANCELLED");return;}
    const analyzing = staging.analyzing;
    if (analyzing > 0) {
      await setTaskStage(taskId,"VERIFYING","正在核验主体、在营状态、目标行业、证据和有效联系方式");
      const initialState = await screeningState(screeningTaskId);
      if (initialState.status === "QUEUED") await dispatchScreening(screeningTaskId);
      let pollSeconds = 15;
      while (true) {
        const state = await verificationState(taskId, screeningTaskId);
        if (state.control === "CANCELLED") { await finishTask(taskId, "CANCELLED"); return; }
        if (state.control === "PAUSED") { await sleep("30s"); continue; }
        if (["COMPLETED","FAILED","CANCELLED"].includes(state.screening.status)) {
          if (state.screening.status !== "COMPLETED") throw new Error(state.screening.error_message || `ACQUISITION_SCREENING_${state.screening.status}`);
          break;
        }
        await sleep(`${pollSeconds}s`);
        pollSeconds = Math.min(60, pollSeconds + 15);
      }
      await setTaskStage(taskId,"FINALIZING","正在执行最终质量门槛、系统去重和客户公海准入");
      await finalizeCandidates(task);
    }
    await finishTask(taskId, "COMPLETED");
  } catch (error) {
    await finishTask(taskId, "FAILED", error instanceof Error ? error.message : String(error));
  }
}
