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
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: item.taskId });
    return { status: "FAILED" as const, error: failure };
  }
}
