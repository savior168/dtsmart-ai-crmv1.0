import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScreeningWorkflow } from "@/workflows/ai-screening";
import type { AiStrategy } from "@/lib/ai/task-types";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const taskId = params.get("task_id") || "";
    const admin = createAdminClient();
    const tasks = await admin.from("ai_screening_tasks").select("id,name,task_number,strategy").eq("user_id", user.id);
    if (tasks.error) throw tasks.error;
    let taskIds = (tasks.data || []).map((item) => item.id);
    if (taskId) taskIds = taskIds.filter((id) => id === taskId);
    if (!taskIds.length) return NextResponse.json({ data: [], count: 0, tasks: tasks.data || [] });
    const result = await admin.from("ai_screening_task_items").select("*,customer:customers(id,company_name,email,phone),task:ai_screening_tasks(id,name,task_number,strategy)", { count: "exact" }).in("task_id", taskIds).eq("status", "FAILED").order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    return NextResponse.json({ data: result.data || [], count: result.count || 0, tasks: tasks.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "失败客户查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const body = await request.json() as { item_ids?: string[]; task_id?: string };
    const admin = createAdminClient();
    let query = admin.from("ai_screening_task_items").select("id,task_id,task:ai_screening_tasks(id,user_id,strategy)").eq("status", "FAILED").eq("retryable", true);
    if (body.task_id) query = query.eq("task_id", body.task_id);
    if (body.item_ids?.length) query = query.in("id", body.item_ids);
    const failed = await query;
    if (failed.error) throw failed.error;
    const groups = new Map<string, { strategy: AiStrategy; ids: string[] }>();
    for (const item of failed.data || []) {
      const task = Array.isArray(item.task) ? item.task[0] : item.task;
      if (!task || task.user_id !== user.id) continue;
      const current = groups.get(item.task_id) || { strategy: task.strategy as AiStrategy, ids: [] };
      current.ids.push(item.id);
      groups.set(item.task_id, current);
    }
    if (!groups.size) return NextResponse.json({ error: "没有可重试的失败客户" }, { status: 409 });
    for (const [taskId, group] of groups) {
      await admin.from("ai_screening_task_items").update({ status: "PENDING", progress: 0, current_step: "WAITING", error_message: null, error_code: null, completed_at: null, updated_at: new Date().toISOString() }).in("id", group.ids);
      await admin.from("ai_screening_tasks").update({ status: "QUEUED", completed_at: null, cancel_requested: false, updated_at: new Date().toISOString() }).eq("id", taskId);
      const run = await start(aiScreeningWorkflow, [{ taskId, itemIds: group.ids, strategy: group.strategy, scheduledAt: null }]);
      await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId }).eq("id", taskId);
    }
    return NextResponse.json({ success: true, retried: [...groups.values()].reduce((sum, group) => sum + group.ids.length, 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重试提交失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

