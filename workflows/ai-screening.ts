import { sleep } from "workflow";
import { createAdminClient } from "../lib/supabase/admin";
import type { AiStrategy } from "../lib/ai/task-types";
import { normalizeError } from "../lib/ai/error-normalization";
import { executeClaimedAiTaskItem } from "../lib/ai/task-item-executor";

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
  const admin = createAdminClient();
  const executorId = `vercel:${taskId}`;
  const claim = await withTransientFetchRetry(() => admin.rpc("claim_ai_screening_task_item", {
    p_task_id: taskId, p_item_id: itemId, p_executor_type: "VERCEL_WORKFLOW",
    p_executor_id: executorId, p_lease_seconds: 1800,
  }));
  if (claim.error) throw claim.error;
  const claimedItem = Array.isArray(claim.data) ? claim.data[0] : null;
  if (!claimedItem) return { status: "SKIPPED" as const };
  try {
    return await executeClaimedAiTaskItem({
      taskId, taskItemId: itemId, customerId: claimedItem.customer_id, strategy,
      attemptNumber: Number(claimedItem.attempt_number || 1), leaseToken: claimedItem.lease_token,
    }, {
      executorId, leaseToken: claimedItem.lease_token,
    });
  } finally {
    await admin.rpc("release_ai_screening_item_lease", {
      p_item_id: itemId, p_lease_token: claimedItem.lease_token, p_executor_id: executorId,
    });
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
