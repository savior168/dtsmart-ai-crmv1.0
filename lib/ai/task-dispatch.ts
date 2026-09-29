import { start } from "workflow/api";
import { createAdminClient } from "../supabase/admin";
import { aiScreeningWorkflow } from "../../workflows/ai-screening";
import { AI_CLOUD_DISPATCH_POLICY, AI_CLOUD_EXECUTION_MODE, type AiDispatchPolicy, type AiExecutionMode, type AiStrategy } from "./task-types";

async function reconcileTerminalScreeningTask(admin: ReturnType<typeof createAdminClient>, taskId: string, signal?: AbortSignal) {
  const requestSignal = signal || new AbortController().signal;
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId }).abortSignal(requestSignal);
  if (refreshed.error) throw refreshed.error;
  const state = await admin.from("ai_screening_tasks")
    .select("request_key,status,total_count,pending_count,success_count,failed_count,elapsed_ms,started_at")
    .eq("id", taskId).abortSignal(requestSignal).single();
  if (state.error) throw state.error;
  if (!state.data || !["QUEUED", "RUNNING"].includes(state.data.status)) return false;
  const total = Number(state.data.total_count || 0);
  if (total < 1 || Number(state.data.pending_count || 0) !== 0
      || Number(state.data.success_count || 0) + Number(state.data.failed_count || 0) !== total) return false;

  const acquisitionId = /^acquisition:([0-9a-f-]{36})$/i.exec(String(state.data.request_key || ""))?.[1];
  if (acquisitionId) {
    const parent = await admin.from("ai_acquisition_tasks").select("status,current_stage")
      .eq("id", acquisitionId).abortSignal(requestSignal).single();
    if (parent.error) throw parent.error;
    // The producer may still append candidates while discovery is in flight.
    if (!["VERIFYING", "FINALIZING", "FINISHED"].includes(String(parent.data.current_stage || ""))) return false;
  }

  const now = new Date();
  const started = state.data.started_at ? new Date(state.data.started_at).getTime() : NaN;
  const elapsed = Number(state.data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const saved = await admin.from("ai_screening_tasks").update({
    status: "COMPLETED", completed_at: now.toISOString(), finished_at: now.toISOString(),
    elapsed_ms: elapsed, active_executor: null, executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", taskId).eq("active_executor", "VERCEL_DISPATCHING")
    .in("status", ["QUEUED", "RUNNING"]).eq("pending_count", 0)
    .abortSignal(requestSignal).select("id");
  if (saved.error) throw saved.error;
  return Boolean(saved.data?.length);
}

export async function dispatchAiScreeningTask(input: {
  taskId: string;
  strategy: AiStrategy;
  scheduledAt?: string | null;
  executionMode: AiExecutionMode;
  dispatchPolicy?: AiDispatchPolicy;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const reservation = await admin.rpc("reserve_ai_cloud_task_dispatch", { p_task_id: input.taskId });
  if (reservation.error) throw reservation.error;
  if (!reservation.data) return { executor: "VERCEL_WORKFLOW" as const, runId: null, deduplicated: true };
  let run: Awaited<ReturnType<typeof start>>;
  try {
    run = await start(aiScreeningWorkflow, [{ taskId: input.taskId, strategy: input.strategy, scheduledAt: input.scheduledAt }]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "云端调度失败";
    await admin.from("ai_screening_tasks").update({ active_executor: null, last_dispatch_at: now, dispatch_error: message.slice(0, 1000), updated_at: now }).eq("id", input.taskId).eq("active_executor", "VERCEL_DISPATCHING");
    throw error;
  }
  const update = await admin.from("ai_screening_tasks").update({
      execution_mode: AI_CLOUD_EXECUTION_MODE, dispatch_policy: AI_CLOUD_DISPATCH_POLICY,
      workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: now,
      dispatch_error: null, updated_at: now,
  }).eq("id", input.taskId).eq("active_executor", "VERCEL_DISPATCHING");
  if (update.error) {
    // start() already succeeded. Keep the reservation so a user retry or page
    // refresh cannot start a second, paid workflow while this run is active.
    await admin.from("ai_screening_tasks").update({
      dispatch_error: `云端运行已启动，但运行编号写回失败：${update.error.message}`.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskId).eq("active_executor", "VERCEL_DISPATCHING");
    throw update.error;
  }
  return { executor: "VERCEL_WORKFLOW" as const, runId: run.runId };
}

// This is deliberately an atomic, cloud-only rescue. Listing the task page
// may check for stalled tasks, but a Workflow is started only after the
// database has exclusively marked one task as VERCEL_DISPATCHING.
export async function rescueStalledCloudTasks(signal?: AbortSignal, excludedTaskIds: string[] = []) {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_stalled_ai_tasks_for_vercel_excluding", {
    p_limit: 1, p_excluded_task_ids: excludedTaskIds,
  }).abortSignal(signal || new AbortController().signal);
  if (claimed.error) throw claimed.error;
  let recovered = 0;
  for (const task of claimed.data || []) {
    let run: Awaited<ReturnType<typeof start>>;
    try {
      if (await reconcileTerminalScreeningTask(admin, String(task.task_id), signal)) {
        recovered += 1;
        continue;
      }
      run = await start(aiScreeningWorkflow, [{ taskId: task.task_id, strategy: task.strategy as AiStrategy, scheduledAt: null }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "云端恢复调度失败";
      await admin.from("ai_screening_tasks").update({
        active_executor: null, dispatch_error: message.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq("id", task.task_id).eq("active_executor", "VERCEL_DISPATCHING");
      continue;
    }
    const update = await admin.from("ai_screening_tasks").update({
        execution_mode: AI_CLOUD_EXECUTION_MODE, dispatch_policy: AI_CLOUD_DISPATCH_POLICY,
        workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", dispatch_error: null, updated_at: new Date().toISOString(),
    }).eq("id", task.task_id).eq("active_executor", "VERCEL_DISPATCHING");
    if (update.error) {
      await admin.from("ai_screening_tasks").update({
        dispatch_error: `云端恢复运行已启动，但运行编号写回失败：${update.error.message}`.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq("id", task.task_id).eq("active_executor", "VERCEL_DISPATCHING");
    } else {
      recovered += 1;
    }
  }
  return recovered;
}
