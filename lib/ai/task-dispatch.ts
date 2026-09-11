import { start } from "workflow/api";
import { createAdminClient } from "../supabase/admin";
import { aiScreeningWorkflow } from "../../workflows/ai-screening";
import { AI_CLOUD_DISPATCH_POLICY, AI_CLOUD_EXECUTION_MODE, type AiDispatchPolicy, type AiExecutionMode, type AiStrategy } from "./task-types";

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
export async function rescueStalledCloudTasks() {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_stalled_ai_tasks_for_vercel", { p_limit: 3 });
  if (claimed.error) throw claimed.error;
  for (const task of claimed.data || []) {
    let run: Awaited<ReturnType<typeof start>>;
    try {
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
    }
  }
}
