import { start } from "workflow/api";
import { createAdminClient } from "../supabase/admin";
import { aiScreeningWorkflow } from "../../workflows/ai-screening";
import type { AiDispatchPolicy, AiExecutionMode, AiStrategy } from "./task-types";

export async function dispatchAiScreeningTask(input: {
  taskId: string;
  strategy: AiStrategy;
  scheduledAt?: string | null;
  executionMode: AiExecutionMode;
  dispatchPolicy?: AiDispatchPolicy;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const dispatchPolicy = input.dispatchPolicy || (input.executionMode === "LOCAL_ONLY" ? "LOCAL_ONLY" : input.executionMode === "VERCEL_ONLY" ? "VERCEL_ONLY" : "LOCAL_FIRST");
  let localHealthy = false;
  if (dispatchPolicy !== "VERCEL_ONLY") {
    const health = await admin.rpc("has_healthy_ai_worker", { p_max_age_seconds: 45 });
    if (health.error) throw health.error;
    localHealthy = Boolean(health.data);
  }
  const preferLocal = dispatchPolicy === "LOCAL_ONLY"
    || (dispatchPolicy === "LOCAL_FIRST" && localHealthy);
  if (preferLocal) {
    const update = await admin.from("ai_screening_tasks").update({
      execution_mode: dispatchPolicy === "LOCAL_ONLY" ? "LOCAL_ONLY" : "AUTO",
      active_executor: "LOCAL_NODE", last_dispatch_at: now, dispatch_error: null, updated_at: now,
    }).eq("id", input.taskId);
    if (update.error) throw update.error;
    return { executor: "LOCAL_NODE" as const, runId: null };
  }
  // Once a hybrid policy has selected the cloud path, lock this task to the
  // cloud claim until Workflow either finishes or explicitly hands it back.
  // Otherwise a polling local worker could race the Workflow for the same
  // queued item while execution_mode is still AUTO.
  if (dispatchPolicy === "LOCAL_FIRST") {
    const cloudLock = await admin.from("ai_screening_tasks").update({
      execution_mode: "VERCEL_ONLY",
      active_executor: "VERCEL_WORKFLOW",
      last_dispatch_at: now,
      dispatch_error: null,
      updated_at: now,
    }).eq("id", input.taskId);
    if (cloudLock.error) throw cloudLock.error;
  }
  try {
    const run = await start(aiScreeningWorkflow, [{ taskId: input.taskId, strategy: input.strategy, scheduledAt: input.scheduledAt }]);
    const update = await admin.from("ai_screening_tasks").update({
      workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: now,
      dispatch_error: null, updated_at: now,
    }).eq("id", input.taskId);
    if (update.error) throw update.error;
    return { executor: "VERCEL_WORKFLOW" as const, runId: run.runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "云端调度失败";
    await admin.from("ai_screening_tasks").update({ active_executor: null, last_dispatch_at: now, dispatch_error: message.slice(0, 1000), updated_at: now }).eq("id", input.taskId);
    // Hybrid policies may fall back to a live local worker. Relaxing the claim
    // mode happens only after cloud startup failed, preventing a dual claim.
    if (["VERCEL_FIRST", "LOCAL_FIRST"].includes(dispatchPolicy)) {
      await admin.from("ai_screening_tasks").update({
        execution_mode: "AUTO",
        active_executor: localHealthy ? "LOCAL_NODE" : null,
        last_dispatch_at: now,
        dispatch_error: message.slice(0, 1000),
        updated_at: now,
      }).eq("id", input.taskId);
      return { executor: localHealthy ? "LOCAL_NODE" as const : null, runId: null, warning: message };
    }
    throw error;
  }
}

export async function rescueStalledAutomaticTasks() {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_stalled_ai_tasks_for_vercel", { p_limit: 3 });
  if (claimed.error) throw claimed.error;
  for (const task of claimed.data || []) {
    try {
      const run = await start(aiScreeningWorkflow, [{ taskId: task.task_id, strategy: task.strategy as AiStrategy, scheduledAt: null }]);
      await admin.from("ai_screening_tasks").update({
        workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", dispatch_error: null, updated_at: new Date().toISOString(),
      }).eq("id", task.task_id).eq("active_executor", "VERCEL_DISPATCHING");
    } catch (error) {
      const message = error instanceof Error ? error.message : "云端接管失败";
      await admin.from("ai_screening_tasks").update({ active_executor: null, dispatch_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", task.task_id).eq("active_executor", "VERCEL_DISPATCHING");
    }
  }
}
