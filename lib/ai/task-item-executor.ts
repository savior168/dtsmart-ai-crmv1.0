import { createAdminClient } from "../supabase/admin";
import { normalizeError } from "./error-normalization";
import { publicAiError, runCustomerAnalysis } from "./run-customer-analysis";
import type { AiStrategy } from "./task-types";

export type AiExecutionLease = {
  executorId: string;
  leaseToken: string;
};

export type ClaimedAiTaskItem = {
  taskId: string;
  taskItemId: string;
  customerId: string;
  strategy: AiStrategy;
  attemptNumber: number;
  leaseToken: string;
};

function isTransientAnalysisError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; message?: unknown } : null;
  const code = String(candidate?.code || candidate?.status || "");
  const message = error instanceof Error ? error.message : String(candidate?.message || error || "");
  return ["40001", "40P01", "55P03", "57014", "408", "429", "500", "502", "503", "504", "525", "529"].includes(code)
    || /(?:statement timeout|deadlock detected|could not serialize access|lock not available|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|gateway timeout|ssl handshake failed|temporarily unavailable|OPENAI_API_ERROR:\s*(?:429|5\d\d)\b)/i.test(message);
}

export async function executeClaimedAiTaskItem(
  item: ClaimedAiTaskItem,
  lease: AiExecutionLease,
) {
  const startedAt = Date.now();
  const admin = createAdminClient();
  try {
    return await runCustomerAnalysis({
      taskId: item.taskId,
      taskItemId: item.taskItemId,
      customerId: item.customerId,
      strategy: item.strategy,
      attemptNumber: item.attemptNumber,
      executionLease: lease,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error || "");
    if (raw.includes("AI_EXECUTION_LEASE_LOST")) return { status: "LEASE_LOST" as const };
    if (raw.includes("OPENAI_NOT_CONFIGURED") || /OPENAI_API_ERROR:\s*(401|403)\b/.test(raw)) throw error;

    const durable = await admin.from("ai_screening_task_items")
      .select("analysis_status,writeback_status,result_id,lease_owner,lease_token")
      .eq("id", item.taskItemId)
      .maybeSingle();
    if (durable.error) throw durable.error;
    if (durable.data?.lease_owner !== lease.executorId || durable.data?.lease_token !== lease.leaseToken) {
      return { status: "LEASE_LOST" as const };
    }
    if (durable.data?.analysis_status === "COMPLETED" && durable.data?.writeback_status === "COMPLETED" && durable.data?.result_id) {
      const warning = normalizeError(error, {
        stage: "POST_ANALYSIS_WRITEBACK",
        attemptNumber: item.attemptNumber,
        durationMs: Date.now() - startedAt,
      });
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
      }).eq("id", item.taskItemId).eq("lease_owner", lease.executorId).eq("lease_token", lease.leaseToken);
      if (writeback.error) throw writeback.error;
      await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: item.taskId });
      return { status: "COMPLETED" as const, writebackWarning: warning };
    }

    const failure = publicAiError(error);
    const normalized = normalizeError(error, {
      stage: "ANALYSIS",
      attemptNumber: item.attemptNumber,
      durationMs: Date.now() - startedAt,
    });
    // A temporary database/provider outage is not a customer verdict. Return
    // the item to the durable queue, then stop this workflow run so the
    // recovery watchdog spaces attempts apart instead of burning the entire
    // item budget in a tight loop during the same outage.
    if (isTransientAnalysisError(error) && item.attemptNumber < 3) {
      const queued = await admin.from("ai_screening_task_items").update({
        status: "PENDING",
        analysis_status: "PENDING",
        writeback_status: "PENDING",
        current_step: "RETRY_PENDING",
        pipeline_stage: "NORMALIZED",
        progress: 0,
        error_code: failure.code,
        error_message: failure.message,
        retryable: true,
        error_context: normalized,
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", item.taskItemId).eq("lease_owner", lease.executorId).eq("lease_token", lease.leaseToken).select("id").maybeSingle();
      if (queued.error) throw queued.error;
      if (!queued.data) return { status: "LEASE_LOST" as const };
      throw error;
    }
    const failed = await admin.from("ai_screening_task_items").update({
      status: "FAILED",
      analysis_status: "FAILED",
      writeback_status: "NOT_STARTED",
      automation_status: "ANALYSIS_FAILED",
      progress: 100,
      current_step: "FAILED",
      pipeline_stage: "FAILED",
      error_code: failure.code,
      error_message: failure.message,
      retryable: true,
      error_context: normalized,
      duration_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", item.taskItemId).eq("lease_owner", lease.executorId).eq("lease_token", lease.leaseToken);
    if (failed.error) throw failed.error;
    // Do not overwrite a newer completed conclusion from another task, but do
    // persist the failure state for customers that still have no conclusion so
    // list filters can distinguish failed work from never-submitted work.
    const customerFailure = await admin.from("customers").update({ ai_status: "FAILED", ai_screening_done: false, updated_at: new Date().toISOString() }).eq("id", item.customerId).is("ai_score", null);
    if (customerFailure.error) throw customerFailure.error;
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: item.taskId });
    return { status: "FAILED" as const, error: failure };
  }
}
