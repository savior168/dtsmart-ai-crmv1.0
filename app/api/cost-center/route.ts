import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { costLedgerRange } from "@/lib/cost-center";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selectedIds = (request: NextRequest, key: string) => [...new Set(request.nextUrl.searchParams.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => uuidPattern.test(value)))].slice(0, 50);

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
    const taskIds = selectedIds(request, "task_id");
    const customerIds = selectedIds(request, "customer_id");
    if (provider) rowsQuery = rowsQuery.eq("provider", provider);
    const safeOperation = operation?.replace(/[%_,()]/g, "").trim() || "";
    if (safeOperation) rowsQuery = rowsQuery.or(`operation.ilike.%${safeOperation}%,model_or_sku.ilike.%${safeOperation}%`);
    if (userId) rowsQuery = rowsQuery.eq("user_id", userId);
    if (taskIds.length) rowsQuery = rowsQuery.in("task_id", taskIds);
    if (customerIds.length) rowsQuery = rowsQuery.in("customer_id", customerIds);
    const admin = createAdminClient();
    const [{ data, error, count }, summary, budgetStatus, optionUsers] = await Promise.all([
      rowsQuery,
      supabase.rpc("cost_center_summary_multi_filtered", { p_from: from, p_to: to, p_provider: provider || null, p_operation: safeOperation || null, p_user_id: userId || null, p_task_ids: taskIds.length ? taskIds : null, p_customer_ids: customerIds.length ? customerIds : null }),
      admin.rpc("api_cost_budget_status"),
      admin.from("users").select("id,name,email").order("name").limit(500),
    ]);
    if (error) throw error;
    if (summary.error) throw summary.error;
    if (budgetStatus.error) throw budgetStatus.error;
    if (optionUsers.error) throw optionUsers.error;
    const rows = data || [];
    const userIds = [...new Set(rows.map((row) => row.user_id).filter((value): value is string => Boolean(value)))];
    const rowTaskIds = [...new Set(rows.map((row) => row.task_id).filter((value): value is string => Boolean(value)))];
    const rowCustomerIds = [...new Set(rows.map((row) => row.customer_id).filter((value): value is string => Boolean(value)))];
    const users = userIds.length ? await admin.from("users").select("id,name,email").in("id", userIds) : { data: [], error: null };
    const tasks = rowTaskIds.length ? await admin.from("ai_screening_tasks").select("id,name,task_number").in("id", rowTaskIds) : { data: [], error: null };
    const customers = rowCustomerIds.length ? await admin.from("customers").select("id,company_name").in("id", rowCustomerIds) : { data: [], error: null };
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
      filter_options: { users: optionUsers.data || [] },
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
      for (const prefix of ["google", "openai"] as const) {
        const daily = updates[`${prefix}_daily_limit_usd`];
        const weekly = updates[`${prefix}_weekly_limit_usd`];
        const monthly = updates[`${prefix}_monthly_limit_usd`];
        if (typeof daily === "number" && typeof weekly === "number" && daily > weekly) return NextResponse.json({ error: `${prefix === "google" ? "Google Places" : "OpenAI"} 每日上限不能高于每周上限` }, { status: 400 });
        if (typeof daily === "number" && typeof monthly === "number" && daily > monthly) return NextResponse.json({ error: `${prefix === "google" ? "Google Places" : "OpenAI"} 每日上限不能高于每月上限` }, { status: 400 });
        if (typeof weekly === "number" && typeof monthly === "number" && weekly > monthly) return NextResponse.json({ error: `${prefix === "google" ? "Google Places" : "OpenAI"} 每周上限不能高于每月上限` }, { status: 400 });
      }
      const saved = await supabase.from("cost_center_settings").update(updates).eq("id", true).select("*").single();
      if (saved.error) throw saved.error;
      await writeAudit(supabase, user.id, "API_COST_BUDGETS_UPDATED", "cost_center_settings", null, { budgets: Object.fromEntries(keys.map((key) => [key, updates[key]])) });
      return NextResponse.json({ data: saved.data });
    }
    return NextResponse.json({ error: "不支持的费用中心操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用控制设置更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
