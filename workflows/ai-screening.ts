import { sleep } from "workflow";
import { createAdminClient } from "../lib/supabase/admin";
import { runCustomerAnalysis, publicAiError } from "../lib/ai/run-customer-analysis";
import type { AiStrategy } from "../lib/ai/task-types";

type WorkflowInput = {
  taskId: string;
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

async function settlePause(taskId: string) {
  "use step";
  const admin = createAdminClient();
  await admin.from("ai_screening_tasks").update({ status: "PAUSED", updated_at: new Date().toISOString() }).eq("id", taskId).eq("status", "PAUSING");
}

async function nextPendingItems(taskId: string, limit: number) {
  "use step";
  const admin = createAdminClient();
  const { data, error } = await admin.from("ai_screening_task_items")
    .select("id")
    .eq("task_id", taskId)
    .eq("status", "PENDING")
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((item) => item.id);
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
    return await runCustomerAnalysis({
      taskId, taskItemId: itemId, customerId: claim.data.customer_id, strategy,
      attemptNumber: Number(claim.data.attempt_count || 0) + 1,
    });
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
  const concurrency = Math.min(8, Math.max(1, Number(process.env.AI_SCREENING_CONCURRENCY || 3)));
  while (true) {
    let state = await taskState(input.taskId);
    if (state.status === "PAUSING") {
      await settlePause(input.taskId);
      state = await taskState(input.taskId);
    }
    while (state.status === "PAUSED" || state.status === "PAUSING") {
      await sleep("10s");
      state = await taskState(input.taskId);
      if (state.status === "PAUSING") {
        await settlePause(input.taskId);
        state = await taskState(input.taskId);
      }
    }
    if (state.status === "CANCELLED" || state.cancelRequested) break;
    const batch = await nextPendingItems(input.taskId, concurrency);
    if (!batch.length) break;
    await Promise.all(batch.map((itemId) => analyzeTaskItem(input.taskId, itemId, input.strategy)));
    state = await taskState(input.taskId);
    if (state.status === "PAUSING") await settlePause(input.taskId);
  }
  await finishTask(input.taskId);
  return { status: "FINISHED" };
}
