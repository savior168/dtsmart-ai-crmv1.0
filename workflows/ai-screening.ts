import { sleep } from "workflow";
import { createAdminClient } from "../lib/supabase/admin";
import { runCustomerAnalysis, publicAiError } from "../lib/ai/run-customer-analysis";
import type { AiStrategy } from "../lib/ai/task-types";

type WorkflowInput = {
  taskId: string;
  itemIds: string[];
  strategy: AiStrategy;
  scheduledAt?: string | null;
};

async function taskState(taskId: string) {
  "use step";
  const admin = createAdminClient();
  const { data, error } = await admin.from("ai_screening_tasks").select("status,cancel_requested").eq("id", taskId).single();
  if (error || !data) throw error || new Error("TASK_NOT_FOUND");
  return { status: String(data.status), cancelRequested: Boolean(data.cancel_requested) };
}

async function beginTask(taskId: string) {
  "use step";
  const admin = createAdminClient();
  await admin.from("ai_screening_tasks").update({ status: "RUNNING", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", taskId).in("status", ["QUEUED", "PENDING", "RUNNING"]);
}

async function analyzeTaskItem(taskId: string, itemId: string, strategy: AiStrategy) {
  "use step";
  const admin = createAdminClient();
  const claim = await admin.from("ai_screening_task_items").update({
    status: "RUNNING", progress: 5, current_step: "COLLECTING_EVIDENCE",
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", itemId).in("status", ["PENDING", "FAILED"]).select("id,customer_id,attempt_count").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return { status: "SKIPPED" as const };
  await admin.from("ai_screening_task_items").update({ attempt_count: Number(claim.data.attempt_count || 0) + 1 }).eq("id", itemId);
  try {
    return await runCustomerAnalysis({ taskId, taskItemId: itemId, customerId: claim.data.customer_id, strategy });
  } catch (error) {
    const failure = publicAiError(error);
    await admin.from("ai_screening_task_items").update({
      status: "FAILED", progress: 100, current_step: "FAILED", error_code: failure.code,
      error_message: failure.message, retryable: true, duration_ms: 30_000,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", itemId);
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
    return { status: "FAILED" as const, error: failure };
  }
}
analyzeTaskItem.maxRetries = 0;

async function finishTask(taskId: string) {
  "use step";
  const admin = createAdminClient();
  await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
  const { data } = await admin.from("ai_screening_tasks").select("failed_count,status").eq("id", taskId).single();
  if (!data || ["CANCELLED", "PAUSED"].includes(String(data.status))) return;
  await admin.from("ai_screening_tasks").update({
    status: Number(data.failed_count || 0) > 0 ? "FAILED" : "COMPLETED",
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", taskId);
}

export async function aiScreeningWorkflow(input: WorkflowInput) {
  "use workflow";
  if (input.scheduledAt && new Date(input.scheduledAt).getTime() > Date.now()) await sleep(new Date(input.scheduledAt));
  const initial = await taskState(input.taskId);
  if (initial.status === "CANCELLED" || initial.cancelRequested) return { status: "CANCELLED" };
  await beginTask(input.taskId);
  for (const itemId of input.itemIds) {
    let state = await taskState(input.taskId);
    while (state.status === "PAUSED") {
      await sleep("10s");
      state = await taskState(input.taskId);
    }
    if (state.status === "CANCELLED" || state.cancelRequested) break;
    await analyzeTaskItem(input.taskId, itemId, input.strategy);
  }
  await finishTask(input.taskId);
  return { status: "FINISHED" };
}
