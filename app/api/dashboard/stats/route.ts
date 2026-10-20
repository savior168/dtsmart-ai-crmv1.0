import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { normalizeReportCountries } from "@/lib/reports/sales";
import { followupDayBounds } from "@/lib/customers/followup-day";
import { createAdminClient } from "@/lib/supabase/admin";
import { countryFilterOptions, countryFilterRawValues } from "@/lib/countries";
import { DASHBOARD_BASE_DATE, dashboardBusinessDateKey, dashboardDefaultDateRange } from "@/lib/dashboard-date-range";
import { loadStockProgressItems } from "@/lib/stock-progress-query";
import { stockProgressLabel, summarizeStockProgress } from "@/lib/stock-progress";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";

type CountRow = { grade?: string; name?: string; count: number };

function validDate(value: string | null, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function percentage(value: number, total: number) {
  return total ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function activityText(action: string, customerName: string, content: unknown) {
  const details = content && typeof content === "object" ? content as Record<string, unknown> : {};
  if (action === "FOLLOWUP_CREATE") return `更新了客户 ${customerName} 的跟进记录`;
  if (action === "CUSTOMER_CREATE") return `新增了客户 ${customerName}`;
  if (action === "CUSTOMER_UPDATE") return `更新了客户 ${customerName} 的资料`;
  if (action === "CUSTOMER_STAGE") return `将客户 ${customerName} 更新为 ${String(details.status || "新阶段")}`;
  if (action === "AI_ANALYZE") return `完成了客户 ${customerName} 的 AI 筛选`;
  return `完成了客户 ${customerName} 的操作`;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("dashboard.view");
    const scopeUserId = await requestedOwnerId(request, account, "dashboard.data_all");
    // The invoker follow-up view requires table-level customers SELECT, while
    // authenticated callers intentionally have only safe column grants.
    // Read it server-side after the requested owner scope has been validated.
    const followupReader = createAdminClient();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const protectionEnd = new Date(todayStart);
    protectionEnd.setDate(protectionEnd.getDate() + 8);

    if (request.nextUrl.searchParams.get("summary") === "1") {
      const followupDay = followupDayBounds(now);
      let followupsQuery = followupReader.from("customer_followup_queue").select("id", { count: "exact", head: true }).gte("next_follow_date", followupDay.start).lt("next_follow_date", followupDay.end);
      let protectionsQuery = supabase.from("customer_protection").select("id", { count: "exact", head: true }).eq("status", "ACTIVE").not("expire_date", "is", null).gte("expire_date", todayStart.toISOString()).lt("expire_date", protectionEnd.toISOString());
      if (scopeUserId) {
        followupsQuery = followupsQuery.eq("owner_id", scopeUserId);
        protectionsQuery = protectionsQuery.eq("owner_id", scopeUserId);
      }
      const [followups, protections] = await Promise.all([followupsQuery, protectionsQuery]);
      if (followups.error) throw new Error(followups.error.message);
      if (protections.error) throw new Error(protections.error.message);
      return NextResponse.json({ totals: { today_followups: followups.count || 0, expiring_protection: protections.count || 0 } }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
    }

    const defaultFrom = new Date(`${DASHBOARD_BASE_DATE}T00:00:00+08:00`);
    const defaultTo = new Date(`${dashboardDefaultDateRange(now).to}T00:00:00+08:00`);
    const fromDate = validDate(request.nextUrl.searchParams.get("from"), defaultFrom);
    const toDate = validDate(request.nextUrl.searchParams.get("to"), defaultTo);
    const exclusiveTo = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    const country = request.nextUrl.searchParams.get("country")?.trim() || "";
    const countryValues = country ? countryFilterRawValues([country]) : [];
    const aiLevel = request.nextUrl.searchParams.get("ai_level")?.trim() || "";

    // Keep aggregation in Postgres. The former route copied every matching
    // customer into the application process and could hit statement_timeout.
    const { data, error } = await supabase.rpc("dashboard_overview", {
      p_from: fromDate.toISOString(), p_to: exclusiveTo.toISOString(),
      p_scope_user_id: scopeUserId, p_country: countryValues.length ? countryValues.join("\u001f") : null, p_ai_level: aiLevel || null,
    });
    if (error) throw new Error(error.message);
    const overview = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const totals = (overview.totals && typeof overview.totals === "object" ? overview.totals : {}) as Record<string, number>;
    const totalCustomers = Number(totals.my_customers || 0);
    const distribution = ((overview.distribution || []) as CountRow[]).map((item) => ({ grade: item.grade || "未筛选", count: Number(item.count || 0), percentage: percentage(Number(item.count || 0), totalCustomers) }));
    const countryTop = normalizeReportCountries(((overview.country_top || []) as CountRow[]).map((item) => ({
      label: item.name || "未知", count: Number(item.count || 0),
    }))).map((item) => ({ name: item.label, count: item.count, percentage: percentage(item.count, totalCustomers) }));
    // Funnel statuses are intentionally counted directly: they are mutually
    // meaningful business states, not the remainder after later-stage totals.
    // These indexed count queries preserve the selected scope and filters.
    const statusCount = (status: "CLAIMED" | "FOLLOWING") => {
      let query = supabase.from("customers").select("id", { count: "exact", head: true })
        .is("deleted_at", null).not("owner_id", "is", null).gte("created_at", fromDate.toISOString()).lt("created_at", exclusiveTo.toISOString()).eq("status", status);
      if (scopeUserId) query = query.eq("owner_id", scopeUserId);
      if (countryValues.length) query = query.in("country", countryValues);
      if (aiLevel) query = query.eq("ai_level", aiLevel);
      return query;
    };
    let validCustomersQuery = supabase.from("customers").select("id", { count: "exact", head: true })
      .is("deleted_at", null).not("owner_id", "is", null).neq("status", "RELEASED").gte("created_at", fromDate.toISOString()).lt("created_at", exclusiveTo.toISOString())
      .eq("ai_status", "COMPLETED").eq("ai_screening_done", true).eq("is_target_customer", true);
    if (scopeUserId) validCustomersQuery = validCustomersQuery.eq("owner_id", scopeUserId);
    if (countryValues.length) validCustomersQuery = validCustomersQuery.in("country", countryValues);
    if (aiLevel) validCustomersQuery = validCustomersQuery.eq("ai_level", aiLevel);
    const followupDay = followupDayBounds(now);
    let todayFollowupsQuery = followupReader.from("customer_followup_queue")
      .select("id,customer_id,company_name,contact_name,phone,email,country,ai_level,created_at,next_follow_date,type,status", { count: "exact" })
      .gte("next_follow_date", followupDay.start).lt("next_follow_date", followupDay.end)
      .order("next_follow_date", { ascending: true }).order("customer_id", { ascending: true }).limit(5);
    if (scopeUserId) todayFollowupsQuery = todayFollowupsQuery.eq("owner_id", scopeUserId);
    if (countryValues.length) todayFollowupsQuery = todayFollowupsQuery.in("country", countryValues);
    const [potentialCustomersResult, followingCustomersResult, validCustomersResult, todayFollowupsResult, systemCustomersResult] = await Promise.all([
      statusCount("CLAIMED"), statusCount("FOLLOWING"), validCustomersQuery, todayFollowupsQuery,
      account.role === "ADMIN" ? supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null).or("pool_status.is.null,pool_status.neq.AI_STAGING") : Promise.resolve(null),
    ]);
    if (potentialCustomersResult.error) throw new Error(potentialCustomersResult.error.message);
    if (followingCustomersResult.error) throw new Error(followingCustomersResult.error.message);
    if (validCustomersResult.error) throw new Error(validCustomersResult.error.message);
    if (todayFollowupsResult.error) throw new Error(todayFollowupsResult.error.message);
    if (systemCustomersResult?.error) throw new Error(systemCustomersResult.error.message);
    const todayFollowups = (todayFollowupsResult.data || []).map((row) => ({
      id: row.id, customer_id: row.customer_id, customer_name: row.contact_name, company_name: row.company_name,
      phone: row.phone, email: row.email, country: row.country, ai_level: row.ai_level,
      last_followup: row.created_at, followup_time: row.next_follow_date, type: row.type, status: row.status,
    }));
    const funnelRows = [
      { label: "潜在客户", value: Number(potentialCustomersResult.count || 0) }, { label: "意向客户", value: Number(followingCustomersResult.count || 0) },
      { label: "成交客户", value: Number(totals.deals || 0) },
    ];
    const stockActivityMode = ["SALES", "SUPERVISOR"].includes(account.role) && hasPermission(account, "stock.view");
    let activities = ((overview.activities || []) as Array<Record<string, unknown>>).map((item) => ({ id: String(item.id), action: String(item.action || ""), text: activityText(String(item.action || ""), String(item.customer_name || "客户"), item.content), created_at: String(item.created_at || ""), href: "" }));
    if (stockActivityMode) {
      const stockOwnerId = await requestedOwnerId(request, account, "stock.data_all");
      let stockQuery = supabase.from("stock_orders_with_pi_preparer")
        .select("id,sales_order_id,customer_short_name,stock_number,warehouse_reference_number,status,pi_updated_at")
        .in("status", ["WAITING", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED", "SHORTAGE"])
        .gte("pi_updated_at", fromDate.toISOString()).lt("pi_updated_at", exclusiveTo.toISOString())
        .order("pi_updated_at", { ascending: false }).order("id", { ascending: true }).limit(5);
      if (stockOwnerId) stockQuery = stockQuery.eq("sales_user_id", stockOwnerId);
      if (countryValues.length) stockQuery = stockQuery.in("destination_country", countryValues);
      const stockRows = await stockQuery;
      if (stockRows.error) throw stockRows.error;
      const progressItems = await loadStockProgressItems(supabase, (stockRows.data || []).map((row) => row.id));
      const customerNames = await loadOrderCustomerNames((stockRows.data || []).map((row) => row.sales_order_id));
      activities = (stockRows.data || []).map((row) => {
        const progress = summarizeStockProgress(row.status, progressItems.get(row.id) || []);
        return { id: row.id, action: "STOCK_PROGRESS", text: "", created_at: row.pi_updated_at,
          href: `/orders/${row.sales_order_id}`, stock_href: `/stock-orders/${row.id}`,
          pi_number: row.warehouse_reference_number || "未编号", customer_name: customerNames.get(row.sales_order_id) || "",
          company_name: row.customer_short_name || "", status_label: stockProgressLabel(progress), progress };
      });
    }

    return NextResponse.json({
      scope: scopeUserId || "ALL", range: { from: dashboardBusinessDateKey(fromDate), to: dashboardBusinessDateKey(toDate) }, filters: { countries: countryFilterOptions(Array.isArray((overview.filters as { countries?: unknown } | undefined)?.countries) ? (overview.filters as { countries: Array<string | null> }).countries : []) },
      totals: { my_customers: totalCustomers, system_customers: account.role === "ADMIN" ? systemCustomersResult?.count ?? 0 : null, pending_ai: Number(totals.pending_ai || 0), valid_customers: Number(validCustomersResult.count || 0), intentions: Number(potentialCustomersResult.count || 0), today_followups: Number(todayFollowupsResult.count || 0), expiring_protection: Number(totals.expiring_protection || 0), quotes: Number(totals.quotes || 0), deals: Number(totals.deals || 0) },
      distribution, funnel: funnelRows.map((item) => ({ ...item, percentage: percentage(item.value, totalCustomers) })), country_top: countryTop,
      protections: overview.protections || [], followups: todayFollowups, activities, activity_mode: stockActivityMode ? "STOCK_PROGRESS" : "CUSTOMER",
    }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作台数据加载失败";
    const status = message === "UNAUTHORIZED" || message === "SESSION_REVOKED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录已失效，请重新登录" : message }, { status });
  }
}
