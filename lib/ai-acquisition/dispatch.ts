import { start } from "workflow/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";

function maintenancePausedTaskIds() {
  return new Set(
    (process.env.AI_MAINTENANCE_PAUSED_ACQUISITION_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)),
  );
}

async function settleStalePausingTasks(admin: ReturnType<typeof createAdminClient>, signal?: AbortSignal) {
  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  const stale = await admin.from("ai_acquisition_tasks")
    .select("id,started_at,elapsed_ms,pause_started_at")
    .eq("status", "PAUSING")
    .or(`executor_heartbeat_at.is.null,executor_heartbeat_at.lt.${cutoff}`)
    .order("updated_at", { ascending: true })
    // Keep each cron invocation bounded. A cron runs every minute, so settling
    // two abandoned pauses per pass is faster and safer than holding database
    // connections while serially updating a large backlog.
    .limit(2)
    .abortSignal(signal || new AbortController().signal);
  if (stale.error) throw stale.error;
  let settled = 0;
  for (const task of stale.data || []) {
    const now = new Date();
    const startedAt = task.started_at ? new Date(task.started_at).getTime() : NaN;
    const pausedAt = task.pause_started_at ? new Date(task.pause_started_at).getTime() : now.getTime();
    const elapsed = Number(task.elapsed_ms || 0) + (Number.isFinite(startedAt) ? Math.max(0, pausedAt - startedAt) : 0);
    const saved = await admin.from("ai_acquisition_tasks").update({
      status: "PAUSED", current_stage_detail: "任务已在安全检查点暂停，等待人工继续执行",
      elapsed_ms: elapsed, started_at: null, pause_started_at: task.pause_started_at || now.toISOString(),
      active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null,
      error_message: null, updated_at: now.toISOString(),
    }).eq("id", task.id).eq("status", "PAUSING").select("id").abortSignal(signal || new AbortController().signal).maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) continue;
    const child = await admin.from("ai_screening_tasks").update({
      status: "PAUSED", active_executor: null, workflow_run_id: null, last_dispatch_at: null,
      executor_heartbeat_at: null, updated_at: now.toISOString(),
    }).eq("request_key", `acquisition:${task.id}`).in("status", ["QUEUED", "RUNNING", "PAUSING"]).abortSignal(signal || new AbortController().signal);
    if (child.error) throw child.error;
    settled += 1;
  }
  return settled;
}

async function reconcileCompletedAcquisitionTask(admin: ReturnType<typeof createAdminClient>, taskId: string, signal?: AbortSignal) {
  const child = await admin.from("ai_screening_tasks").select("id,status").eq("request_key", `acquisition:${taskId}`).abortSignal(signal || new AbortController().signal).maybeSingle();
  if (child.error) throw child.error;
  if (child.data?.status !== "COMPLETED") return false;
  const analyzing = await admin.from("ai_acquisition_candidates").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("decision", "ANALYZING").abortSignal(signal || new AbortController().signal);
  if (analyzing.error) throw analyzing.error;
  if (Number(analyzing.count || 0) > 0) return false;
  const count = async (decision: string) => {
    const result = await admin.from("ai_acquisition_candidates").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("decision", decision).abortSignal(signal || new AbortController().signal);
    if (result.error) throw result.error;
    return Number(result.count || 0);
  };
  const [accepted, review, rejected, duplicate] = await Promise.all([count("ACCEPTED"), count("REVIEW"), count("REJECTED"), count("DUPLICATE")]);
  const now = new Date().toISOString();
  const saved = await admin.from("ai_acquisition_tasks").update({
    status: "COMPLETED", current_stage: "FINISHED", current_stage_detail: "候选发现、核验、去重和准入判定均已完成",
    processed_count: accepted + review + rejected + duplicate, accepted_count: accepted, review_count: review,
    rejected_count: rejected, duplicate_count: duplicate, started_at: null, finished_at: now,
    active_executor: null, executor_heartbeat_at: now, error_message: null, updated_at: now,
  }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING").abortSignal(signal || new AbortController().signal);
  if (saved.error) throw saved.error;
  return true;
}

export async function rescueStalledAiAcquisitionTasks(signal?: AbortSignal) {
  const admin = createAdminClient();
  const maintenancePausedIds = maintenancePausedTaskIds();
  let recovered = await settleStalePausingTasks(admin, signal);
  console.info("[ai-acquisition-recovery] stale pause settlement completed", { settled: recovered });
  const claimed = await admin.rpc("claim_stalled_ai_acquisition_tasks", { p_limit: 1 }).abortSignal(signal || new AbortController().signal);
  if (claimed.error) throw claimed.error;
  for (const row of claimed.data || []) {
    const taskId = String(row.task_id || "");
    if (!taskId) continue;
    try {
      const state = await admin.from("ai_acquisition_tasks").select("status,cancel_requested,current_stage_detail").eq("id", taskId).abortSignal(signal || new AbortController().signal).single();
      if (state.error) throw state.error;
      const maintenanceProtected = maintenancePausedIds.has(taskId)
        && String(state.data.current_stage_detail || "").includes("系统维护暂停");
      if (maintenanceProtected || state.data.status === "PAUSING" || state.data.cancel_requested) {
        await admin.from("ai_acquisition_tasks").update({ status: state.data.cancel_requested ? "CANCELLED" : "PAUSED", active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: new Date().toISOString() }).eq("id", taskId);
        continue;
      }
      if (await reconcileCompletedAcquisitionTask(admin, taskId, signal)) {
        recovered += 1;
        continue;
      }
      const run = await start(aiAcquisitionWorkflow, [taskId]);
      const saved = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING");
      if (saved.error) throw saved.error;
      recovered += 1;
    } catch (error) {
      await admin.from("ai_acquisition_tasks").update({ active_executor: null, error_message: (error instanceof Error ? error.message : "获客任务恢复失败").slice(0,1000), updated_at: new Date().toISOString() }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING");
    }
  }
  return recovered;
}
