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
import { dashboardStockActivityText } from "@/lib/dashboard-stock-activity";
import { STOCK_STATUS_LABELS } from "@/lib/types";

type CountRow = { grade?: string; name?: string; count: number };

type DatabaseErrorLike = { message?: string; code?: string; status?: number; details?: string; hint?: string; stage?: string };

function preserveDatabaseError(error: DatabaseErrorLike, stage: string) {
  return Object.assign(new Error(error.message || "数据库查询失败"), {
    code: error.code,
    // PostgREST HEAD count requests can fail without a response body. Treat
    // that as a transient backend failure so the dashboard retries it.
    status: error.status || (!error.message && !error.code ? 503 : undefined),
    details: error.details,
    hint: error.hint,
    stage,
  });
}

function isTransientError(error: unknown) {
  const candidate = error as DatabaseErrorLike;
  const code = candidate?.code || "";
  const message = candidate?.message || (error instanceof Error ? error.message : "");
  return candidate?.status === 429 || (typeof candidate?.status === "number" && candidate.status >= 500)
    || /^(08|40|53|55|57|58)/.test(code) || ["57014", "PGRST000", "PGRST001", "PGRST002", "PGRST003"].includes(code)
    || /timeout|timed out|temporarily unavailable|connection (?:reset|closed|refused)|fetch failed|network error/i.test(message);
}

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
      if (followups.error) throw preserveDatabaseError(followups.error, "summary-followups");
      if (protections.error) throw preserveDatabaseError(protections.error, "summary-protections");
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
    if (error) throw preserveDatabaseError(error, "overview");
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
    let allTimeDealsQuery = followupReader.from("customers").select("id", { count: "exact", head: true })
      .is("deleted_at", null).not("owner_id", "is", null).eq("status", "DEAL");
    if (scopeUserId) allTimeDealsQuery = allTimeDealsQuery.eq("owner_id", scopeUserId);
    const [potentialCustomersResult, followingCustomersResult, validCustomersResult, todayFollowupsResult, systemCustomersResult, allTimeDealsResult] = await Promise.all([
      statusCount("CLAIMED"), statusCount("FOLLOWING"), validCustomersQuery, todayFollowupsQuery,
      account.role === "ADMIN" ? followupReader.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null).or("pool_status.is.null,pool_status.neq.AI_STAGING") : Promise.resolve(null),
      allTimeDealsQuery,
    ]);
    if (potentialCustomersResult.error) throw preserveDatabaseError(potentialCustomersResult.error, "potential-count");
    if (followingCustomersResult.error) throw preserveDatabaseError(followingCustomersResult.error, "following-count");
    if (validCustomersResult.error) throw preserveDatabaseError(validCustomersResult.error, "valid-count");
    if (todayFollowupsResult.error) throw preserveDatabaseError(todayFollowupsResult.error, "today-followups");
    if (systemCustomersResult?.error) throw preserveDatabaseError(systemCustomersResult.error, "system-count");
    if (allTimeDealsResult.error) throw preserveDatabaseError(allTimeDealsResult.error, "all-time-deals");
    const todayFollowups = (todayFollowupsResult.data || []).map((row) => ({
      id: row.id, customer_id: row.customer_id, customer_name: row.contact_name, company_name: row.company_name,
      phone: row.phone, email: row.email, country: row.country, ai_level: row.ai_level,
      last_followup: row.created_at, followup_time: row.next_follow_date, type: row.type, status: row.status,
    }));
    const funnelRows = [
      { label: "潜在客户", value: Number(potentialCustomersResult.count || 0) }, { label: "意向客户", value: Number(followingCustomersResult.count || 0) },
      { label: "成交客户", value: Number(totals.deals || 0) },
    ];
    const stockActivityMode = ["SALES", "SUPERVISOR", "ADMIN"].includes(account.role) && hasPermission(account, "stock.view");
    let activities = ((overview.activities || []) as Array<Record<string, unknown>>).map((item) => ({ id: String(item.id), action: String(item.action || ""), text: activityText(String(item.action || ""), String(item.customer_name || "客户"), item.content), created_at: String(item.created_at || ""), href: "" }));
    let activityWarning = "";
    if (stockActivityMode) {
      try {
      const stockOwnerId = await requestedOwnerId(request, account, "stock.data_all");
      let stockQuery = supabase.from("stock_orders_with_pi_preparer")
        .select("id,sales_order_id,customer_short_name,stock_number,warehouse_reference_number,status,updated_at")
        .in("status", ["WAITING", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED", "SHORTAGE"])
        .gte("updated_at", fromDate.toISOString()).lt("updated_at", exclusiveTo.toISOString())
        .order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(5);
      if (stockOwnerId) stockQuery = stockQuery.eq("sales_user_id", stockOwnerId);
      if (countryValues.length) stockQuery = stockQuery.in("destination_country", countryValues);
      const stockRows = await stockQuery;
      if (stockRows.error) throw preserveDatabaseError(stockRows.error, "stock-activity");
      const stocks = stockRows.data || [];
      const stockIds = stocks.map((row) => row.id);
      const orderIds = [...new Set(stocks.map((row) => row.sales_order_id).filter(Boolean))];
      const [progressItems, customerNames, ordersResult, eventsResult] = await Promise.all([
        loadStockProgressItems(supabase, stockIds),
        loadOrderCustomerNames(orderIds),
        orderIds.length
          ? followupReader.from("sales_orders").select("id,warehouse_reference_number").in("id", orderIds)
          : Promise.resolve({ data: [], error: null }),
        stockIds.length
          ? followupReader.from("stock_order_events").select("stock_order_id,from_status,to_status,created_by,created_at").in("stock_order_id", stockIds).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(2000)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (ordersResult.error) throw preserveDatabaseError(ordersResult.error, "stock-orders");
      if (eventsResult.error) throw preserveDatabaseError(eventsResult.error, "stock-events");
      const orderNumbers = new Map((ordersResult.data || []).map((order) => [order.id, order.warehouse_reference_number?.trim() || ""]));
      const latestEvents = new Map<string, (typeof eventsResult.data)[number]>();
      for (const row of stocks) {
        const matchingEvent = (eventsResult.data || []).find((event) => event.stock_order_id === row.id
          && Math.abs(Date.parse(event.created_at) - Date.parse(row.updated_at)) <= 2_000);
        if (matchingEvent) latestEvents.set(row.id, matchingEvent);
      }
      const actorIds = [...new Set([...latestEvents.values()].map((event) => event.created_by).filter(Boolean))];
      const actorsResult = actorIds.length
        ? await followupReader.from("users").select("id,name,email").in("id", actorIds)
        : { data: [], error: null };
      if (actorsResult.error) throw preserveDatabaseError(actorsResult.error, "stock-actors");
      const actors = new Map((actorsResult.data || []).map((actor) => [actor.id, actor.name?.trim() || actor.email?.trim() || "操作人未记录"]));
      activities = (stockRows.data || []).map((row) => {
        const progress = summarizeStockProgress(row.status, progressItems.get(row.id) || []);
        const event = latestEvents.get(row.id);
        const previousStatus = event?.from_status ? STOCK_STATUS_LABELS[event.from_status as keyof typeof STOCK_STATUS_LABELS] || event.from_status : "";
        const nextStatus = event?.to_status ? STOCK_STATUS_LABELS[event.to_status as keyof typeof STOCK_STATUS_LABELS] || event.to_status : "";
        const actionDetail = previousStatus && nextStatus && previousStatus !== nextStatus
          ? `状态：${previousStatus} → ${nextStatus}`
          : "更新备货信息";
        return { id: row.id, action: "STOCK_PROGRESS",
          text: dashboardStockActivityText({
            orderNumber: orderNumbers.get(row.sales_order_id) || row.warehouse_reference_number || "订单号未记录",
            customerName: customerNames.get(row.sales_order_id) || row.customer_short_name || "未命名客户",
            actorName: event ? actors.get(event.created_by) || "操作人未记录" : "操作人未记录",
            actionDetail,
            statusLabel: stockProgressLabel(progress), orderedUnits: progress.ordered_units,
            receivedUnits: progress.received_units, preparedUnits: progress.prepared_units,
            shippedUnits: progress.shipped_units,
          }),
          created_at: row.updated_at, href: `/stock-orders/${row.id}` };
      });
      }
      catch (error) {
        // Stock activity is supplementary. Keep the customer activity feed and
        // dashboard totals available if this independent query path is busy.
        activityWarning = "最近备货动态暂时不可用，其他工作台数据不受影响。";
        console.warn("[dashboard] supplementary stock activity temporarily unavailable", {
          code: (error as DatabaseErrorLike)?.code || "NETWORK",
          transient: isTransientError(error),
        });
      }
    }

    return NextResponse.json({
      scope: scopeUserId || "ALL", range: { from: dashboardBusinessDateKey(fromDate), to: dashboardBusinessDateKey(toDate) }, filters: { countries: countryFilterOptions(Array.isArray((overview.filters as { countries?: unknown } | undefined)?.countries) ? (overview.filters as { countries: Array<string | null> }).countries : []) },
      totals: { my_customers: totalCustomers, system_customers: account.role === "ADMIN" ? systemCustomersResult?.count ?? 0 : null, pending_ai: Number(totals.pending_ai || 0), valid_customers: Number(validCustomersResult.count || 0), intentions: Number(potentialCustomersResult.count || 0), today_followups: Number(todayFollowupsResult.count || 0), expiring_protection: Number(totals.expiring_protection || 0), quotes: Number(totals.quotes || 0), deals: Number(totals.deals || 0), all_time_deals: Number(allTimeDealsResult.count || 0) },
      distribution, funnel: funnelRows.map((item) => ({ ...item, percentage: percentage(item.value, totalCustomers) })), country_top: countryTop,
      protections: overview.protections || [], followups: todayFollowups, activities, activity_mode: stockActivityMode ? "STOCK_PROGRESS" : "CUSTOMER", activity_warning: activityWarning,
    }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作台数据加载失败";
    const status = message === "UNAUTHORIZED" || message === "SESSION_REVOKED" ? 401
      : message === "FORBIDDEN" || message.includes("无权") ? 403
        : isTransientError(error) ? 503 : 500;
    if (status >= 500) console.error("[dashboard] stats request failed", {
      code: (error as DatabaseErrorLike)?.code || "INTERNAL",
      stage: (error as DatabaseErrorLike)?.stage || "unknown",
      retryable: status === 503,
    });
    return NextResponse.json({
      error: message === "UNAUTHORIZED" ? "登录已失效，请重新登录"
        : status === 503 ? "工作台数据暂时繁忙，请稍后重试"
          : message,
      retryable: status === 503,
    }, { status, headers: status === 503 ? { "Retry-After": "1", "Cache-Control": "no-store" } : undefined });
  }
}
