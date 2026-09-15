import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

async function authorizedTask(id: string, account: Awaited<ReturnType<typeof requirePermission>>["account"]) {
  const result = await createAdminClient().from("ai_acquisition_tasks").select("*").eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("TASK_NOT_FOUND");
  if (result.data.user_id !== account.id && !hasPermission(account, "ai.acquisition.data_all")) throw new Error("FORBIDDEN");
  return result.data;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const { id } = await context.params;
    const task = await authorizedTask(id, account);
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const decision = request.nextUrl.searchParams.get("decision") || "";
    let query = createAdminClient().from("ai_acquisition_candidates").select("*", { count: "exact" }).eq("task_id", id);
    if (decision) query = query.eq("decision", decision);
    const candidates = await query.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (candidates.error) throw candidates.error;
    const screeningTaskRows = await createAdminClient().from("ai_acquisition_candidates").select("screening_task_id").eq("task_id", id).not("screening_task_id", "is", null).limit(500);
    if (screeningTaskRows.error) throw screeningTaskRows.error;
    const screeningIds = [...new Set((screeningTaskRows.data || []).map((row) => String(row.screening_task_id || "")).filter(Boolean))];
    const taskIds = [id, ...screeningIds];
    const costs = hasPermission(account, "ai.acquisition.usage.view") ? await createAdminClient().from("api_cost_ledger").select("provider,model_or_sku,operation,amount_usd,amount_type,quantity,occurred_at,metadata").in("task_id", taskIds).order("occurred_at", { ascending: false }).limit(200) : { data: [], error: null };
    if (costs.error) throw costs.error;
    return NextResponse.json({ task, candidates: candidates.data || [], count: candidates.count || 0, costs: costs.data || [], can_view_evidence: hasPermission(account, "ai.acquisition.evidence.view"), can_view_usage: hasPermission(account, "ai.acquisition.usage.view"), can_control: hasPermission(account, "ai.acquisition.control") && (task.user_id === account.id || account.role === "ADMIN") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务详情加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "TASK_NOT_FOUND" ? 404 : 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.control");
    const { id } = await context.params;
    const task = await authorizedTask(id, account);
    if (task.user_id !== account.id && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const action = String((await request.json()).action || "");
    const admin = createAdminClient();
    if (action === "CANCEL") {
      const result = await admin.from("ai_acquisition_tasks").update({ cancel_requested: true, status: ["QUEUED","PAUSED"].includes(task.status) ? "CANCELLED" : task.status, updated_at: new Date().toISOString() }).eq("id", id).in("status", ["QUEUED","RUNNING","PAUSING","PAUSED"]);
      if (result.error) throw result.error;
    } else if (action === "PAUSE") {
      const result = await admin.from("ai_acquisition_tasks").update({ status: "PAUSING", pause_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "RUNNING");
      if (result.error) throw result.error;
    } else if (action === "RESUME") {
      if (task.status !== "PAUSED") return NextResponse.json({ error: "只有已暂停任务可以恢复" }, { status: 409 });
      const now = new Date();
      const pauseStarted = task.pause_started_at ? new Date(task.pause_started_at).getTime() : now.getTime();
      const pausedDuration = Number(task.paused_duration_ms || 0) + Math.max(0, now.getTime() - pauseStarted);
      const result = await admin.from("ai_acquisition_tasks").update({ status: "RUNNING", started_at: now.toISOString(), pause_started_at: null, paused_duration_ms: pausedDuration, executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", id).eq("status", "PAUSED");
      if (result.error) throw result.error;
      await admin.from("ai_screening_tasks").update({ status: "RUNNING", updated_at: now.toISOString() }).eq("request_key", `acquisition:${id}`).in("status", ["PAUSING","PAUSED"]);
    } else return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
    await admin.from("audit_logs").insert({ user_id: account.id, action: `AI_ACQUISITION_TASK_${action}`, target_type: "ai_acquisition_task", target_id: id, content: { task_number: task.task_number } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
