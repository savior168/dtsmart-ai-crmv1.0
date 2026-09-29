import { createAdminClient } from "@/lib/supabase/admin";

const decisions = ["ACCEPTED", "REVIEW", "REJECTED", "DUPLICATE"] as const;

/** Count current candidate decisions without fetching a capped page of rows. */
export async function countAcquisitionCandidateDecisions(admin: ReturnType<typeof createAdminClient>, taskId: string) {
  const counts = await Promise.all(decisions.map(async (decision) => {
    const result = await admin.from("ai_acquisition_candidates")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId).eq("decision", decision);
    if (result.error) throw result.error;
    return Number(result.count || 0);
  }));
  return {
    accepted_count: counts[0],
    review_count: counts[1],
    rejected_count: counts[2],
    duplicate_count: counts[3],
  };
}
