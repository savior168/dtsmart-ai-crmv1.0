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
  const now = new Date().toISOString();
  const current = await admin.from("ai_screening_tasks").select("started_at").eq("id", taskId).single();
  if (current.error) throw current.error;
  const updated = await admin.from("ai_screening_tasks").update({ status: "RUNNING", started_at: current.data.started_at || now, finished_at: null, updated_at: now }).eq("id", taskId).in("status", ["QUEUED", "PENDING", "RUNNING"]);
  if (updated.error) throw updated.error;
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
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const analysis = runCustomerAnalysis({
      taskId, taskItemId: itemId, customerId: claim.data.customer_id, strategy,
      attemptNumber: Number(claim.data.attempt_count || 0) + 1,
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("CUSTOMER_ANALYSIS_TIMEOUT")), 30_000);
    });
    return await Promise.race([analysis, deadline]);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error || "");
    if (raw.includes("OPENAI_NOT_CONFIGURED") || /OPENAI_API_ERROR:\s*(401|403)\b/.test(raw)) throw error;
    const failure = publicAiError(error);
    await admin.from("ai_screening_task_items").update({
      status: "FAILED", automation_status: "ANALYSIS_FAILED", progress: 100, current_step: "FAILED", error_code: failure.code,
      error_message: failure.message, retryable: true, duration_ms: 30_000,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", itemId);
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
    return { status: "FAILED" as const, error: failure };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
analyzeTaskItem.maxRetries = 0;

async function finishTask(taskId: string) {
  "use step";
  const admin = createAdminClient();
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
  if (refreshed.error) throw refreshed.error;
  const { data, error } = await admin.from("ai_screening_tasks").select("failed_count,status,elapsed_ms,started_at").eq("id", taskId).single();
  if (error) throw error;
  if (!data || ["CANCELLED", "PAUSED"].includes(String(data.status))) return;
  const now = new Date();
  const started = data.started_at ? new Date(data.started_at).getTime() : NaN;
  const elapsedMs = Number(data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const completed = await admin.from("ai_screening_tasks").update({
    status: "COMPLETED",
    completed_at: now.toISOString(), finished_at: now.toISOString(),
    elapsed_ms: elapsedMs, updated_at: now.toISOString(),
  }).eq("id", taskId);
  if (completed.error) throw completed.error;
}

async function failTask(taskId: string, errorMessage: string) {
  "use step";
  const admin = createAdminClient();
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
  if (refreshed.error) throw refreshed.error;
  const { data, error } = await admin.from("ai_screening_tasks").select("status,elapsed_ms,started_at").eq("id", taskId).single();
  if (error) throw error;
  if (!data || ["CANCELLED", "PAUSED"].includes(String(data.status))) return;
  const now = new Date();
  const started = data.started_at ? new Date(data.started_at).getTime() : NaN;
  const elapsedMs = Number(data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const failed = await admin.from("ai_screening_tasks").update({
    status: "FAILED", finished_at: now.toISOString(),
    elapsed_ms: elapsedMs, error_message: errorMessage.slice(0, 1000), updated_at: now.toISOString(),
  }).eq("id", taskId);
  if (failed.error) throw failed.error;
}

export async function aiScreeningWorkflow(input: WorkflowInput) {
  "use workflow";
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务级AI执行异常";
    await failTask(input.taskId, message);
    return { status: "FAILED", error: message };
  }
}
