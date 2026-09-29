import { createAdminClient } from "@/lib/supabase/admin";
import { discoveryCandidateLooksRelevant, type DiscoveryRelevanceCandidate } from "./relevance";
import { acquisitionIndustryMatchesVerifiedResult } from "./industry-match";

type RequeueTask = {
  id: string;
  user_id: string;
  task_number: string;
  industry: string;
  industries?: string[];
  keywords: string[];
};

type RejectedCandidate = {
  id: string;
  place_id: string | null;
  company_name: string | null;
  country: string;
  address: string | null;
  google_url: string | null;
  source_query: string;
  source_snapshot: DiscoveryRelevanceCandidate & { matchedTerms?: string[] };
};

const EARLY_REJECTION_REASON = "公开商家基础类别与目标行业缺少直接相关信号";

/** Re-evaluate only the cheap discovery gate after its rules change. Final
 * target status is never inferred here: recovered rows always enter the
 * current task's fresh evidence-verification queue. */
export async function requeueCorrectedEarlyRejections(task: RequeueTask, screeningTaskId: string) {
  const admin = createAdminClient();
  const rows: RejectedCandidate[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await admin.from("ai_acquisition_candidates")
      .select("id,place_id,company_name,country,address,google_url,source_query,source_snapshot")
      .eq("task_id", task.id)
      .eq("decision", "REJECTED")
      .ilike("decision_reason", `%${EARLY_REJECTION_REASON}%`)
      .range(offset, offset + 999);
    if (page.error) throw page.error;
    rows.push(...((page.data || []) as RejectedCandidate[]));
    if ((page.data || []).length < 1000) break;
  }
  const industries = task.industries?.length ? task.industries : [task.industry];
  const eligible = rows.filter((row) => row.place_id && row.source_snapshot
    && discoveryCandidateLooksRelevant(row.source_snapshot, industries, task.keywords));
  let requeued = 0;
  for (let offset = 0; offset < eligible.length; offset += 10) {
    await Promise.all(eligible.slice(offset, offset + 10).map(async (candidate) => {
      const existing = await admin.from("customers")
        .select("id,pool_status,deleted_at")
        .eq("google_maps_place_id", candidate.place_id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && String(existing.data.pool_status || "") !== "AI_STAGING") {
        const duplicate = await admin.from("ai_acquisition_candidates").update({
          decision: "DUPLICATE",
          decision_reason: "重新校验早筛规则后确认Google Place ID已存在于系统客户资料",
          imported_customer_id: existing.data.id,
          screening_task_id: null,
          screening_task_item_id: null,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", candidate.id).eq("decision", "REJECTED");
        if (duplicate.error) throw duplicate.error;
        return;
      }
      let customerId = existing.data ? String(existing.data.id) : "";
      if (!customerId) {
        const created = await admin.from("customers").insert({
          company_name: candidate.company_name || "未命名客户",
          country: candidate.country,
          address: candidate.address,
          google_url: candidate.google_url,
          google_maps_place_id: candidate.place_id,
          industry: null,
          category: candidate.source_snapshot.types?.join(" | ") || null,
          source: "AI_ACQUISITION_STAGING",
          source_channel: "GOOGLE_MAPS",
          source_batch: task.task_number,
          source_reference: task.id,
          origin_source: "AI_ACQUISITION",
          status: "UNCLAIMED",
          followup_status: "WAITING_CONTACT",
          created_by: task.user_id,
          owner_id: null,
          owner_user_id: null,
          acquisition_scope: "PRIVATE",
          pool_status: "AI_STAGING",
          assigned_via: null,
          acquisition_match_keywords: candidate.source_snapshot.matchedTerms || [],
        }).select("id").single();
        if (created.error || !created.data) throw created.error || new Error("ACQUISITION_REQUEUE_CUSTOMER_FAILED");
        customerId = String(created.data.id);
      }
      const sourceExists = await admin.from("customer_sources").select("id")
        .eq("customer_id", customerId).eq("source_type", "AI_ACQUISITION").eq("source_reference", task.id).limit(1);
      if (sourceExists.error) throw sourceExists.error;
      if (!(sourceExists.data || []).length) {
        const source = await admin.from("customer_sources").insert({
          customer_id: customerId,
          source_type: "AI_ACQUISITION",
          source_reference: task.id,
          metadata: {
            acquisition_task_id: task.id,
            acquisition_task_number: task.task_number,
            source_channel: "GOOGLE_MAPS",
            exact_source_url: candidate.google_url,
            source_query: candidate.source_query,
            matched_search_terms: candidate.source_snapshot.matchedTerms || [],
            requeued_after_relevance_fix: true,
          },
        });
        if (source.error) throw source.error;
      }
      const item = await admin.from("ai_screening_task_items").insert({
        task_id: screeningTaskId,
        customer_id: customerId,
        status: "PENDING",
        strategy: "SMART",
        strategy_version: "1.0",
      }).select("id").single();
      if (item.error || !item.data) throw item.error || new Error("ACQUISITION_REQUEUE_ITEM_FAILED");
      const updated = await admin.from("ai_acquisition_candidates").update({
        screening_task_id: screeningTaskId,
        screening_task_item_id: item.data.id,
        staging_customer_id: customerId,
        imported_customer_id: null,
        decision: "ANALYZING",
        decision_reason: "早筛规则修复后重新进入当前任务的全新证据核验",
        ai_score: null,
        ai_level: null,
        is_target_customer: false,
        has_actionable_contact: false,
        evidence_complete: false,
        processed_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", candidate.id).eq("decision", "REJECTED");
      if (updated.error) throw updated.error;
      requeued += 1;
    }));
  }
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: screeningTaskId });
  if (refreshed.error) throw refreshed.error;
  return { inspected: rows.length, eligible: eligible.length, requeued };
}

/** Re-run only candidates whose old decision was caused by losing the trusted
 * Google discovery identity before classification. Existing accepted, review,
 * duplicate and model-reviewed results are left untouched. */
export async function requeueAcquisitionEvidenceGaps(task: RequeueTask, screeningTaskId: string) {
  const admin = createAdminClient();
  const candidates: Array<{id:string;screening_task_item_id:string;staging_customer_id:string}> = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await admin.from("ai_acquisition_candidates")
      .select("id,screening_task_item_id,staging_customer_id")
      .eq("task_id", task.id).eq("screening_task_id", screeningTaskId).eq("decision", "REJECTED")
      .not("screening_task_item_id", "is", null).not("staging_customer_id", "is", null)
      .range(offset, offset + 999);
    if (page.error) throw page.error;
    candidates.push(...((page.data || []) as typeof candidates));
    if ((page.data || []).length < 1000) break;
  }
  if (!candidates.length) return { inspected: 0, eligible: 0, requeued: 0 };
  const itemIds = [...new Set(candidates.map((row) => String(row.screening_task_item_id)))];
  const latestResults: Array<{task_item_id:string;target_decision:string|null;identity_status:string|null}> = [];
  const modelCallItemIds = new Set<string>();
  for (let offset = 0; offset < itemIds.length; offset += 100) {
    const ids = itemIds.slice(offset, offset + 100);
    const [results, modelCalls] = await Promise.all([
      admin.from("ai_screening_results").select("task_item_id,target_decision,identity_status").in("task_item_id", ids).eq("is_latest_valid", true),
      admin.from("ai_screening_model_calls").select("task_item_id").in("task_item_id", ids),
    ]);
    if (results.error || modelCalls.error) throw results.error || modelCalls.error;
    latestResults.push(...((results.data || []) as typeof latestResults));
    for (const row of modelCalls.data || []) modelCallItemIds.add(String(row.task_item_id));
  }
  const eligibleItemIds = latestResults.filter((row) => row.target_decision === "INVALID"
    && ["AMBIGUOUS", "NOT_FOUND"].includes(String(row.identity_status || ""))
    && !modelCallItemIds.has(String(row.task_item_id))).map((row) => String(row.task_item_id));
  if (!eligibleItemIds.length) return { inspected: candidates.length, eligible: 0, requeued: 0 };
  const eligibleItemSet = new Set(eligibleItemIds);
  const eligibleCandidates = candidates.filter((row) => eligibleItemSet.has(String(row.screening_task_item_id)));
  const customerIds = [...new Set(eligibleCandidates.map((row) => String(row.staging_customer_id)))];
  const now = new Date().toISOString();
  for (let offset = 0; offset < eligibleItemIds.length; offset += 100) {
    const ids = eligibleItemIds.slice(offset, offset + 100);
    const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", ids).eq("is_latest_valid", true);
    if (invalidated.error) throw invalidated.error;
    const resetItems = await admin.from("ai_screening_task_items").update({
      status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null,
      result_id: null, progress: 0, current_step: "WAITING", channel_checkpoint: {}, checkpoint: {},
      last_completed_channel: null, last_checkpoint_at: null, analyzed_channels: [], skipped_channels: [],
      error_message: null, error_code: null, completed_at: null, lease_owner: null, lease_token: null,
      lease_expires_at: null, updated_at: now,
    }).in("id", ids).eq("task_id", screeningTaskId);
    if (resetItems.error) throw resetItems.error;
  }
  for (let offset = 0; offset < customerIds.length; offset += 100) {
    const restored = await admin.from("customers").update({ deleted_at: null, pool_status: "AI_STAGING", acquisition_scope: "PRIVATE", updated_at: now })
      .in("id", customerIds.slice(offset, offset + 100)).eq("source", "AI_ACQUISITION_STAGING");
    if (restored.error) throw restored.error;
  }
  for (let offset = 0; offset < eligibleCandidates.length; offset += 100) {
    const ids = eligibleCandidates.slice(offset, offset + 100).map((row) => row.id);
    const resetCandidates = await admin.from("ai_acquisition_candidates").update({
      decision: "ANALYZING", decision_reason: "Google详情预算降级修复后重新执行主体、行业、证据与联系方式核验",
      imported_customer_id: null, ai_score: null, ai_level: null, manual_score:null, manual_level:null, manual_target_decision:null, manual_industry:null, manual_reason:null, manual_evidence_ids:[], manual_reviewed_by:null, manual_reviewed_at:null, is_target_customer: false,
      has_actionable_contact: false, evidence_complete: false, processed_at: null, updated_at: now,
    }).in("id", ids).eq("task_id", task.id).eq("decision", "REJECTED");
    if (resetCandidates.error) throw resetCandidates.error;
  }
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: screeningTaskId });
  if (refreshed.error) throw refreshed.error;
  return { inspected: candidates.length, eligible: eligibleItemIds.length, requeued: eligibleItemIds.length };
}

