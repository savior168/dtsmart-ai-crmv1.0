import { createAdminClient } from "@/lib/supabase/admin";

const CACHE_BATCH_SIZE = 400;
const CHECKPOINT_BATCH_SIZE = 100;
const CACHE_GRACE_MS = 24 * 60 * 60 * 1000;
const CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Each invocation has a hard ceiling; the next daily run continues the backlog. */
export async function cleanExpiredAiData(now = new Date()) {
  const admin = createAdminClient();
  const cacheCutoff = new Date(now.getTime() - CACHE_GRACE_MS).toISOString();
  const checkpointCutoff = new Date(now.getTime() - CHECKPOINT_RETENTION_MS).toISOString();

  const expired = await admin.from("ai_analysis_reuse_cache")
    .select("id")
    .lt("expires_at", cacheCutoff)
    .order("expires_at", { ascending: true })
    .limit(CACHE_BATCH_SIZE);
  if (expired.error) throw expired.error;
  const expiredIds = (expired.data || []).map((row) => row.id);
  if (expiredIds.length) {
    const deleted = await admin.from("ai_analysis_reuse_cache")
      .delete()
      .in("id", expiredIds)
      .lt("expires_at", cacheCutoff)
      .select("id");
    if (deleted.error) throw deleted.error;
    if ((deleted.data || []).length !== expiredIds.length) {
      throw new Error("AI_CACHE_CLEANUP_COUNT_CHANGED");
    }
  }

  // Only completed tasks are eligible. Keep checkpoint rows, statuses, counts
  // and scope keys so reports and incremental-search deduplication still work.
  let clearedCheckpoints = 0;
  const checkpoints = await admin.from("ai_acquisition_discovery_checkpoints")
    .select("task_id,country,query_text,task:ai_acquisition_tasks!inner(status,finished_at)")
    .eq("task.status", "COMPLETED")
    .lt("task.finished_at", checkpointCutoff)
    .neq("results", "[]")
    .limit(CHECKPOINT_BATCH_SIZE);
  if (checkpoints.error) throw checkpoints.error;
  const checkpointRows = checkpoints.data || [];
  for (let offset = 0; offset < checkpointRows.length; offset += 8) {
    const results = await Promise.all(checkpointRows.slice(offset, offset + 8).map((checkpoint) => admin.from("ai_acquisition_discovery_checkpoints")
        .update({ results: [], next_page_token: null })
        .eq("task_id", checkpoint.task_id)
        .eq("country", checkpoint.country)
        .eq("query_text", checkpoint.query_text)
        .neq("results", "[]")
        .select("task_id")));
    for (const cleared of results) {
      if (cleared.error) throw cleared.error;
      clearedCheckpoints += (cleared.data || []).length;
    }
  }
  return { deletedCacheRows: expiredIds.length, clearedCheckpoints };
}
