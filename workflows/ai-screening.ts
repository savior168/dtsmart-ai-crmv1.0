import { sleep } from "workflow";
import { createAdminClient } from "../lib/supabase/admin";
import { runCustomerAnalysis, publicAiError } from "../lib/ai/run-customer-analysis";
import type { AiStrategy } from "../lib/ai/task-types";
import { normalizeError } from "../lib/ai/error-normalization";

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
  const startedAt = Date.now();
  const admin = createAdminClient();
  const claim = await admin.from("ai_screening_task_items").update({
    status: "RUNNING", analysis_status: "RUNNING", writeback_status: "PENDING",
    progress: 5, current_step: "COLLECTING_EVIDENCE", pipeline_stage: "COLLECTING_EVIDENCE",
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
    const raw = error instanceof Error ? error.message : String(error || "");
    if (raw.includes("OPENAI_NOT_CONFIGURED") || /OPENAI_API_ERROR:\s*(401|403)\b/.test(raw)) throw error;
    const durable = await admin.from("ai_screening_task_items")
      .select("analysis_status,writeback_status,result_id")
      .eq("id", itemId)
      .maybeSingle();
    if (durable.error) throw durable.error;
    if (durable.data?.analysis_status === "COMPLETED" && durable.data?.writeback_status === "COMPLETED" && durable.data?.result_id) {
      const warning = normalizeError(error, { stage: "POST_ANALYSIS_WRITEBACK", attemptNumber: Number(claim.data.attempt_count || 0) + 1, durationMs: Date.now() - startedAt });
      const writeback = await admin.from("ai_screening_task_items").update({
        status: "COMPLETED",
        analysis_status: "COMPLETED",
        writeback_status: "WARNING",
        current_step: "COMPLETED_WITH_WRITEBACK_WARNING",
        error_context: { writeback_warnings: [warning] },
        writeback_warning_count: 1,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", itemId);
      if (writeback.error) throw writeback.error;
      await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
      return { status: "COMPLETED" as const, writebackWarning: warning };
    }
    const failure = publicAiError(error);
    const normalized = normalizeError(error, { stage: "ANALYSIS", attemptNumber: Number(claim.data.attempt_count || 0) + 1, durationMs: Date.now() - startedAt });
    await admin.from("ai_screening_task_items").update({
      status: "FAILED", analysis_status: "FAILED", writeback_status: "NOT_STARTED",
      automation_status: "ANALYSIS_FAILED", progress: 100, current_step: "FAILED", pipeline_stage: "FAILED", error_code: failure.code,
      error_message: failure.message, retryable: true,
      error_context: normalized,
      duration_ms: Date.now() - startedAt,
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
  const refreshed = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId });
  if (refreshed.error) throw refreshed.error;
  const { data, error } = await admin.from("ai_screening_tasks").select("pending_count,status,elapsed_ms,started_at").eq("id", taskId).single();
  if (error) throw error;
  if (!data || ["CANCELLED", "PAUSED"].includes(String(data.status))) return;
  // A workflow can only report completion after every item reached a terminal
  // state. Reviews are terminal outcomes, not a hidden pending queue.
  if (Number(data.pending_count || 0) > 0) return;
  const now = new Date();
  const started = data.started_at ? new Date(data.started_at).getTime() : NaN;
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now.getTime() - started) : Number(data.elapsed_ms || 0);
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
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now.getTime() - started) : Number(data.elapsed_ms || 0);
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
