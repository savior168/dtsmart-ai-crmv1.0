import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScreeningWorkflow } from "@/workflows/ai-screening";
import { AI_STRATEGIES, type AiStrategy } from "@/lib/ai/task-types";

function taskNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AI-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const status = params.get("status") || "";
    const search = params.get("search")?.trim() || "";
    const admin = createAdminClient();
    let query = admin.from("ai_screening_tasks").select("*", { count: "exact" }).eq("user_id", user.id);
    if (status === "ACTIVE") query = query.in("status", ["QUEUED", "RUNNING", "PAUSED"]);
    else if (status) query = query.eq("status", status);
    if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
    const result = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const stats = await admin.from("ai_screening_tasks").select("status,total_count,success_count,failed_count,total_tokens,total_cost_usd,created_at").eq("user_id", user.id);
    const all = stats.data || [];
    const counts = {
      all: all.length,
      active: all.filter((item) => ["QUEUED", "RUNNING", "PAUSED"].includes(item.status)).length,
      running: all.filter((item) => item.status === "RUNNING").length,
      queued: all.filter((item) => item.status === "QUEUED").length,
      completed: all.filter((item) => item.status === "COMPLETED").length,
      failed: all.filter((item) => item.status === "FAILED").length,
    };
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = all.filter((item) => String(item.created_at).startsWith(today));
    return NextResponse.json({
      data: result.data || [], count: result.count || 0, counts,
      today_cost: todayTasks.reduce((sum, item) => sum + Number(item.total_cost_usd || 0), 0),
      today_completed_customers: todayTasks.reduce((sum, item) => sum + Number(item.success_count || 0), 0),
      today_failed_customers: todayTasks.reduce((sum, item) => sum + Number(item.failed_count || 0), 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务列表查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json() as {
      name?: string; strategy?: AiStrategy; scheduled_at?: string | null; customer_ids?: string[];
      filters?: Record<string, unknown>; notification_mode?: string;
    };
    const name = body.name?.trim();
    const strategy = body.strategy || "SMART";
    if (!name) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
    if (!AI_STRATEGIES.includes(strategy)) return NextResponse.json({ error: "分析策略无效" }, { status: 400 });
    const requestedIds = [...new Set((body.customer_ids || []).filter(Boolean))];
    if (!requestedIds.length) return NextResponse.json({ error: "请至少选择一条待筛选客户" }, { status: 400 });

    const allowedIds: string[] = [];
    for (let offset = 0; offset < requestedIds.length; offset += 200) {
      const ids = requestedIds.slice(offset, offset + 200);
      const allowed = await supabase.from("customers").select("id").in("id", ids).is("deleted_at", null).is("ai_score", null);
      if (allowed.error) throw allowed.error;
      allowedIds.push(...(allowed.data || []).map((item) => item.id));
    }
    const admin = createAdminClient();
    const active = await admin.from("ai_screening_tasks").select("id").eq("user_id",user.id).in("status",["QUEUED","RUNNING","PAUSED"]);
    if(active.error)throw active.error;
    const activeTaskIds=(active.data||[]).map(item=>item.id);
    const reserved=new Set<string>();
    for(let offset=0;activeTaskIds.length&&offset<allowedIds.length;offset+=200){
      const rows=await admin.from("ai_screening_task_items").select("customer_id").in("task_id",activeTaskIds).in("customer_id",allowedIds.slice(offset,offset+200)).in("status",["PENDING","RUNNING"]);
      if(rows.error)throw rows.error;
      for(const row of rows.data||[])reserved.add(row.customer_id);
    }
    const eligibleIds=allowedIds.filter(id=>!reserved.has(id));
    if (!eligibleIds.length) return NextResponse.json({ error: "所选客户已完成AI筛选、已删除、无权访问或已加入其他活动任务" }, { status: 409 });

    const scheduledAt = body.scheduled_at && new Date(body.scheduled_at).getTime() > Date.now() ? new Date(body.scheduled_at).toISOString() : null;
    const task = await admin.from("ai_screening_tasks").insert({
      user_id: user.id, task_number: taskNumber(), name, strategy, strategy_version: "1.0",
      status: "QUEUED", total_count: eligibleIds.length, pending_count: eligibleIds.length,
      filters: body.filters || {}, selection_mode: "FILTERED", scheduled_at: scheduledAt,
      notification_mode: body.notification_mode || "IN_APP",
    }).select("*").single();
    if (task.error || !task.data) throw task.error || new Error("任务创建失败");
    const rows = eligibleIds.map((customerId) => ({
      task_id: task.data.id, customer_id: customerId, status: "PENDING", strategy, strategy_version: "1.0",
    }));
    const itemIds: string[] = [];
    for (let offset = 0; offset < rows.length; offset += 500) {
      const inserted = await admin.from("ai_screening_task_items").insert(rows.slice(offset, offset + 500)).select("id");
      if (inserted.error) throw inserted.error;
      itemIds.push(...(inserted.data || []).map((item) => item.id));
    }
    const run = await start(aiScreeningWorkflow, [{ taskId: task.data.id, itemIds, strategy, scheduledAt }]);
    await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId, updated_at: new Date().toISOString() }).eq("id", task.data.id);
    return NextResponse.json({ task: { ...task.data, workflow_run_id: run.runId } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务创建失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
