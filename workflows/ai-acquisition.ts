import { sleep } from "workflow";
import { start } from "workflow/api";
import { createAdminClient } from "../lib/supabase/admin";
import { aiScreeningWorkflow } from "./ai-screening";
import { discoverBusinesses, discoveryCandidateLooksRelevant, type DiscoveredBusiness } from "../lib/ai-acquisition/discovery";
import type { AcquisitionCountry } from "../lib/ai-acquisition/config";
import { acquisitionIndustryMatchesVerifiedResult } from "../lib/ai-acquisition/industry-match";
import { evaluateAcquisitionGate } from "../lib/ai-acquisition/quality-gate";
import { createScreeningTaskNumber } from "../lib/ai/task-number";
import { normalizedErrorMessage } from "../lib/ai/error-normalization";

type AcquisitionTask = {
  id: string; user_id: string; task_number: string; name: string; cost_mode: "FREE_ONLY" | "ADAPTIVE";
  countries: AcquisitionCountry[]; industry: string; industries?: string[]; keywords: string[]; excluded_keywords: string[];
  target_count: number; discovered_count: number; task_cost_limit_usd: number | null; status: string; cancel_requested: boolean;
};

function isRecoverableInfrastructureError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { message?: unknown; code?: unknown; status?: unknown } : null;
  const code = String(candidate?.code || candidate?.status || "");
  const message = error instanceof Error ? error.message : String(candidate?.message || error || "");
  return ["40001", "40P01", "55P03", "57014", "502", "503", "504", "525", "529"].includes(code)
    || /(?:canceling statement due to statement timeout|deadlock detected|could not serialize access|lock not available|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|gateway timeout|ssl handshake failed|cloudflare)/i.test(message);
}

async function readTask(taskId: string) {
  "use step";
  const result = await createAdminClient().from("ai_acquisition_tasks").select("*").eq("id", taskId).single();
  if (result.error || !result.data) throw result.error || new Error("ACQUISITION_TASK_NOT_FOUND");
  return result.data as AcquisitionTask;
}

