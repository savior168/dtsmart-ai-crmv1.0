import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchAiScreeningTask } from "@/lib/ai/task-dispatch";
import { AI_DISPATCH_POLICIES, type AiDispatchPolicy, type AiExecutionMode } from "@/lib/ai/task-types";

export const runtime = "nodejs";

function taskNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AI-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

/** Compatibility endpoint used by "save and screen". It creates the same
 * durable task/item/workflow as the task centre and never bypasses evidence,
 * retry or validated customer writeback. */
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requirePermission("ai.tasks.create");
    const body = await request.json() as { customer_id?: string };
    if (!body.customer_id) return NextResponse.json({ error: "缺少客户编号" }, { status: 400 });
    // This compatibility write endpoint must not reuse the supervisor's
    // cross-user read scope. Supervisors may inspect another salesperson's
    // customer, but only the current owner may start analysis for it.
    const visible = await supabase.from("customers").select("id,company_name,ai_score")
      .eq("id", body.customer_id).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
    if (visible.error || !visible.data) throw visible.error || new Error("客户不存在或无权访问");
    if (visible.data.ai_score !== null) return NextResponse.json({ error: "该客户已经完成AI筛选" }, { status: 409 });

    const admin = createAdminClient();
    const executionSettings = await admin.from("cost_center_settings").select("ai_default_dispatch_policy").eq("id", true).single();
    if (executionSettings.error) throw executionSettings.error;
    const configuredPolicy=executionSettings.data.ai_default_dispatch_policy as AiDispatchPolicy;
    const dispatchPolicy:AiDispatchPolicy=AI_DISPATCH_POLICIES.includes(configuredPolicy)?configuredPolicy:"VERCEL_FIRST";
    const executionMode:AiExecutionMode=dispatchPolicy==="LOCAL_ONLY"?"LOCAL_ONLY":dispatchPolicy==="LOCAL_FIRST"?"AUTO":"VERCEL_ONLY";
    const existing = await admin.from("ai_screening_task_items")
      .select("id,task:ai_screening_tasks!inner(id,user_id,status)")
      .eq("customer_id", visible.data.id).eq("task.user_id", user.id)
      .in("task.status", ["QUEUED", "RUNNING", "PAUSING", "PAUSED"])
      .in("status", ["PENDING", "RUNNING"]).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ error: "该客户已加入活动中的AI筛选任务" }, { status: 409 });

    const number = taskNumber();
    const task = await admin.from("ai_screening_tasks").insert({
      user_id: user.id, task_number: number,
      name: `新增客户筛选：${visible.data.company_name}`.slice(0, 120),
      strategy: "SMART", strategy_version: "1.0", status: "QUEUED",
      total_count: 1, pending_count: 1,
      filters: { source: "SAVE_AND_SCREEN", customer_id: visible.data.id },
      selection_mode: "MANUAL", notification_mode: "IN_APP",
      execution_mode: executionMode,
      dispatch_policy: dispatchPolicy,
    }).select("*").single();
    if (task.error || !task.data) throw task.error || new Error("AI筛选任务创建失败");
    const item = await admin.from("ai_screening_task_items").insert({
      task_id: task.data.id, customer_id: visible.data.id,
      status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING",
      strategy: "SMART", strategy_version: "1.0",
    });
    if (item.error) throw item.error;
    await dispatchAiScreeningTask({ taskId: task.data.id, strategy: "SMART", scheduledAt: null, executionMode, dispatchPolicy });
    return NextResponse.json({ task_id: task.data.id, task_number: number, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI筛选任务创建失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
