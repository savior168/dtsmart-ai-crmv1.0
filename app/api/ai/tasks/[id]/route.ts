import { NextRequest, NextResponse } from "next/server";
import { getRun, start } from "workflow/api";
import { hasPermission, requirePermission, type CurrentAccount } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScreeningWorkflow } from "@/workflows/ai-screening";
import type { AiStrategy } from "@/lib/ai/task-types";

async function ownedTask(id: string, account: CurrentAccount) {
  const admin = createAdminClient();
  let query = admin.from("ai_screening_tasks").select("*").eq("id", id);
  if (!hasPermission(account, "ai.data_all")) query = query.eq("user_id", account.id);
  const result = await query.single();
  if (result.error || !result.data) throw result.error || new Error("任务不存在或无权访问");
  return result.data;
}

function accumulatedElapsed(task: { elapsed_ms?: number | null; started_at?: string | null }) {
  const previous = Number(task.elapsed_ms || 0);
  if (!task.started_at) return previous;
  const started = new Date(task.started_at).getTime();
  return previous + (Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0);
}

async function cancelWorkflowRun(runId?: string | null) {
  if (!runId) return;
  const run = getRun(runId);
  if (await run.exists) await run.cancel();
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.tasks.view");
    const { id } = await context.params;
    const task = await ownedTask(id, account);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 404 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.tasks.control");
    const { id } = await context.params;
    const body = await request.json() as {
      action?: "pause" | "resume" | "cancel" | "retry" | "edit";
      name?: string; scheduled_at?: string | null; notification_mode?: string;
    };
    const task = await ownedTask(id, account);
    if (task.user_id !== user.id && account.role !== "ADMIN") return NextResponse.json({ error: "其他用户的AI任务仅供查看，不能控制或修改" }, { status: 403 });
    const admin = createAdminClient();
    if (body.action === "pause") {
      if (!["RUNNING", "PAUSING"].includes(task.status)) return NextResponse.json({ error: "只有执行中的任务可以停止" }, { status: 409 });
      const now = new Date().toISOString();
      const pausing = await admin.from("ai_screening_tasks").update({ status: "PAUSING", updated_at: now }).eq("id", id);
      if (pausing.error) throw pausing.error;
      await cancelWorkflowRun(task.workflow_run_id);
      const invalidatePartial = await admin.from("ai_screening_results").update({ is_latest_valid: false }).eq("task_id", id).neq("writeback_status", "COMPLETED");
      if (invalidatePartial.error) throw invalidatePartial.error;
      const resetItems = await admin.from("ai_screening_task_items").update({
        status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING",
        automation_status: null, result_id: null, progress: 0, current_step: "WAITING",
        pipeline_stage: "NORMALIZED", started_at: null, completed_at: null, updated_at: now,
      }).eq("task_id", id).eq("status", "RUNNING");
      if (resetItems.error) throw resetItems.error;
      const paused = await admin.from("ai_screening_tasks").update({
        status: "PAUSED", started_at: null, pause_started_at: now,
        elapsed_ms: accumulatedElapsed(task), cancel_requested: false, updated_at: now,
      }).eq("id", id);
      if (paused.error) throw paused.error;
      await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: id });
    } else if (body.action === "cancel") {
      if (!["QUEUED", "PAUSED"].includes(task.status)) return NextResponse.json({ error: "只有排队中或已停止的任务可以取消" }, { status: 409 });
      await cancelWorkflowRun(task.workflow_run_id);
      const now = new Date().toISOString();
      const cancelled = await admin.from("ai_screening_tasks").update({
        status: "CANCELLED", cancel_requested: true, cancelled_at: now, finished_at: now,
        elapsed_ms: accumulatedElapsed(task), updated_at: now,
      }).eq("id", id);
      if (cancelled.error) throw cancelled.error;
    } else if (body.action === "resume") {
      if (task.status !== "PAUSED") return NextResponse.json({ error: "只有已停止的任务可以继续执行" }, { status: 409 });
      const now = new Date().toISOString();
      const queued = await admin.from("ai_screening_tasks").update({ status: "QUEUED", cancel_requested: false, pause_started_at: null, completed_at: null, finished_at: null, error_message: null, updated_at: now }).eq("id", id);
      if (queued.error) throw queued.error;
      const run = await start(aiScreeningWorkflow, [{ taskId: id, strategy: task.strategy as AiStrategy, scheduledAt: null }]);
      const linked = await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId, updated_at: new Date().toISOString() }).eq("id", id);
      if (linked.error) throw linked.error;
    } else if (body.action === "retry") {
      if (!["FAILED", "COMPLETED"].includes(task.status)) return NextResponse.json({ error: "只有失败任务或含失败客户的已完成任务可以重试" }, { status: 409 });
      const failed = await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (failed.error) throw failed.error;
      const pending = task.status === "FAILED"
        ? await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).eq("task_id", id).in("status", ["PENDING", "RUNNING"])
        : { count: 0, error: null };
      if (pending.error) throw pending.error;
      if (!failed.count && !pending.count) return NextResponse.json({ error: "当前任务没有可重试或未完成的客户" }, { status: 409 });
      if (task.status === "FAILED") {
        const resetRunning = await admin.from("ai_screening_task_items").update({ status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null, result_id: null, progress: 0, current_step: "WAITING", pipeline_stage: "NORMALIZED", started_at: null, completed_at: null, updated_at: new Date().toISOString() }).eq("task_id", id).eq("status", "RUNNING");
        if (resetRunning.error) throw resetRunning.error;
      }
      const failedIds = await admin.from("ai_screening_task_items").select("id").eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (failedIds.error) throw failedIds.error;
      const ids = (failedIds.data || []).map((item) => item.id);
      if (ids.length) {
        const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", ids);
        if (invalidated.error) throw invalidated.error;
      }
      const reset = await admin.from("ai_screening_task_items").update({ status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null, result_id: null, progress: 0, current_step: "WAITING", pipeline_stage: "NORMALIZED", error_message: null, error_code: null, error_context: {}, writeback_warning_count: 0, retry_at: null, completed_at: null, updated_at: new Date().toISOString() }).eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (reset.error) throw reset.error;
      await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: id });
      const queued = await admin.from("ai_screening_tasks").update({ status: "QUEUED", completed_at: null, finished_at: null, error_message: null, cancel_requested: false, updated_at: new Date().toISOString() }).eq("id", id);
      if (queued.error) throw queued.error;
      const run = await start(aiScreeningWorkflow, [{ taskId: id, strategy: task.strategy as AiStrategy, scheduledAt: null }]);
      const linked = await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId, updated_at: new Date().toISOString() }).eq("id", id);
      if (linked.error) throw linked.error;
    } else if (body.action === "edit") {
      if (task.status !== "QUEUED") return NextResponse.json({ error: "只有尚未执行的排队任务可以编辑" }, { status: 409 });
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
      const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
      if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "预约执行时间无效" }, { status: 400 });
      const updated = await admin.from("ai_screening_tasks").update({
        name,
        scheduled_at: scheduledAt?.toISOString() || null,
        notification_mode: body.notification_mode || task.notification_mode,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "QUEUED");
      if (updated.error) throw updated.error;
    } else {
      return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
    }
    await admin.from("audit_logs").insert({ user_id: user.id, action: `AI_TASK_${String(body.action || "UNKNOWN").toUpperCase()}`, target_type: "ai_screening_task", target_id: id, content: { task_number: task.task_number, previous_status: task.status } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.tasks.delete");
    const { id } = await context.params;
    const task = await ownedTask(id, account);
    if (task.user_id !== user.id && account.role !== "ADMIN") return NextResponse.json({ error: "其他用户的AI任务仅供查看，不能删除" }, { status: 403 });
    if (!['CANCELLED', 'FAILED'].includes(task.status)) return NextResponse.json({ error: "只有已取消或执行失败的任务可以删除" }, { status: 409 });
    const admin = createAdminClient();
    let removeQuery = admin.from("ai_screening_tasks").delete().eq("id", id).in("status", ['CANCELLED', 'FAILED']);
    if (account.role !== "ADMIN") removeQuery = removeQuery.eq("user_id", user.id);
    const removed = await removeQuery;
    if (removed.error) throw removed.error;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_TASK_DELETE", target_type: "ai_screening_task", target_id: id, content: { task_number: task.task_number, status: task.status } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务删除失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

