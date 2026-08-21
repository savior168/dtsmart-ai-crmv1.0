import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScreeningWorkflow } from "@/workflows/ai-screening";
import type { AiStrategy } from "@/lib/ai/task-types";

async function ownedTask(id: string, userId: string) {
  const admin = createAdminClient();
  const result = await admin.from("ai_screening_tasks").select("*").eq("id", id).eq("user_id", userId).single();
  if (result.error || !result.data) throw result.error || new Error("任务不存在或无权访问");
  return result.data;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const task = await ownedTask(id, user.id);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 404 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const body = await request.json() as {
      action?: "pause" | "resume" | "cancel" | "retry" | "edit";
      name?: string; scheduled_at?: string | null; notification_mode?: string;
    };
    const task = await ownedTask(id, user.id);
    const admin = createAdminClient();
    if (body.action === "pause") {
      if (task.status !== "RUNNING") return NextResponse.json({ error: "只有执行中的任务可以停止" }, { status: 409 });
      await admin.from("ai_screening_tasks").update({ status: "PAUSING", updated_at: new Date().toISOString() }).eq("id", id);
    } else if (body.action === "cancel") {
      if (!["QUEUED", "PAUSED"].includes(task.status)) return NextResponse.json({ error: "只有排队中或已停止的任务可以取消" }, { status: 409 });
      await admin.from("ai_screening_tasks").update({ status: "CANCELLED", cancel_requested: true, cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    } else if (body.action === "resume") {
      if (task.status !== "PAUSED") return NextResponse.json({ error: "只有已停止的任务可以继续执行" }, { status: 409 });
      await admin.from("ai_screening_tasks").update({ status: "RUNNING", cancel_requested: false, updated_at: new Date().toISOString() }).eq("id", id);
    } else if (body.action === "retry") {
      if (task.status !== "FAILED") return NextResponse.json({ error: "只有失败任务可以重试失败项" }, { status: 409 });
      const failed = await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (failed.error) throw failed.error;
      if (!failed.count) return NextResponse.json({ error: "当前任务没有可重试的失败客户" }, { status: 409 });
      const reset = await admin.from("ai_screening_task_items").update({ status: "PENDING", progress: 0, current_step: "WAITING", error_message: null, error_code: null, completed_at: null, updated_at: new Date().toISOString() }).eq("task_id", id).eq("status", "FAILED").eq("retryable", true).lt("attempt_count", 3);
      if (reset.error) throw reset.error;
      await admin.from("ai_screening_tasks").update({ status: "QUEUED", failed_count: 0, completed_at: null, cancel_requested: false, updated_at: new Date().toISOString() }).eq("id", id);
      const run = await start(aiScreeningWorkflow, [{ taskId: id, strategy: task.strategy as AiStrategy, scheduledAt: null }]);
      await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId }).eq("id", id);
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
    const { user } = await requireUser();
    const { id } = await context.params;
    const task = await ownedTask(id, user.id);
    if (!['CANCELLED', 'FAILED'].includes(task.status)) return NextResponse.json({ error: "只有已取消或执行失败的任务可以删除" }, { status: 409 });
    const admin = createAdminClient();
    const removed = await admin.from("ai_screening_tasks").delete().eq("id", id).eq("user_id", user.id).in("status", ['CANCELLED', 'FAILED']);
    if (removed.error) throw removed.error;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_TASK_DELETE", target_type: "ai_screening_task", target_id: id, content: { task_number: task.task_number, status: task.status } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务删除失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
