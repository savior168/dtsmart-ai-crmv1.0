import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { costPeriodRange, normalizeCostPeriod } from "@/lib/cost-center";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("costs.view");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") || 20)));
    const settings = await supabase.from("cost_center_settings").select("accounting_start_at,updated_at").eq("id", true).single();
    if (settings.error) throw settings.error;
    const period = normalizeCostPeriod(params.get("period"));
    const range = costPeriodRange({
      period,
      accountingStartAt: settings.data.accounting_start_at,
      from: params.get("from"),
      to: params.get("to"),
    });
    const from = range.from;
    const to = range.to;
    if (range.empty) {
      return NextResponse.json({
        data: [], count: 0, page, page_size: pageSize, period,
        accounting_start_at: settings.data.accounting_start_at,
        settings_updated_at: settings.data.updated_at,
        effective_from: from, effective_to: to,
        summary: { total_usd: 0, request_count: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, estimated_usd: 0, final_usd: 0, unknown_pricing_count: 0, providers: [] },
      });
    }
    let rowsQuery = supabase.from("api_cost_ledger")
      .select("id,user_id,customer_id,task_id,provider,service,operation,model_or_sku,quantity,unit,input_tokens,cached_input_tokens,output_tokens,amount_usd,amount_type,pricing_snapshot,metadata,occurred_at", { count: "exact" })
      .gte("occurred_at", from).lt("occurred_at", to).order("occurred_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    const provider = params.get("provider")?.trim();
    if (provider) rowsQuery = rowsQuery.eq("provider", provider);
    const [{ data, error, count }, summary] = await Promise.all([
      rowsQuery,
      supabase.rpc("cost_center_summary", { p_from: from, p_to: to }),
    ]);
    if (error) throw error;
    if (summary.error) throw summary.error;
    const rows = data || [];
    const userIds = [...new Set(rows.map((row) => row.user_id).filter((value): value is string => Boolean(value)))];
    const users = userIds.length ? await createAdminClient().from("users").select("id,name,email").in("id", userIds) : { data: [], error: null };
    if (users.error) throw users.error;
    const userMap = new Map((users.data || []).map((user) => [user.id, { name: user.name, email: user.email }]));
    return NextResponse.json({
      data: rows.map((row) => ({ ...row, user: row.user_id ? userMap.get(row.user_id) || { name: "历史账号", email: null } : null })), count: count || 0, page, page_size: pageSize, period,
      accounting_start_at: settings.data.accounting_start_at,
      settings_updated_at: settings.data.updated_at,
      effective_from: from, effective_to: to,
      summary: summary.data || {},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用中心加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await requireAdmin();
    const body = await request.json() as { action?: string; accounting_start_date?: string };
    const startAt = body.action === "RESET_NOW"
      ? new Date()
      : body.accounting_start_date
        ? new Date(`${body.accounting_start_date}T00:00:00+08:00`)
        : null;
    if (!startAt || !Number.isFinite(startAt.getTime()) || startAt > new Date()) {
      return NextResponse.json({ error: "正式费用统计开始日期不正确" }, { status: 400 });
    }
    const { data, error } = await supabase.from("cost_center_settings").update({
      accounting_start_at: startAt.toISOString(),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }).eq("id", true).select("accounting_start_at,updated_at").single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "COST_ACCOUNTING_PERIOD_RESET", "cost_center_settings", null, {
      accounting_start_at: data.accounting_start_at,
      mode: body.action === "RESET_NOW" ? "RESET_NOW" : "SET_DATE",
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用统计周期更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
