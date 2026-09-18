import { createAdminClient } from "@/lib/supabase/admin";
import { discoveryCandidateLooksRelevant, type DiscoveryRelevanceCandidate } from "./relevance";

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
