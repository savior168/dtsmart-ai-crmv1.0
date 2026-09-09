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

function isTransientFetchFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /(?:fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)/i.test(message);
}

async function withTransientFetchRetry<T>(operation: () => PromiseLike<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!isTransientFetchFailure(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function taskState(taskId: string) {
  "use step";
  const admin = createAdminClient();
  const { data, error } = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").select("status,cancel_requested").eq("id", taskId).single());
  if (error || !data) throw error || new Error("TASK_NOT_FOUND");
  return { status: String(data.status), cancelRequested: Boolean(data.cancel_requested) };
}

async function beginTask(taskId: string) {
  "use step";
  const admin = createAdminClient();
  const now = new Date().toISOString();
  // elapsed_ms already contains previous active intervals after pause/retry.
  // Always start a fresh interval here to avoid counting old time twice.
  const updated = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").update({ status: "RUNNING", started_at: now, finished_at: null, updated_at: now }).eq("id", taskId).in("status", ["QUEUED", "PENDING", "RUNNING"]));
  if (updated.error) throw updated.error;
}

async function settlePause(taskId: string) {
  "use step";
  const admin = createAdminClient();
  const current = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").select("elapsed_ms,started_at").eq("id", taskId).single());
  if (current.error) throw current.error;
  const now = new Date();
  const started = current.data.started_at ? new Date(current.data.started_at).getTime() : NaN;
  const elapsedMs = Number(current.data.elapsed_ms || 0)
    + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const paused = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").update({
    status: "PAUSED", started_at: null, elapsed_ms: elapsedMs,
    pause_started_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("id", taskId).eq("status", "PAUSING"));
  if (paused.error) throw paused.error;
}

async function nextPendingItems(taskId: string, limit: number) {
  "use step";
  const admin = createAdminClient();
  const { data, error } = await withTransientFetchRetry(() => admin.from("ai_screening_task_items")
    .select("id")
    .eq("task_id", taskId)
    .eq("status", "PENDING")
    // Finish never-attempted customers before returning to slow evidence
    // recovery rows. A small number of difficult customers must not occupy
    // every worker slot while the rest of the task is still untouched.
    .order("attempt_count", { ascending: true })
    // ai_screening_task_items has no created_at column in production. New
    // items share their initial updated_at, while every retry receives a later
    // updated_at, so this preserves FIFO order without querying a phantom
    // column and still keeps slow retries behind untouched rows.
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit));
  if (error) {
    console.error("[ai-screening] pending queue query failed", {
      taskId,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }
  return (data || []).map((item) => item.id);
}

async function hasPendingItems(taskId: string) {
  "use step";
  const admin = createAdminClient();
  const { count, error } = await withTransientFetchRetry(() => admin.from("ai_screening_task_items")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("status", "PENDING"));
  if (error) throw error;
  return Number(count || 0) > 0;
}

async function analyzeTaskItem(taskId: string, itemId: string, strategy: AiStrategy) {
  "use step";
  const startedAt = Date.now();
  const admin = createAdminClient();
  const claim = await withTransientFetchRetry(() => admin.from("ai_screening_task_items").update({
    status: "RUNNING", analysis_status: "RUNNING", writeback_status: "PENDING",
    progress: 5, current_step: "COLLECTING_EVIDENCE", pipeline_stage: "COLLECTING_EVIDENCE",
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", itemId).in("status", ["PENDING", "FAILED"]).select("id,customer_id,attempt_count").maybeSingle());
  if (claim.error) throw claim.error;
  if (!claim.data) return { status: "SKIPPED" as const };
  const claimedItem = claim.data;
  const attemptWrite = await withTransientFetchRetry(() => admin.from("ai_screening_task_items").update({ attempt_count: Number(claimedItem.attempt_count || 0) + 1 }).eq("id", itemId));
  if (attemptWrite.error) throw attemptWrite.error;
  try {
    return await runCustomerAnalysis({
      taskId, taskItemId: itemId, customerId: claimedItem.customer_id, strategy,
      attemptNumber: Number(claimedItem.attempt_count || 0) + 1,
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
      const warning = normalizeError(error, { stage: "POST_ANALYSIS_WRITEBACK", attemptNumber: Number(claimedItem.attempt_count || 0) + 1, durationMs: Date.now() - startedAt });
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
    const normalized = normalizeError(error, { stage: "ANALYSIS", attemptNumber: Number(claimedItem.attempt_count || 0) + 1, durationMs: Date.now() - startedAt });
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
  const refreshed = await withTransientFetchRetry(() => admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId }));
  if (refreshed.error) throw refreshed.error;
  const { data, error } = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").select("pending_count,status,elapsed_ms,started_at").eq("id", taskId).single());
  if (error) throw error;
  if (!data || ["CANCELLED", "PAUSED"].includes(String(data.status))) return;
  // A workflow can only report completion after every item reached a terminal
  // success or technical-failure state.
  if (Number(data.pending_count || 0) > 0) return;
  const now = new Date();
  const started = data.started_at ? new Date(data.started_at).getTime() : NaN;
  const elapsedMs = Number(data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const completed = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").update({
    status: "COMPLETED",
    completed_at: now.toISOString(), finished_at: now.toISOString(),
    elapsed_ms: elapsedMs, updated_at: now.toISOString(),
  }).eq("id", taskId));
  if (completed.error) throw completed.error;
}

async function failTask(taskId: string, errorMessage: string) {
  "use step";
  const admin = createAdminClient();
  const refreshed = await withTransientFetchRetry(() => admin.rpc("refresh_ai_screening_task_totals", { p_task_id: taskId }));
  if (refreshed.error) throw refreshed.error;
  const { data, error } = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").select("status,elapsed_ms,started_at").eq("id", taskId).single());
  if (error) throw error;
  if (!data || ["CANCELLED", "PAUSED"].includes(String(data.status))) return;
  const now = new Date();
  const started = data.started_at ? new Date(data.started_at).getTime() : NaN;
  const elapsedMs = Number(data.elapsed_ms || 0) + (Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0);
  const failed = await withTransientFetchRetry(() => admin.from("ai_screening_tasks").update({
    status: "FAILED", finished_at: now.toISOString(),
    elapsed_ms: elapsedMs, error_message: errorMessage.slice(0, 1000), updated_at: now.toISOString(),
  }).eq("id", taskId));
  if (failed.error) throw failed.error;
}

export async function aiScreeningWorkflow(input: WorkflowInput) {
  "use workflow";
  try {
    if (input.scheduledAt && new Date(input.scheduledAt).getTime() > Date.now()) await sleep(new Date(input.scheduledAt));
    const initial = await taskState(input.taskId);
    if (initial.status === "CANCELLED" || initial.cancelRequested) return { status: "CANCELLED" };
    await beginTask(input.taskId);
    const concurrency = Math.min(6, Math.max(1, Number(process.env.AI_SCREENING_CONCURRENCY || 5)));
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
      if (!batch.length) {
        if (await hasPendingItems(input.taskId)) {
          await sleep("3s");
          continue;
        }
        break;
      }
      // Keep every worker slot busy. The old fixed batch waited for the single
      // slowest customer before starting any new customer, producing visible
      // gaps even when four workers had already finished.
      const active = batch.map((itemId) => analyzeTaskItem(input.taskId, itemId, input.strategy));
      let stopRefill = false;
      while (active.length) {
        const completedIndex = await Promise.race(active.map((promise, index) => promise.then(() => index)));
        active.splice(completedIndex, 1);
        state = await taskState(input.taskId);
        if (["PAUSING", "PAUSED", "CANCELLED"].includes(state.status) || state.cancelRequested) stopRefill = true;
        if (!stopRefill) {
          const replacement = await nextPendingItems(input.taskId, 1);
          if (replacement[0]) active.push(analyzeTaskItem(input.taskId, replacement[0], input.strategy));
        }
      }
      state = await taskState(input.taskId);
      if (state.status === "PAUSING") await settlePause(input.taskId);
    }
    await finishTask(input.taskId);
    return { status: "FINISHED" };
  } catch (error) {
    // Supabase/PostgREST failures are plain objects rather than Error
    // instances. Normalize them so the task page and runtime logs retain the
    // actual database code/message instead of the unhelpful generic text.
    const normalized = normalizeError(error, { stage: "TASK" });
    const message = `${normalized.error_code}：${normalized.error_message}`;
    await failTask(input.taskId, message);
    return { status: "FAILED", error: message };
  }
}
