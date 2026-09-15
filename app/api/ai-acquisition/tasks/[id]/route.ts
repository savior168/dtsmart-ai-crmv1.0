import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "workflow/api";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";

async function authorizedTask(id: string, account: Awaited<ReturnType<typeof requirePermission>>["account"]) {
  const result = await createAdminClient().from("ai_acquisition_tasks").select("*").eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("TASK_NOT_FOUND");
  if (result.data.user_id !== account.id && !hasPermission(account, "ai.acquisition.data_all")) throw new Error("FORBIDDEN");
  return result.data;
}

function presentTask<T extends Record<string, unknown>>(task: T) {
  const scheduled = task.status === "QUEUED" && !task.started_at && task.last_dispatch_at && new Date(String(task.last_dispatch_at)).getTime() > Date.now()
    ? String(task.last_dispatch_at)
    : null;
  return { ...task, scheduled_at: scheduled };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const { id } = await context.params;
    const task = await authorizedTask(id, account);
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const decision = request.nextUrl.searchParams.get("decision") || "";
    const search = (request.nextUrl.searchParams.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const country = request.nextUrl.searchParams.get("country") || "";
    const level = request.nextUrl.searchParams.get("level") || "";
    const readiness = request.nextUrl.searchParams.get("readiness") || "";
    let query = createAdminClient().from("ai_acquisition_candidates").select("*", { count: "exact" }).eq("task_id", id);
    if (decision) query = query.eq("decision", decision);
    if (search) query = query.or(`company_name.ilike.%${search}%,address.ilike.%${search}%`);
    if (country) query = query.eq("country", country);
    if (["A","B","C","D"].includes(level)) query = query.eq("ai_level", level);
    if (readiness === "ACTIONABLE") query = query.eq("has_actionable_contact", true).eq("evidence_complete", true);
    if (readiness === "NO_CONTACT") query = query.eq("has_actionable_contact", false);
    if (readiness === "EVIDENCE_GAP") query = query.eq("evidence_complete", false);
    const candidates = await query.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (candidates.error) throw candidates.error;
    const screeningTaskRows = await createAdminClient().from("ai_acquisition_candidates").select("screening_task_id").eq("task_id", id).not("screening_task_id", "is", null).limit(500);
    if (screeningTaskRows.error) throw screeningTaskRows.error;
    const screeningIds = [...new Set((screeningTaskRows.data || []).map((row) => String(row.screening_task_id || "")).filter(Boolean))];
    const taskIds = [id, ...screeningIds];
    const canViewUsage = hasPermission(account, "ai.acquisition.usage.view");
    const [costs, usageSummary] = canViewUsage ? await Promise.all([
      createAdminClient().from("api_cost_ledger").select("provider,model_or_sku,operation,amount_usd,amount_type,quantity,occurred_at,metadata").in("task_id", taskIds).order("occurred_at", { ascending: false }).limit(200),
      createAdminClient().rpc("get_ai_acquisition_usage_summary", { p_task_id: id }),
    ]) : [{ data: [], error: null }, { data: null, error: null }];
    if (costs.error) throw costs.error;
    if (usageSummary.error) throw usageSummary.error;
    return NextResponse.json({ task: presentTask(task), candidates: candidates.data || [], count: candidates.count || 0, costs: costs.data || [], usage_summary: usageSummary.data, can_view_evidence: hasPermission(account, "ai.acquisition.evidence.view"), can_view_usage: canViewUsage, can_control: hasPermission(account, "ai.acquisition.control") && (task.user_id === account.id || account.role === "ADMIN") });
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
    } else if (action === "RETRY") {
      if (task.status !== "FAILED") return NextResponse.json({ error: "只有失败任务可以重试" }, { status: 409 });
      const child = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${id}`).maybeSingle();
      if (child.error) throw child.error;
      if (child.data) {
        const failedItems = await admin.from("ai_screening_task_items").select("id").eq("task_id", child.data.id).in("status", ["FAILED","RUNNING"]);
        if (failedItems.error) throw failedItems.error;
        const itemIds = (failedItems.data || []).map((row) => String(row.id));
        if (itemIds.length) {
          const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", itemIds);
          if (invalidated.error) throw invalidated.error;
          const resetItems = await admin.from("ai_screening_task_items").update({ status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null, result_id: null, progress: 0, current_step: "WAITING", error_message: null, error_code: null, completed_at: null, updated_at: new Date().toISOString() }).in("id", itemIds);
          if (resetItems.error) throw resetItems.error;
        }
        await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: child.data.id });
        const resetChild = await admin.from("ai_screening_tasks").update({ status: "QUEUED", cancel_requested: false, error_message: null, completed_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: new Date().toISOString() }).eq("id", child.data.id);
        if (resetChild.error) throw resetChild.error;
      }
      const now = new Date().toISOString();
      const resetTask = await admin.from("ai_acquisition_tasks").update({ status: "QUEUED", cancel_requested: false, error_message: null, started_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: now, executor_heartbeat_at: null, updated_at: now }).eq("id", id).eq("status", "FAILED");
      if (resetTask.error) throw resetTask.error;
      const run = await start(aiAcquisitionWorkflow, [id]);
      const saved = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", updated_at: new Date().toISOString() }).eq("id", id);
      if (saved.error) throw saved.error;
    } else return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
    await admin.from("audit_logs").insert({ user_id: account.id, action: `AI_ACQUISITION_TASK_${action}`, target_type: "ai_acquisition_task", target_id: id, content: { task_number: task.task_number } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
