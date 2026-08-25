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
    const search = params.get("search")?.trim() || "";
    const step = params.get("step") || "";
    const retry = params.get("retry") || "";
    const admin = createAdminClient();
    const tasks = await admin.from("ai_screening_tasks").select("id,name,task_number,strategy").eq("user_id", user.id);
    if (tasks.error) throw tasks.error;
    let taskIds = (tasks.data || []).map((item) => item.id);
    if (taskId) taskIds = taskIds.filter((id) => id === taskId);
    if (!taskIds.length) return NextResponse.json({ data: [], count: 0, tasks: tasks.data || [] });
    const safeSearch = search.replace(/[,%()]/g, " ").trim();
    let query = admin.from("ai_screening_task_items").select("*,customer:customers!inner(id,company_name,email,phone),task:ai_screening_tasks!inner(id,name,task_number,strategy,user_id)", { count: "exact" }).eq("task.user_id", user.id).eq("status", "FAILED");
    if (taskId) query = query.eq("task_id", taskId);
    if (safeSearch) query = query.or(`company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`, { referencedTable: "customers" });
    if (step) query = query.eq("current_step", step);
    if (retry === "available") query = query.eq("retryable", true).lt("attempt_count", 3);
    if (retry === "exhausted") query = query.or("retryable.eq.false,attempt_count.gte.3");
    const result = await query.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
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
    type RetryRow = { id: string; task_id: string; task: { id: string; user_id: string; strategy: string } | Array<{ id: string; user_id: string; strategy: string }> };
    const failedRows: RetryRow[] = [];
    const fetchRetryRows = async (ids?: string[], from = 0) => {
      let query = admin.from("ai_screening_task_items")
        .select("id,task_id,task:ai_screening_tasks!inner(id,user_id,strategy)")
        .eq("task.user_id", user.id)
        .eq("status", "FAILED")
        .eq("retryable", true)
        .lt("attempt_count", 3);
      if (body.task_id) query = query.eq("task_id", body.task_id);
      if (ids?.length) query = query.in("id", ids);
      const result = ids?.length ? await query : await query.range(from, from + 999);
      if (result.error) throw result.error;
      return (result.data || []) as RetryRow[];
    };
    if (body.item_ids?.length) {
      const uniqueIds = [...new Set(body.item_ids)];
      for (let offset = 0; offset < uniqueIds.length; offset += 100) failedRows.push(...await fetchRetryRows(uniqueIds.slice(offset, offset + 100)));
    } else {
      for (let offset = 0; ; offset += 1000) {
        const rows = await fetchRetryRows(undefined, offset);
        failedRows.push(...rows);
        if (rows.length < 1000) break;
      }
    }
    const groups = new Map<string, { strategy: AiStrategy; ids: string[] }>();
    for (const item of failedRows) {
      const task = Array.isArray(item.task) ? item.task[0] : item.task;
      if (!task || task.user_id !== user.id) continue;
      const current = groups.get(item.task_id) || { strategy: task.strategy as AiStrategy, ids: [] };
      current.ids.push(item.id);
      groups.set(item.task_id, current);
    }
    if (!groups.size) return NextResponse.json({ error: "没有可重试的失败客户" }, { status: 409 });
    for (const [taskId, group] of groups) {
      for (let offset = 0; offset < group.ids.length; offset += 100) {
        const ids = group.ids.slice(offset, offset + 100);
        const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", ids);
        if (invalidated.error) throw invalidated.error;
        const reset = await admin.from("ai_screening_task_items").update({
          status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING",
          automation_status: null, result_id: null, progress: 0, current_step: "WAITING",
          pipeline_stage: "NORMALIZED", error_message: null, error_code: null,
          error_context: {}, writeback_warning_count: 0, retry_at: null,
          completed_at: null, updated_at: new Date().toISOString(),
        }).in("id", ids);
        if (reset.error) throw reset.error;
      }
      await admin.from("ai_screening_tasks").update({ status: "QUEUED", completed_at: null, cancel_requested: false, updated_at: new Date().toISOString() }).eq("id", taskId);
      const run = await start(aiScreeningWorkflow, [{ taskId, strategy: group.strategy, scheduledAt: null }]);
      await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId }).eq("id", taskId);
    }
    return NextResponse.json({ success: true, retried: [...groups.values()].reduce((sum, group) => sum + group.ids.length, 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重试提交失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