/** Reassess historical REVIEW rows with the current evidence, identity and
 * scoring rules. Old scores/results and channel checkpoints are invalidated:
 * REVIEW can be caused by a stale/partial Google or website fetch, so reusing
 * the old checkpoint would only recalculate the same incorrect conclusion. */
export async function requeueAcquisitionReviews(task: RequeueTask, screeningTaskId: string) {
  const admin = createAdminClient();
  let candidates: Array<{id:string;screening_task_item_id:string;staging_customer_id:string}> = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await admin.from("ai_acquisition_candidates")
      .select("id,screening_task_item_id,staging_customer_id")
      .eq("task_id", task.id).eq("screening_task_id", screeningTaskId).eq("decision", "REVIEW")
      .not("screening_task_item_id", "is", null).not("staging_customer_id", "is", null)
      .range(offset, offset + 999);
    if (page.error) throw page.error;
    candidates.push(...((page.data || []) as typeof candidates));
    if ((page.data || []).length < 1000) break;
  }
  if (!candidates.length) return { inspected: 0, requeued: 0 };
  const inspected = candidates.length;
  const customerState = new Map<string,{pool_status:string|null;acquisition_scope:string|null;deleted_at:string|null}>();
  const candidateCustomerIds = [...new Set(candidates.map((row) => String(row.staging_customer_id)))];
  for (let offset = 0; offset < candidateCustomerIds.length; offset += 100) {
    const states = await admin.from("customers").select("id,pool_status,acquisition_scope,deleted_at")
      .in("id", candidateCustomerIds.slice(offset, offset + 100));
    if (states.error) throw states.error;
    for (const row of states.data || []) customerState.set(String(row.id), row);
  }
  const alreadyPublic = candidates.filter((row) => {
    const state = customerState.get(String(row.staging_customer_id));
    return !state?.deleted_at && state?.acquisition_scope === "PUBLIC_POOL" && ["AVAILABLE", "CLAIMED"].includes(String(state?.pool_status || ""));
  });
  for (let offset = 0; offset < alreadyPublic.length; offset += 100) {
    const ids = alreadyPublic.slice(offset, offset + 100).map((row) => row.id);
    const duplicate = await admin.from("ai_acquisition_candidates").update({
      decision: "DUPLICATE", decision_reason: "该Google商家已由其他任务核验入池，本任务不重复移动或重新分析客户档案",
      processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).in("id", ids).eq("task_id", task.id).eq("decision", "REVIEW");
    if (duplicate.error) throw duplicate.error;
  }
  const publicIds = new Set(alreadyPublic.map((row) => row.id));
  candidates = candidates.filter((row) => !publicIds.has(row.id));
  if (!candidates.length) {
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: screeningTaskId });
    return { inspected, requeued: 0, deduplicated: alreadyPublic.length };
  }
  const itemIds = [...new Set(candidates.map((row) => String(row.screening_task_item_id)))];
  const customerIds = [...new Set(candidates.map((row) => String(row.staging_customer_id)))];
  const now = new Date().toISOString();
  for (let offset = 0; offset < itemIds.length; offset += 100) {
    const ids = itemIds.slice(offset, offset + 100);
    const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", ids).eq("is_latest_valid", true);
    if (invalidated.error) throw invalidated.error;
    const resetItems = await admin.from("ai_screening_task_items").update({
      status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null,
      result_id: null, progress: 0, current_step: "WAITING_REASSESSMENT", pipeline_stage: "NORMALIZED",
      channel_checkpoint: {}, checkpoint: {}, checkpoint_version: "1.0", last_completed_channel: null,
      last_checkpoint_at: null, analyzed_channels: [], skipped_channels: [], early_stop_reason: null,
      lease_owner: null, lease_token: null, lease_expires_at: null, executor_heartbeat_at: null,
      started_at: null, retry_at: null, error_message: null, error_code: null, completed_at: null,
      updated_at: now,
    }).in("id", ids).eq("task_id", screeningTaskId);
    if (resetItems.error) throw resetItems.error;
  }
  for (let offset = 0; offset < customerIds.length; offset += 100) {
    const restored = await admin.from("customers").update({
      deleted_at: null, pool_status: "AI_STAGING", acquisition_scope: "PRIVATE",
      ai_score: null, ai_level: null, ai_status: "PENDING", ai_screening_done: false, updated_at: now,
    }).in("id", customerIds.slice(offset, offset + 100));
    if (restored.error) throw restored.error;
  }
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const ids = candidates.slice(offset, offset + 100).map((row) => row.id);
    const reset = await admin.from("ai_acquisition_candidates").update({
      decision: "ANALYZING", decision_reason: "正在按现行主体、行业、证据、联系方式与评分规则重新核验",
      imported_customer_id: null, ai_score: null, ai_level: null, manual_score:null, manual_level:null, manual_target_decision:null, manual_industry:null, manual_reason:null, manual_evidence_ids:[], manual_reviewed_by:null, manual_reviewed_at:null, is_target_customer: false,
      has_actionable_contact: false, evidence_complete: false, processed_at: null, updated_at: now,
    }).in("id", ids).eq("task_id", task.id).eq("decision", "REVIEW");
    if (reset.error) throw reset.error;
  }
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: screeningTaskId });
  if (refreshed.error) throw refreshed.error;
  return { inspected, requeued: candidates.length, deduplicated: alreadyPublic.length };
}

