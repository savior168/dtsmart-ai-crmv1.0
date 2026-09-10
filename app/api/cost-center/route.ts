import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { costLedgerRange } from "@/lib/cost-center";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("costs.view");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") || 20)));
    const settings = await supabase.from("cost_center_settings").select("updated_at,google_daily_limit_usd,google_weekly_limit_usd,google_monthly_limit_usd,openai_daily_limit_usd,openai_weekly_limit_usd,openai_monthly_limit_usd").eq("id", true).single();
    if (settings.error) throw settings.error;
    const range = costLedgerRange(params.get("from"), params.get("to"));
    const from = range.from;
    const to = range.to;
    let rowsQuery = supabase.from("api_cost_ledger")
      .select("id,user_id,customer_id,task_id,provider,service,operation,model_or_sku,quantity,unit,input_tokens,cached_input_tokens,output_tokens,amount_usd,amount_type,pricing_snapshot,metadata,occurred_at", { count: "exact" })
      .gte("occurred_at", from).lt("occurred_at", to).order("occurred_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    const provider = params.get("provider")?.trim();
    const operation = params.get("operation")?.trim();
    const userId = params.get("user_id")?.trim();
    const taskId = params.get("task_id")?.trim();
    const customerId = params.get("customer_id")?.trim();
    if (provider) rowsQuery = rowsQuery.eq("provider", provider);
    const safeOperation = operation?.replace(/[%_,()]/g, "").trim() || "";
    if (safeOperation) rowsQuery = rowsQuery.or(`operation.ilike.%${safeOperation}%,model_or_sku.ilike.%${safeOperation}%`);
    if (userId) rowsQuery = rowsQuery.eq("user_id", userId);
    if (taskId) rowsQuery = rowsQuery.eq("task_id", taskId);
    if (customerId) rowsQuery = rowsQuery.eq("customer_id", customerId);
    const admin = createAdminClient();
    const [{ data, error, count }, summary, budgetStatus, optionUsers, optionTasks, optionCustomers] = await Promise.all([
      rowsQuery,
      supabase.rpc("cost_center_summary_filtered", { p_from: from, p_to: to, p_provider: provider || null, p_operation: safeOperation || null, p_user_id: userId || null, p_task_id: taskId || null, p_customer_id: customerId || null }),
      admin.rpc("api_cost_budget_status"),
      admin.from("users").select("id,name,email").order("name").limit(500),
      admin.from("ai_screening_tasks").select("id,name,task_number").order("created_at", { ascending: false }).limit(500),
      admin.from("customers").select("id,company_name").is("deleted_at", null).order("company_name").limit(500),
    ]);
    if (error) throw error;
    if (summary.error) throw summary.error;
    if (budgetStatus.error) throw budgetStatus.error;
    if (optionUsers.error) throw optionUsers.error;
    if (optionTasks.error) throw optionTasks.error;
    if (optionCustomers.error) throw optionCustomers.error;
    const rows = data || [];
    const userIds = [...new Set(rows.map((row) => row.user_id).filter((value): value is string => Boolean(value)))];
    const taskIds = [...new Set(rows.map((row) => row.task_id).filter((value): value is string => Boolean(value)))];
    const customerIds = [...new Set(rows.map((row) => row.customer_id).filter((value): value is string => Boolean(value)))];
    const users = userIds.length ? await admin.from("users").select("id,name,email").in("id", userIds) : { data: [], error: null };
    const tasks = taskIds.length ? await admin.from("ai_screening_tasks").select("id,name,task_number").in("id", taskIds) : { data: [], error: null };
    const customers = customerIds.length ? await admin.from("customers").select("id,company_name").in("id", customerIds) : { data: [], error: null };
    if (users.error) throw users.error;
    if (tasks.error) throw tasks.error;
    if (customers.error) throw customers.error;
    const userMap = new Map((users.data || []).map((user) => [user.id, { name: user.name, email: user.email }]));
    const taskMap = new Map((tasks.data || []).map((task) => [task.id, { name: task.name, task_number: task.task_number }]));
    const customerMap = new Map((customers.data || []).map((customer) => [customer.id, { company_name: customer.company_name }]));
    return NextResponse.json({
      data: rows.map((row) => ({ ...row, user: row.user_id ? userMap.get(row.user_id) || { name: "历史账号", email: null } : null, task: row.task_id ? taskMap.get(row.task_id) || { name: "已删除任务", task_number: null } : null, customer: row.customer_id ? customerMap.get(row.customer_id) || { company_name: "已删除客户" } : null })), count: count || 0, page, page_size: pageSize,
      effective_from: from, effective_to: to,
      summary: summary.data || {},
      budgets: budgetStatus.data || {}, settings: settings.data,
      filter_options: { users: optionUsers.data || [], tasks: optionTasks.data || [], customers: optionCustomers.data || [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用中心加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await requireAdmin();
    const body = await request.json() as { action?: string; budgets?: Record<string, unknown> };
    if (body.action === "UPDATE_BUDGETS") {
      const keys = ["google_daily_limit_usd","google_weekly_limit_usd","google_monthly_limit_usd","openai_daily_limit_usd","openai_weekly_limit_usd","openai_monthly_limit_usd"] as const;
      const updates: Record<string, number | null | string> = { updated_by: user.id, updated_at: new Date().toISOString() };
      for (const key of keys) {
        const raw = body.budgets?.[key];
        if (raw === "" || raw == null) updates[key] = null;
        else { const value = Number(raw); if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "费用上限必须为大于或等于0的金额；留空表示不限制" }, { status: 400 }); updates[key] = Number(value.toFixed(6)); }
      }
      const saved = await supabase.from("cost_center_settings").update(updates).eq("id", true).select("*").single();
      if (saved.error) throw saved.error;
      await writeAudit(supabase, user.id, "API_COST_BUDGETS_UPDATED", "cost_center_settings", null, { budgets: Object.fromEntries(keys.map((key) => [key, updates[key]])) });
      return NextResponse.json({ data: saved.data });
    }
    return NextResponse.json({ error: "不支持的费用中心操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用统计周期更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
