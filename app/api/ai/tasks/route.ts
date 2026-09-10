import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiScreeningWorkflow } from "@/workflows/ai-screening";
import { getReservedAiCustomerIds } from "@/lib/ai/task-eligibility";
import { resolveAiOwnerScope } from "@/lib/ai/owner-scope";

function taskNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AI-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.tasks.view");
    const canViewAiUsage = hasPermission(account, "ai.usage.view");
    const canViewHistoricalCost = hasPermission(account, "ai.cost_summary.view");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const status = params.get("status") || "";
    const search = params.get("search")?.trim() || "";
    const selectionMode = params.get("selection_mode") || "";
    const from = params.get("date_from") || "";
    const to = params.get("date_to") || "";
    const scopeUserId = await requestedOwnerId(request, account, "ai.data_all");
    const admin = createAdminClient();
    let query = admin.from("ai_screening_tasks").select("*", { count: "exact" }).is("archived_at", null);
    if (scopeUserId) query = query.eq("user_id", scopeUserId);
    if (status === "ACTIVE") query = query.in("status", ["QUEUED", "RUNNING", "PAUSING"]);
    else if (status) query = query.eq("status", status);
    if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
    if (selectionMode) query = query.eq("selection_mode", selectionMode);
    if (from) query = query.gte("created_at", `${from}T00:00:00`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999`);
    const result = await query.order("updated_at", { ascending: false }).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const ownerIds = Array.from(new Set((result.data || []).map((task) => String(task.user_id || "")).filter(Boolean)));
    const owners = ownerIds.length ? await admin.from("users").select("id,name,email").in("id", ownerIds) : { data: [], error: null };
    if (owners.error) throw owners.error;
    const ownerById = new Map((owners.data || []).map((owner) => [owner.id, owner]));
    const pageTaskIds = (result.data || []).map((task) => String(task.id));
    const googleCostByTask = new Map<string, number>();
    if (pageTaskIds.length) {
      for (let offset = 0; ; offset += 1000) {
        const googleCosts = await admin.from("api_cost_ledger").select("task_id,amount_usd").eq("provider", "GOOGLE_PLACES").in("task_id", pageTaskIds).range(offset, offset + 999);
        if (googleCosts.error) throw googleCosts.error;
        for (const row of googleCosts.data || []) {
          const taskId = String(row.task_id || "");
          if (taskId) googleCostByTask.set(taskId, (googleCostByTask.get(taskId) || 0) + Number(row.amount_usd || 0));
        }
        if ((googleCosts.data || []).length < 1000) break;
      }
    }
    const taskRows = (result.data || []).map((task) => {
      const google_places_cost_usd = googleCostByTask.get(String(task.id)) || 0;
      return { ...task, owner: ownerById.get(task.user_id) || null, google_places_cost_usd, third_party_cost_usd: Number(task.total_cost_usd || 0) + google_places_cost_usd };
    });
    const all: Array<{ id: string; status: string; total_count: number; success_count: number; failed_count: number; total_tokens: number; total_cost_usd: number; created_at: string }> = [];
    for (let offset = 0; ; offset += 1000) {
      let statsQuery = admin.from("ai_screening_tasks")
        .select("id,status,total_count,success_count,failed_count,total_tokens,total_cost_usd,created_at")
        .is("archived_at", null)
        .order("updated_at", { ascending: false });
      if (scopeUserId) statsQuery = statsQuery.eq("user_id", scopeUserId);
      const stats = await statsQuery.range(offset, offset + 999);
      if (stats.error) throw stats.error;
      const rows = stats.data || [];
      all.push(...rows);
      if (rows.length < 1000) break;
    }
    const counts = {
      all: all.length,
      active: all.filter((item) => ["QUEUED", "RUNNING", "PAUSING"].includes(item.status)).length,
      running: all.filter((item) => item.status === "RUNNING").length,
      queued: all.filter((item) => item.status === "QUEUED").length,
      completed: all.filter((item) => item.status === "COMPLETED").length,
      failed: all.filter((item) => item.status === "FAILED").length,
    };
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = `${today}T00:00:00.000Z`;
    const ownedTaskIds = all.map((item) => item.id);
    const countItems = async (statusValue: string, since?: string, retryableOnly = false) => {
      if (!ownedTaskIds.length) return 0;
      let total = 0;
      for (let offset = 0; offset < ownedTaskIds.length; offset += 100) {
        let itemQuery = admin.from("ai_screening_task_items")
          .select("id", { count: "exact", head: true })
          .in("task_id", ownedTaskIds.slice(offset, offset + 100))
          .eq("status", statusValue);
        if (since) itemQuery = itemQuery.gte("completed_at", since);
        if (retryableOnly) itemQuery = itemQuery.lt("attempt_count", 3);
        const counted = await itemQuery;
        if (counted.error) throw counted.error;
        total += counted.count || 0;
      }
      return total;
    };
    // Cost and completed-customer cards read the immutable audit ledgers. They
    // therefore remain stable after a task or CRM customer is physically deleted.
    const todayCostPromise = canViewAiUsage ? (async () => {
      let total = 0;
      for (let rowOffset = 0; ; rowOffset += 1000) {
        let callsQuery = admin.from("ai_screening_usage_ledger").select("cost_usd").gte("occurred_at", todayStart);
        if (scopeUserId) callsQuery = callsQuery.eq("user_id", scopeUserId);
        const calls = await callsQuery.range(rowOffset, rowOffset + 999);
        if (calls.error) throw calls.error;
        const rows = calls.data || [];
        total += rows.reduce((sum, call) => sum + Number(call.cost_usd || 0), 0);
        if (rows.length < 1000) break;
      }
      return total;
    })() : Promise.resolve(0);
    let todayCompletedQuery = admin.from("ai_screening_completion_ledger")
      .select("source_task_item_id", { count: "exact", head: true })
      .gte("completed_at", todayStart);
    if (scopeUserId) todayCompletedQuery = todayCompletedQuery.eq("user_id", scopeUserId);
    const pendingScope = await resolveAiOwnerScope(account);
    let pendingCustomersQuery = admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .is("ai_score", null);
    // 待筛选统计遵循创建任务时可选择的数据范围：销售员仅本人；主管为
    // 本人及直属下属；系统管理员为全系统（含尚未归属的公海客户）。
    if (pendingScope.ownerIds) pendingCustomersQuery = pendingCustomersQuery.in("owner_id", pendingScope.ownerIds);
    const [retryableCount, todayCompleted, todayFailedCount, todayCost, pendingCustomers] = await Promise.all([
      countItems("FAILED", undefined, true),
      todayCompletedQuery,
      countItems("FAILED", todayStart),
      todayCostPromise,
      pendingCustomersQuery,
    ]);
    if (pendingCustomers.error) throw pendingCustomers.error;
    if (todayCompleted.error) throw todayCompleted.error;
    const pendingCustomerCount = pendingCustomers.count || 0;
    // The all-time system-wide cost summary is finance-sensitive. It defaults
    // to administrators, but the permission center may explicitly delegate it.
    // Enforce that decision in the API rather than merely hiding the browser UI.
    const historical = canViewHistoricalCost
      ? await admin.rpc("ai_screening_historical_cost_summary", { p_user_id: null })
      : null;
    if (historical?.error) throw historical.error;
    const historicalSummary = (historical?.data || {}) as Record<string, unknown>;
    return NextResponse.json({
      data: taskRows, count: result.count || 0, counts, show_owner: account.role !== "SALES",
      pending_customers: pendingCustomerCount,
      today_cost: canViewAiUsage ? todayCost : null,
      today_completed_customers: todayCompleted.count || 0,
      today_failed_customers: todayFailedCount,
      retry_customers: retryableCount,
      show_ai_usage: canViewAiUsage,
      show_historical_cost_summary: canViewHistoricalCost,
      historical_summary: canViewHistoricalCost ? {
        processed_customers: Number(historicalSummary.processed_customers || 0),
        total_third_party_cost_usd: Number(historicalSummary.total_third_party_cost_usd || 0),
        average_cost_per_customer_usd: Number(historicalSummary.average_cost_per_customer_usd || 0),
        provider_costs: historicalSummary.provider_costs || {},
      } : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务列表查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, account } = await requirePermission("ai.tasks.create");
    const body = await request.json() as {
      name?: string; strategy?: string; scheduled_at?: string | null; customer_ids?: string[];
      filters?: Record<string, unknown>; notification_mode?: string; request_key?: string;
    };
    const name = body.name?.trim();
    // The product exposes one adaptive mode. Keep SMART as the stored legacy
    // value so historical workflows remain compatible; the runner itself
    // escalates uncertain cases to the deeper model tier when justified.
    const strategy = "SMART" as const;
    if (!name) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
    const requestedIds = [...new Set((body.customer_ids || []).filter(Boolean))];
    if (!requestedIds.length) return NextResponse.json({ error: "请至少选择一条待筛选客户" }, { status: 400 });
    const ownerScope = await resolveAiOwnerScope(account, String(body.filters?.owner_id || ""));

    const allowedIds: string[] = [];
    for (let offset = 0; offset < requestedIds.length; offset += 200) {
      const ids = requestedIds.slice(offset, offset + 200);
      let allowedQuery = createAdminClient().from("customers").select("id").in("id", ids).is("deleted_at", null).is("ai_score", null);
      if (ownerScope.ownerIds) allowedQuery = allowedQuery.in("owner_id", ownerScope.ownerIds);
      const allowed = await allowedQuery;
      if (allowed.error) throw allowed.error;
      allowedIds.push(...(allowed.data || []).map((item) => item.id));
    }
    const admin = createAdminClient();
    const requestKey = body.request_key?.trim().slice(0, 120) || null;
    if (requestKey) {
      const existing = await admin.from("ai_screening_tasks").select("*").eq("user_id", user.id).eq("request_key", requestKey).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return NextResponse.json({ task: existing.data, idempotent: true }, { status: 200 });
    }
    const allReserved = await getReservedAiCustomerIds();
    const reserved=new Set(allowedIds.filter((id)=>allReserved.has(id)));
    const eligibleIds=allowedIds.filter(id=>!reserved.has(id));
    if (!eligibleIds.length) return NextResponse.json({ error: "所选客户已完成AI筛选、已删除、无权访问或已加入其他活动任务" }, { status: 409 });

    const scheduledAt = body.scheduled_at && new Date(body.scheduled_at).getTime() > Date.now() ? new Date(body.scheduled_at).toISOString() : null;
    const task = await admin.from("ai_screening_tasks").insert({
      user_id: user.id, task_number: taskNumber(), name, strategy, strategy_version: "1.0",
      status: "QUEUED", total_count: eligibleIds.length, pending_count: eligibleIds.length,
      filters: body.filters || {}, selection_mode: "FILTERED", scheduled_at: scheduledAt,
      notification_mode: body.notification_mode || "IN_APP",
      request_key: requestKey,
    }).select("*").single();
    if (task.error || !task.data) throw task.error || new Error("任务创建失败");
    const rows = eligibleIds.map((customerId) => ({
      task_id: task.data.id, customer_id: customerId, status: "PENDING", strategy, strategy_version: "1.0",
    }));
    for (let offset = 0; offset < rows.length; offset += 500) {
      const inserted = await admin.from("ai_screening_task_items").insert(rows.slice(offset, offset + 500));
      if (inserted.error) throw inserted.error;
    }
    const run = await start(aiScreeningWorkflow, [{ taskId: task.data.id, strategy, scheduledAt }]);
    await admin.from("ai_screening_tasks").update({ workflow_run_id: run.runId, updated_at: new Date().toISOString() }).eq("id", task.data.id);
    await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_TASK_CREATE", target_type: "ai_screening_task", target_id: task.data.id, content: { task_number: task.data.task_number, strategy, total_count: eligibleIds.length } });
    return NextResponse.json({ task: { ...task.data, workflow_run_id: run.runId } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务创建失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