/** Re-run historical ACCEPTED rows that no longer satisfy the current public
 * pool contract. This is deliberately limited to unclaimed, available pool
 * customers: owned customer records must never be silently moved by a repair
 * job. Valid accepted rows are not touched. */
export async function requeueInvalidAcquisitionAcceptances(task: RequeueTask, screeningTaskId: string) {
  const admin = createAdminClient();
  let candidates: Array<{id:string;screening_task_item_id:string;staging_customer_id:string;imported_customer_id:string;is_target_customer:boolean;has_actionable_contact:boolean;evidence_complete:boolean}> = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await admin.from("ai_acquisition_candidates")
      .select("id,screening_task_item_id,staging_customer_id,imported_customer_id,is_target_customer,has_actionable_contact,evidence_complete")
      .eq("task_id", task.id).eq("screening_task_id", screeningTaskId).eq("decision", "ACCEPTED")
      .not("screening_task_item_id", "is", null).not("staging_customer_id", "is", null)
      .not("imported_customer_id", "is", null)
      .range(offset, offset + 999);
    if (page.error) throw page.error;
    candidates.push(...((page.data || []) as typeof candidates));
    if ((page.data || []).length < 1000) break;
  }
  if (!candidates.length) return { inspected: 0, eligible: 0, requeued: 0, skipped_owned: 0 };

  const allImportedIds = [...new Set(candidates.map((row) => String(row.imported_customer_id)))];
  const customerState = new Map<string,{id:string;industry:string|null;pool_status:string|null;owner_id:string|null;owner_user_id:string|null;deleted_at:string|null}>();
  const actionableCustomerIds = new Set<string>();
  for (let offset = 0; offset < allImportedIds.length; offset += 100) {
    const ids = allImportedIds.slice(offset, offset + 100);
    const [states, contacts] = await Promise.all([
      admin.from("customers").select("id,industry,pool_status,owner_id,owner_user_id,deleted_at").in("id", ids),
      admin.from("customer_contacts").select("customer_id,type,verification_status,identity_match_status,contact_status,exact_source_url").in("customer_id", ids)
        .in("type", ["PHONE", "EMAIL", "WHATSAPP"]).in("verification_status", ["NEW_VERIFIED", "SOURCE_CONFIRMED", "MATCHED_ORIGINAL"]).not("exact_source_url", "is", null),
    ]);
    if (states.error || contacts.error) throw states.error || contacts.error;
    for (const row of states.data || []) customerState.set(String(row.id), row);
    for (const row of contacts.data || []) {
      if (["MATCHED", "LIKELY_MATCHED"].includes(String(row.identity_match_status || ""))
          && !["SHARED_CORPORATE", "SHARED_ACROSS_CUSTOMERS"].includes(String(row.contact_status || ""))
          && /^https?:\/\//i.test(String(row.exact_source_url || ""))) actionableCustomerIds.add(String(row.customer_id));
    }
  }
  const targetIndustries = task.industries?.length ? task.industries : [task.industry];
  const evidenceFactsByItem = new Map<string,string[]>();
  const allItemIds = [...new Set(candidates.map((row) => String(row.screening_task_item_id)).filter(Boolean))];
  for (let offset = 0; offset < allItemIds.length; offset += 100) {
    const page = await admin.from("ai_screening_evidence").select("task_item_id,translated_fact,original_excerpt")
      .in("task_item_id", allItemIds.slice(offset, offset + 100));
    if (page.error) throw page.error;
    for (const row of page.data || []) {
      const itemId = String(row.task_item_id || "");
      evidenceFactsByItem.set(itemId, [
        ...(evidenceFactsByItem.get(itemId) || []),
        String(row.translated_fact || ""),
        String(row.original_excerpt || ""),
      ].filter(Boolean));
    }
  }
  candidates = candidates.filter((row) => {
    const customerId = String(row.imported_customer_id);
    const state = customerState.get(customerId);
    return !row.is_target_customer || !row.has_actionable_contact || !row.evidence_complete
      || !actionableCustomerIds.has(customerId)
      || !acquisitionIndustryMatchesVerifiedResult(
        targetIndustries,
        state?.industry || null,
        evidenceFactsByItem.get(String(row.screening_task_item_id)) || [],
      );
  });
  if (!candidates.length) return { inspected: allImportedIds.length, eligible: 0, requeued: 0, skipped_owned: 0 };

  const importedIds = [...new Set(candidates.map((row) => String(row.imported_customer_id)))];
  const sharedAcceptedIds = new Set<string>();
  for (let offset = 0; offset < importedIds.length; offset += 100) {
    const shared = await admin.from("ai_acquisition_candidates").select("imported_customer_id")
      .in("imported_customer_id", importedIds.slice(offset, offset + 100)).eq("decision", "ACCEPTED").neq("task_id", task.id);
    if (shared.error) throw shared.error;
    for (const row of shared.data || []) sharedAcceptedIds.add(String(row.imported_customer_id));
  }
  const movableIds = new Set<string>();
  for (const customerId of importedIds) {
    const row = customerState.get(customerId);
    if (row?.pool_status === "AVAILABLE" && !row.owner_id && !row.owner_user_id && !row.deleted_at && !sharedAcceptedIds.has(customerId)) movableIds.add(customerId);
  }
  const eligible = candidates.filter((row) => movableIds.has(String(row.imported_customer_id)));
  if (!eligible.length) return { inspected: candidates.length, eligible: 0, requeued: 0, skipped_owned: candidates.length };

  const itemIds = [...new Set(eligible.map((row) => String(row.screening_task_item_id)))];
  const customerIds = [...new Set(eligible.map((row) => String(row.imported_customer_id)))];
  const now = new Date().toISOString();
  for (let offset = 0; offset < itemIds.length; offset += 100) {
    const ids = itemIds.slice(offset, offset + 100);
    const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", ids).eq("is_latest_valid", true);
    if (invalidated.error) throw invalidated.error;
    const resetItems = await admin.from("ai_screening_task_items").update({
      status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null,
      result_id: null, progress: 0, current_step: "WAITING_ACCEPTANCE_REVALIDATION", pipeline_stage: "NORMALIZED",
      channel_checkpoint: {}, checkpoint: {}, checkpoint_version: "1.0", last_completed_channel: null,
      last_checkpoint_at: null, analyzed_channels: [], skipped_channels: [], early_stop_reason: null,
      lease_owner: null, lease_token: null, lease_expires_at: null, executor_heartbeat_at: null,
      started_at: null, retry_at: null, error_message: null, error_code: null, completed_at: null,
      updated_at: now,
    }).in("id", ids).eq("task_id", screeningTaskId);
    if (resetItems.error) throw resetItems.error;
  }
  for (let offset = 0; offset < customerIds.length; offset += 100) {
    const demoted = await admin.from("customers").update({
      source: "AI_ACQUISITION_STAGING", pool_status: "AI_STAGING", acquisition_scope: "PRIVATE",
      ai_score: null, ai_level: null, ai_score_source:null, ai_status: "PENDING", ai_screening_done: false, updated_at: now,
    }).in("id", customerIds.slice(offset, offset + 100)).eq("pool_status", "AVAILABLE").is("owner_id", null).is("owner_user_id", null);
    if (demoted.error) throw demoted.error;
  }
  for (let offset = 0; offset < eligible.length; offset += 100) {
    const ids = eligible.slice(offset, offset + 100).map((row) => row.id);
    const reset = await admin.from("ai_acquisition_candidates").update({
      decision: "ANALYZING", decision_reason: "历史入池记录不满足现行行业、证据或可追溯联系方式门槛，正在重新核验",
      imported_customer_id: null, ai_score: null, ai_level: null, manual_score:null, manual_level:null, manual_target_decision:null, manual_industry:null, manual_reason:null, manual_evidence_ids:[], manual_reviewed_by:null, manual_reviewed_at:null, is_target_customer: false,
      has_actionable_contact: false, evidence_complete: false, processed_at: null, updated_at: now,
    }).in("id", ids).eq("task_id", task.id).eq("decision", "ACCEPTED");
    if (reset.error) throw reset.error;
  }
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: screeningTaskId });
  if (refreshed.error) throw refreshed.error;
  return { inspected: candidates.length, eligible: eligible.length, requeued: eligible.length, skipped_owned: candidates.length - eligible.length, skipped_shared: sharedAcceptedIds.size };
}