async function beginTask(taskId: string, executionToken: string | null) {
  "use step";
  const now = new Date().toISOString();
  let query = createAdminClient().from("ai_acquisition_tasks").update({ status: "RUNNING", current_stage:"DISCOVERY", current_stage_detail:"正在按国家和本地化检索表达发现目标商家", active_executor: "VERCEL_WORKFLOW", started_at: now, executor_heartbeat_at: now, error_message: null, updated_at: now }).eq("id", taskId).in("status", ["QUEUED", "RUNNING"]);
  if (executionToken) query = query.eq("last_dispatch_at", executionToken);
  const result = await query.select("id").maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

async function createScreeningTask(task: AcquisitionTask) {
  "use step";
  const admin = createAdminClient();
  const existing = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${task.id}`).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return String(existing.data.id);
  const inserted = await admin.from("ai_screening_tasks").insert({
    user_id: task.user_id, task_number: createScreeningTaskNumber("ACQUISITION"), name: `${task.name} · 获客核验`, strategy: "SMART", strategy_version: "1.0",
    status: "QUEUED", total_count: 0, pending_count: 0, selection_mode: "FILTERED",
    filters: { service: "AI_ACQUISITION", acquisition_task_id: task.id, force_fresh_analysis: true }, request_key: `acquisition:${task.id}`,
    cost_mode: task.cost_mode, task_cost_limit_usd: task.task_cost_limit_usd, execution_mode: "VERCEL_ONLY", dispatch_policy: "VERCEL_ONLY",
    archived_at: new Date().toISOString(),
  }).select("id").single();
  if (inserted.error || !inserted.data) throw inserted.error || new Error("ACQUISITION_SCREENING_TASK_CREATE_FAILED");
  return String(inserted.data.id);
}

async function updateAcquisitionTaskTotals(admin: ReturnType<typeof createAdminClient>, taskId: string) {
  const count = async (decision?: string) => {
    let query = admin.from("ai_acquisition_candidates").select("id", { count: "exact", head: true }).eq("task_id", taskId);
    if (decision) query = query.eq("decision", decision);
    const result = await query;
    if (result.error) throw result.error;
    return Number(result.count || 0);
  };
  const [discovered, accepted, review, rejected, duplicate, analyzing] = await Promise.all([
    count(), count("ACCEPTED"), count("REVIEW"), count("REJECTED"), count("DUPLICATE"), count("ANALYZING"),
  ]);
  const processed = accepted + review + rejected + duplicate;
  const saved = await admin.from("ai_acquisition_tasks").update({
    discovered_count: discovered,
    processed_count: Math.min(discovered, processed),
    accepted_count: accepted,
    review_count: review,
    rejected_count: rejected,
    duplicate_count: duplicate,
    updated_at: new Date().toISOString(),
  }).eq("id", taskId);
  if (saved.error) throw saved.error;
  return { discovered, processed, analyzing };
}

async function stageCandidates(task: AcquisitionTask, screeningTaskId: string) {
  "use step";
  const admin = createAdminClient();
  const industries = task.industries?.length ? task.industries : [task.industry];
  // target_count is an internal discovery safety ceiling, not a requested
  // number of successful public-pool imports. The UI intentionally does not
  // ask users to predict how many qualified businesses exist.
  const discoveryCeiling = Math.max(1, task.target_count);
  const existingCandidateCount=await admin.from("ai_acquisition_candidates").select("id",{count:"exact",head:true}).eq("task_id",task.id);
  if(existingCandidateCount.error)throw existingCandidateCount.error;
  const taskRemainingCapacity=Math.max(0,discoveryCeiling-Number(existingCandidateCount.count||0));
  const unique = new Map<string, DiscoveredBusiness>();
  let discoveryControl: "PAUSED" | "CANCELLED" | "BUDGET_LIMITED" | "CONTINUE" | null = null;
  for (const [countryIndex,country] of task.countries.entries()) {
    if (unique.size >= taskRemainingCapacity) break;
    const latest = await readTask(task.id);
    if (latest.cancel_requested) { discoveryControl = "CANCELLED"; break; }
    const remainingCountries=Math.max(1,task.countries.length-countryIndex);
    const remainingCapacity=Math.max(1,taskRemainingCapacity-unique.size);
    const countryLimit=Math.max(20,Math.ceil(remainingCapacity/remainingCountries));
    const discovery = await discoverBusinesses({ acquisitionTaskId: task.id, screeningTaskId, userId: task.user_id, costMode: task.cost_mode, country, industries, keywords: task.keywords, excludedKeywords: task.excluded_keywords, limit: countryLimit });
    discovery.businesses.forEach((business) => {
      if (unique.size < taskRemainingCapacity) unique.set(business.placeId, business);
    });
    if(discovery.control==="CONTINUE"){discoveryControl="CONTINUE";continue;}
    if(discovery.control){discoveryControl=discovery.control;break;}
  }
  const stageUpdate=await admin.from("ai_acquisition_tasks").update({current_stage:"DEDUPLICATING",current_stage_detail:"正在保存候选、系统去重并执行非目标早停",executor_heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",task.id).eq("status","RUNNING");
  if(stageUpdate.error)throw stageUpdate.error;
  const discovered = [...unique.values()];
  const lookupBatchSize = 100;
  for (let offset = 0; offset < discovered.length; offset += lookupBatchSize) {
    const batch = discovered.slice(offset, offset + lookupBatchSize);
    const placeIds = batch.map((candidate) => candidate.placeId);
    {
      const current=await readTask(task.id);
      if(current.cancel_requested){discoveryControl="CANCELLED";break;}
      if(["PAUSING","PAUSED"].includes(current.status)){discoveryControl="PAUSED";break;}
      const heartbeat=await admin.from("ai_acquisition_tasks").update({executor_heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",task.id).eq("status","RUNNING");
      if(heartbeat.error)throw heartbeat.error;
    }
    const [currentCandidates, existingCustomers] = await Promise.all([
      admin.from("ai_acquisition_candidates").select("place_id").eq("task_id", task.id).in("place_id", placeIds),
      admin.from("customers").select("id,google_maps_place_id,pool_status").in("google_maps_place_id", placeIds).is("deleted_at", null),
    ]);
    if (currentCandidates.error || existingCustomers.error) throw currentCandidates.error || existingCustomers.error;
    const already = new Set((currentCandidates.data || []).map((row) => String(row.place_id)));
    const customerByPlace = new Map((existingCustomers.data || []).filter((row)=>String(row.pool_status||"")!=="AI_STAGING").map((row) => [String(row.google_maps_place_id), String(row.id)]));
    const stagingCustomerByPlace = new Map((existingCustomers.data || []).filter((row)=>String(row.pool_status||"")==="AI_STAGING").map((row) => [String(row.google_maps_place_id), String(row.id)]));
    const terminalRows: Array<Record<string, unknown>> = [];
    const candidatesToAnalyze: DiscoveredBusiness[] = [];
    for (const candidate of batch) {
      if (already.has(candidate.placeId)) continue;
      const baseRow = { task_id: task.id, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms };
      const existingCustomerId = customerByPlace.get(candidate.placeId);
      if (existingCustomerId) terminalRows.push({ ...baseRow, source_snapshot: candidate, decision:"DUPLICATE", decision_reason:"Google Place ID已存在于系统客户资料", imported_customer_id:existingCustomerId, is_target_customer:false, has_actionable_contact:false, evidence_complete:false, processed_at:new Date().toISOString() });
      else if (candidate.businessStatus === "CLOSED_PERMANENTLY") terminalRows.push({ ...baseRow, source_snapshot:candidate, decision:"REJECTED", decision_reason:"Google 商家明确标记永久停业，已在补证前停止", is_target_customer:false, has_actionable_contact:false, evidence_complete:false, processed_at:new Date().toISOString() });
      else if (!discoveryCandidateLooksRelevant(candidate, industries, task.keywords)) terminalRows.push({ ...baseRow, source_snapshot:candidate, decision:"REJECTED", decision_reason:"公开商家基础类别与目标行业缺少直接相关信号，已在补证前停止", is_target_customer:false, has_actionable_contact:false, evidence_complete:false, processed_at:new Date().toISOString() });
      else candidatesToAnalyze.push(candidate);
    }
    if (terminalRows.length) {
      const terminalInsert = await admin.from("ai_acquisition_candidates").insert(terminalRows);
      if (terminalInsert.error) throw terminalInsert.error;
    }
    const stagingConcurrency=10;
    for(let stagingOffset=0;stagingOffset<candidatesToAnalyze.length;stagingOffset+=stagingConcurrency){
      await Promise.all(candidatesToAnalyze.slice(stagingOffset,stagingOffset+stagingConcurrency).map(async(candidate)=>{
      let customerId=stagingCustomerByPlace.get(candidate.placeId)||"";
      if(!customerId){
        const customer = await admin.from("customers").insert({
          company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl,
          google_maps_place_id: candidate.placeId, industry: null, category: candidate.types.join(" | ") || null, source: "AI_ACQUISITION_STAGING", source_channel: "GOOGLE_MAPS",
          source_batch: task.task_number, source_reference: task.id, origin_source: "AI_ACQUISITION", status: "UNCLAIMED", followup_status: "WAITING_CONTACT", created_by: task.user_id,
          owner_id: null, owner_user_id: null, acquisition_scope: "PRIVATE", pool_status: "AI_STAGING", assigned_via: null, acquisition_match_keywords: candidate.matchedTerms,
        }).select("id").single();
        if (customer.error || !customer.data) throw customer.error || new Error("ACQUISITION_STAGING_CUSTOMER_FAILED");
        customerId=String(customer.data.id);
      } else {
        const refreshed=await admin.from("customers").update({company_name:candidate.companyName,address:candidate.address,google_url:candidate.googleUrl,category:candidate.types.join(" | ")||null,source_batch:task.task_number,source_reference:task.id,acquisition_match_keywords:candidate.matchedTerms,updated_at:new Date().toISOString()}).eq("id",customerId).eq("pool_status","AI_STAGING");
        if(refreshed.error)throw refreshed.error;
      }
      const source = await admin.from("customer_sources").insert({
      customer_id: customerId,
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
    const item = await admin.from("ai_screening_task_items").insert({ task_id: screeningTaskId, customer_id: customerId, status: "PENDING", strategy: "SMART", strategy_version: "1.0" }).select("id").single();
    if (item.error || !item.data) throw item.error || new Error("ACQUISITION_SCREENING_ITEM_FAILED");
    const row = await admin.from("ai_acquisition_candidates").insert({ task_id: task.id, screening_task_id: screeningTaskId, screening_task_item_id: item.data.id, staging_customer_id: customerId, place_id: candidate.placeId, company_name: candidate.companyName, country: candidate.country, address: candidate.address, google_url: candidate.googleUrl, source_query: candidate.query, matched_keywords: candidate.matchedTerms, source_snapshot: candidate, decision: "ANALYZING", is_target_customer:false, has_actionable_contact:false, evidence_complete:false });
      if (row.error) throw row.error;
      }));
    }
  }
  // The consumer may already be processing earlier candidates. Recalculate
  // progress from task-item truth instead of overwriting its live counters.
  const updatedScreening = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: screeningTaskId });
  if (updatedScreening.error) throw updatedScreening.error;
  const totals = await updateAcquisitionTaskTotals(admin, task.id);
  return { analyzing: totals.analyzing, control: discoveryControl };
}

async function completeEmptyScreeningTask(screeningTaskId:string) {
  "use step";
  const now=new Date().toISOString();
  const saved=await createAdminClient().from("ai_screening_tasks").update({status:"COMPLETED",total_count:0,pending_count:0,processed_count:0,success_count:0,failed_count:0,started_at:null,finished_at:now,completed_at:now,active_executor:null,executor_heartbeat_at:now,updated_at:now}).eq("id",screeningTaskId).eq("status","QUEUED");
  if(saved.error)throw saved.error;
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
    admin.from("ai_acquisition_tasks").select("status,cancel_requested,started_at,elapsed_ms,pause_started_at,paused_duration_ms,discovered_count").eq("id", taskId).single(),
    admin.from("ai_screening_tasks").select("status,total_count,pending_count,success_count,failed_count,error_message").eq("id", screeningTaskId).single(),
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
  const deepTotal=Number(screening.data.total_count||0);
  const deepProcessed=Number(screening.data.success_count||0)+Number(screening.data.failed_count||0);
  const earlyProcessed=Math.max(0,Number(acquisition.data.discovered_count||0)-deepTotal);
  const processedCount=Math.min(Number(acquisition.data.discovered_count||0),earlyProcessed+deepProcessed);
  await admin.from("ai_acquisition_tasks").update({ processed_count:processedCount, executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", taskId);
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

async function finalizeCandidateBatch(task: AcquisitionTask, screeningTaskId: string) {
  "use step";
  const admin = createAdminClient();
  // Keep the IN lists and joined evidence/contact reads below PostgREST and
  // database statement-timeout pressure when several acquisition tasks finish
  // concurrently. The loop drains all ready rows through durable small steps.
  const batchSize = 25;
  const waitingCandidates = await admin.from("ai_acquisition_candidates").select("id,screening_task_item_id").eq("task_id", task.id).eq("decision", "ANALYZING").not("screening_task_item_id","is",null).limit(125);
  if(waitingCandidates.error)throw waitingCandidates.error;
  const waitingItemIds=(waitingCandidates.data||[]).map((row)=>String(row.screening_task_item_id||"")).filter(Boolean);
  if(!waitingItemIds.length)return false;
  const readyItems = await admin.from("ai_screening_task_items").select("id").eq("task_id", screeningTaskId).eq("status", "COMPLETED").in("id",waitingItemIds).limit(batchSize);
  if(readyItems.error)throw readyItems.error;
  const readyItemIds=(readyItems.data||[]).map((row)=>String(row.id));
  if(!readyItemIds.length)return false;
  const candidates = await admin.from("ai_acquisition_candidates").select("*").eq("task_id", task.id).eq("decision", "ANALYZING").in("screening_task_item_id",readyItemIds).limit(batchSize);
  if(candidates.error)throw candidates.error;
  const batch=candidates.data||[];
  if(!batch.length)return false;
    const itemIds = batch.map((row) => String(row.screening_task_item_id || "")).filter(Boolean);
    const customerIds = batch.map((row) => String(row.staging_customer_id || "")).filter(Boolean);
    const [results, contacts, evidence] = await Promise.all([
      admin.from("ai_screening_results").select("task_item_id,id,score,grade,automation_status,target_decision,identity_status,industry_type,evidence_sufficiency_score,short_reason").in("task_item_id", itemIds).eq("is_latest_valid", true),
      admin.from("customer_contacts").select("customer_id,id,type,value_raw,value_normalized,verification_status,identity_match_status,contact_status,exact_source_url").in("customer_id", customerIds),
      admin.from("ai_screening_evidence").select("task_item_id,id,source_url,evidence_strength,translated_fact,original_excerpt").in("task_item_id", itemIds),
    ]);
    if (results.error || contacts.error || evidence.error) throw results.error || contacts.error || evidence.error;
    const resultByItem = new Map((results.data || []).map((row) => [String(row.task_item_id), row]));
    const contactsByCustomer = new Map<string, typeof contacts.data>();
    for (const row of contacts.data || []) {
      const customerId = String(row.customer_id);
      contactsByCustomer.set(customerId, [...(contactsByCustomer.get(customerId) || []), row]);
    }
    const evidenceByItem = new Map<string, typeof evidence.data>();
    for (const row of evidence.data || []) {
      const itemId = String(row.task_item_id);
      evidenceByItem.set(itemId, [...(evidenceByItem.get(itemId) || []), row]);
    }
    for (const candidate of batch) {
      const customerId = String(candidate.staging_customer_id || "");
      const itemId = String(candidate.screening_task_item_id || "");
      const result = resultByItem.get(itemId);
      if (!result) throw new Error(`AI_SCREENING_RESULT_MISSING: completed item ${itemId} has no latest valid result`);
      const customerContacts = contactsByCustomer.get(customerId) || [];
      const itemEvidence = evidenceByItem.get(itemId) || [];
      const gate = evaluateAcquisitionGate({ automationStatus: result?.automation_status, targetDecision: result?.target_decision, score: result?.score, identityStatus: result?.identity_status, evidenceUrls: itemEvidence, contacts: customerContacts });
      const targetIndustries = task.industries?.length ? task.industries : [task.industry];
      const industryEvidence = itemEvidence.flatMap((row) => [row.translated_fact, row.original_excerpt]);
      const industryMatchesTask = acquisitionIndustryMatchesVerifiedResult(targetIndustries, result?.industry_type, industryEvidence);
      const verifiedContacts = gate.actionableContacts;
      const evidenceComplete = gate.evidenceComplete;
      const accepted = gate.accepted && industryMatchesTask;
      const explicitlyNeedsReview = result?.automation_status === "AUTO_HOLD" || result?.target_decision === "REVIEW";
      const unreachableVerifiedTarget = gate.verifiedTarget && industryMatchesTask && gate.actionableContacts.length === 0;
      const verifiedIndustryMismatch = Boolean(String(result?.industry_type || "").trim())
        && ["MATCHED", "LIKELY_MATCHED"].includes(String(result?.identity_status || ""))
        && gate.hasTraceableBusinessEvidence
        && !industryMatchesTask;
      let decision: "ACCEPTED" | "REVIEW" | "REJECTED" | "DUPLICATE" = verifiedIndustryMismatch
        ? "REJECTED"
        : accepted ? "ACCEPTED" : (explicitlyNeedsReview || unreachableVerifiedTarget) ? "REVIEW" : "REJECTED";
      let reason = accepted ? "目标行业、主体、在营证据和可用联系方式均已核验"
        : verifiedIndustryMismatch ? `已核验行业“${String(result?.industry_type || "未知") }”与本任务目标行业不一致，未进入客户公海`
        : unreachableVerifiedTarget ? "已确认目标行业、主体和经营证据，但尚未取得带具体来源的有效联系方式；保留待补证，禁止按不可触达自动归档"
        : explicitlyNeedsReview ? String(result?.short_reason || "可靠来源存在主体或经营事实冲突，需要人工复核")
          : String(result?.short_reason || "核验证据不足，未进入客户公海");
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
      } else if (decision !== "REVIEW") {
        const hidden = await admin.from("customers").update({ deleted_at: new Date().toISOString(), pool_status: "INVALID", updated_at: new Date().toISOString() }).eq("id", customerId).eq("pool_status", "AI_STAGING");
        if (hidden.error) throw hidden.error;
      }
      const saved = await admin.from("ai_acquisition_candidates").update({ decision, decision_reason: reason, imported_customer_id: decision === "ACCEPTED" ? customerId : null, ai_score: result?.score || null, ai_level: result?.grade || null, is_target_customer: result?.target_decision === "VALID" && industryMatchesTask, has_actionable_contact: verifiedContacts.length > 0, evidence_complete: evidenceComplete, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", candidate.id);
      if (saved.error) throw saved.error;
    }
  await updateAcquisitionTaskTotals(admin, task.id);
  return true;
}

async function finishTask(taskId: string, status: "COMPLETED" | "FAILED" | "CANCELLED", errorMessage?: string, executionToken?: string | null) {
  "use step";
  const admin = createAdminClient();
  if (executionToken) {
    const current = await admin.from("ai_acquisition_tasks").select("last_dispatch_at").eq("id", taskId).single();
    if (current.error) throw current.error;
    if (String(current.data.last_dispatch_at || "") !== executionToken) return false;
  }
  const decisionCount=async(decision:string)=>{
    const result=await admin.from("ai_acquisition_candidates").select("id",{count:"exact",head:true}).eq("task_id",taskId).eq("decision",decision);
    if(result.error)throw new Error(normalizedErrorMessage(result.error,{stage:`ACQUISITION_FINISH_COUNT_${decision}`}));
    return Number(result.count||0);
  };
  const [acceptedCount,reviewCount,rejectedCount,duplicateCount,reusedResult,totalResult,analyzingResult]=await Promise.all([
    decisionCount("ACCEPTED"),decisionCount("REVIEW"),decisionCount("REJECTED"),decisionCount("DUPLICATE"),
    admin.from("ai_acquisition_candidates").select("id",{count:"exact",head:true}).eq("task_id",taskId).like("decision_reason","复用近14天历史核验结论%"),
    admin.from("ai_acquisition_candidates").select("id",{count:"exact",head:true}).eq("task_id",taskId),
    admin.from("ai_acquisition_candidates").select("id",{count:"exact",head:true}).eq("task_id",taskId).eq("decision","ANALYZING"),
  ]);
  if(reusedResult.error||totalResult.error||analyzingResult.error)throw new Error(normalizedErrorMessage(reusedResult.error||totalResult.error||analyzingResult.error,{stage:"ACQUISITION_FINISH_CANDIDATE_TOTALS"}));
  const processedCount=acceptedCount+reviewCount+rejectedCount+duplicateCount;
  const discoveredCount=Number(totalResult.count||0);
  const analyzingCount=Number(analyzingResult.count||0);
  if(status==="COMPLETED"&&(processedCount!==discoveredCount||analyzingCount>0))throw new Error(`ACQUISITION_COMPLETION_INTEGRITY_FAILED: processed=${processedCount}, discovered=${discoveredCount}, analyzing=${analyzingCount}`);
  const now = new Date();
  const task = await admin.from("ai_acquisition_tasks").select("started_at,elapsed_ms").eq("id", taskId).single();
  if (task.error) throw new Error(normalizedErrorMessage(task.error,{stage:"ACQUISITION_FINISH_TASK_STATE"}));
  const started = task.data.started_at ? new Date(task.data.started_at).getTime() : NaN;
  const elapsed = Number(task.data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const finalStage=status==="COMPLETED"?"FINISHED":status;
  const [checkpointTotal,freshCheckpoints,budgetCheckpoints]=await Promise.all([
    admin.from("ai_acquisition_discovery_checkpoints").select("task_id",{count:"exact",head:true}).eq("task_id",taskId),
    admin.from("ai_acquisition_discovery_checkpoints").select("task_id",{count:"exact",head:true}).eq("task_id",taskId).in("status",["RUNNING","PAUSED","COMPLETED","BUDGET_LIMITED"]),
    admin.from("ai_acquisition_discovery_checkpoints").select("task_id",{count:"exact",head:true}).eq("task_id",taskId).eq("status","BUDGET_LIMITED"),
  ]);
  if(checkpointTotal.error||freshCheckpoints.error||budgetCheckpoints.error)throw new Error(normalizedErrorMessage(checkpointTotal.error||freshCheckpoints.error||budgetCheckpoints.error,{stage:"ACQUISITION_FINISH_CHECKPOINT_TOTALS"}));
  const noFreshSearch=Number(checkpointTotal.count||0)>0&&Number(freshCheckpoints.count||0)===0;
  const reusedCandidates=Number(reusedResult.count||0);
  const budgetLimited=Number(budgetCheckpoints.count||0)>0;
  const completedDetail=noFreshSearch?`本次任务范围与近期已完成搜索重合，未重复调用第三方平台；复用 ${reusedCandidates} 条近期核验结论，无新增候选进入分析`:budgetLimited?"发现阶段触发费用保护后停止；已发现候选均已完成去重、核验或历史结论复用":"当前检索策略可返回分页、去重、核验和准入判定均已完成";
  let updateQuery = admin.from("ai_acquisition_tasks").update({ status, current_stage:finalStage, current_stage_detail:status==="COMPLETED"?completedDetail:status==="FAILED"?"执行异常，已保留完成进度和检查点，可安全重试":null, discovered_count:discoveredCount, processed_count:processedCount, accepted_count:acceptedCount, review_count:reviewCount, rejected_count:rejectedCount, duplicate_count:duplicateCount, elapsed_ms: elapsed, started_at: null, finished_at: now.toISOString(), active_executor: null, executor_heartbeat_at: now.toISOString(), error_message:errorMessage?.slice(0,1000)||null, updated_at:now.toISOString() }).eq("id",taskId);
  if (executionToken) updateQuery = updateQuery.eq("last_dispatch_at", executionToken);
  const update = await updateQuery;
  if (update.error) throw new Error(normalizedErrorMessage(update.error,{stage:"ACQUISITION_FINISH_TASK_UPDATE"}));
  return true;
}

async function releaseTaskForRecovery(taskId: string, error: unknown, executionToken?: string | null) {
  "use step";
  const admin = createAdminClient();
  const candidate = error && typeof error === "object" ? error as { message?: unknown; code?: unknown } : null;
  const message = error instanceof Error ? error.message : String(candidate?.message || error || "");
  const code = String(candidate?.code || "");
  let saveQuery = admin.from("ai_acquisition_tasks").update({
    status: "RUNNING",
    active_executor: null,
    last_dispatch_at: null,
    executor_heartbeat_at: null,
    error_message: `基础服务短暂异常，系统将从检查点自动恢复${code ? `（${code}）` : ""}：${message}`.slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq("id", taskId).in("status", ["QUEUED", "RUNNING", "PAUSING"]);
  if (executionToken) saveQuery = saveQuery.eq("last_dispatch_at", executionToken);
  const saved = await saveQuery;
  if (saved.error) throw saved.error;
}

export async function aiAcquisitionWorkflow(taskId: string, scheduledAt: string | null = null, executionToken: string | null = null) {
  "use workflow";
  try {
    if (scheduledAt && new Date(scheduledAt).getTime() > Date.now()) await sleep(new Date(scheduledAt));
    const task = await readTask(taskId);
    if (task.cancel_requested) { await finishTask(taskId, "CANCELLED", undefined, executionToken); return; }
    if (!await beginTask(taskId, executionToken)) return;
    const screeningTaskId = await createScreeningTask(task);
    let staging=await stageCandidates(task,screeningTaskId);
    if(staging.analyzing>0) {
      const initialState=await screeningState(screeningTaskId);
      if(initialState.status==="QUEUED")await dispatchScreening(screeningTaskId);
      while(await finalizeCandidateBatch(task,screeningTaskId)){}
    }
    while(staging.control==="PAUSED"||staging.control==="CONTINUE") {
      if(staging.control==="CONTINUE"){
        staging=await stageCandidates(await readTask(taskId),screeningTaskId);
        if(staging.analyzing>0){
          const state=await screeningState(screeningTaskId);
          if(state.status==="QUEUED")await dispatchScreening(screeningTaskId);
          while(await finalizeCandidateBatch(task,screeningTaskId)){}
        }
        continue;
      }
      const control=await acquisitionControlState(taskId,screeningTaskId);
      if(control==="CANCELLED"){await finishTask(taskId,"CANCELLED",undefined,executionToken);return;}
      if(control==="PAUSED"){await sleep("10s");continue;}
      staging=await stageCandidates(await readTask(taskId),screeningTaskId);
      if(staging.analyzing>0){
        const state=await screeningState(screeningTaskId);
        if(state.status==="QUEUED")await dispatchScreening(screeningTaskId);
        while(await finalizeCandidateBatch(task,screeningTaskId)){}
      }
    }
    if(staging.control==="CANCELLED"){await finishTask(taskId,"CANCELLED",undefined,executionToken);return;}
    const analyzing = staging.analyzing;
    if (analyzing > 0) {
      await setTaskStage(taskId,"VERIFYING","正在核验主体、在营状态、目标行业、证据和有效联系方式");
      const initialState = await screeningState(screeningTaskId);
      if (initialState.status === "QUEUED") await dispatchScreening(screeningTaskId);
      let pollSeconds = 15;
      while (true) {
        while(await finalizeCandidateBatch(task,screeningTaskId)){
          await setTaskStage(taskId,"VERIFYING","正在持续核验；符合证据和联系方式门槛的客户已实时入池");
        }
        const state = await verificationState(taskId, screeningTaskId);
        if (state.control === "CANCELLED") { await finishTask(taskId, "CANCELLED", undefined, executionToken); return; }
        if (state.control === "PAUSED") { await sleep("30s"); continue; }
        if (["COMPLETED","FAILED","CANCELLED"].includes(state.screening.status)) {
          if (state.screening.status !== "COMPLETED") throw new Error(state.screening.error_message || `ACQUISITION_SCREENING_${state.screening.status}`);
          break;
        }
        await sleep(`${pollSeconds}s`);
        pollSeconds = Math.min(60, pollSeconds + 15);
      }
      await setTaskStage(taskId,"FINALIZING","正在执行最终质量门槛、系统去重和客户公海准入");
      while(await finalizeCandidateBatch(task,screeningTaskId)){
        await setTaskStage(taskId,"FINALIZING","正在分批执行最终质量门槛、系统去重和客户公海准入");
      }
    } else await completeEmptyScreeningTask(screeningTaskId);
    await finishTask(taskId, "COMPLETED", undefined, executionToken);
  } catch (error) {
    if (isRecoverableInfrastructureError(error)) {
      try { await releaseTaskForRecovery(taskId, error, executionToken); }
      catch (recoveryError) { console.error("[ai-acquisition] failed to persist automatic recovery state", recoveryError); }
      return;
    }
    await finishTask(taskId, "FAILED", error instanceof Error ? error.message : String(error), executionToken);
  }
}
