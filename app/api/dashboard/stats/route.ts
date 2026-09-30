import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { countryInfo } from "@/lib/countries";
import { followupDayBounds } from "@/lib/customers/followup-day";

type CountRow = { grade?: string; name?: string; count: number };

function validDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
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
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const protectionEnd = new Date(todayStart);
    protectionEnd.setDate(protectionEnd.getDate() + 8);

    if (request.nextUrl.searchParams.get("summary") === "1") {
      const followupDay = followupDayBounds(now);
      let followupsQuery = supabase.from("customer_followup_queue").select("id", { count: "exact", head: true }).gte("next_follow_date", followupDay.start).lt("next_follow_date", followupDay.end);
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

    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = validDate(request.nextUrl.searchParams.get("from"), defaultFrom);
    const toDate = validDate(request.nextUrl.searchParams.get("to"), now);
    const exclusiveTo = new Date(toDate);
    exclusiveTo.setDate(exclusiveTo.getDate() + 1);
    const country = request.nextUrl.searchParams.get("country")?.trim() || "";
    const aiLevel = request.nextUrl.searchParams.get("ai_level")?.trim() || "";

    // Keep aggregation in Postgres. The former route copied every matching
    // customer into the application process and could hit statement_timeout.
    const { data, error } = await supabase.rpc("dashboard_overview", {
      p_from: fromDate.toISOString(), p_to: exclusiveTo.toISOString(),
      p_scope_user_id: scopeUserId, p_country: country || null, p_ai_level: aiLevel || null,
    });
    if (error) throw new Error(error.message);
    const overview = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const totals = (overview.totals && typeof overview.totals === "object" ? overview.totals : {}) as Record<string, number>;
    const totalCustomers = Number(totals.my_customers || 0);
    const distribution = ((overview.distribution || []) as CountRow[]).map((item) => ({ grade: item.grade || "未筛选", count: Number(item.count || 0), percentage: percentage(Number(item.count || 0), totalCustomers) }));
    const countryTop = ((overview.country_top || []) as CountRow[]).map((item) => {
      const normalized = countryInfo(item.name || "");
      return { name: normalized.code || normalized.name, count: Number(item.count || 0), percentage: percentage(Number(item.count || 0), totalCustomers) };
    });
    // Funnel statuses are intentionally counted directly: they are mutually
    // meaningful business states, not the remainder after later-stage totals.
    // These indexed count queries preserve the selected scope and filters.
    const statusCount = (status: "CLAIMED" | "FOLLOWING") => {
      let query = supabase.from("customers").select("id", { count: "exact", head: true })
        .is("deleted_at", null).not("owner_id", "is", null).gte("created_at", fromDate.toISOString()).lt("created_at", exclusiveTo.toISOString()).eq("status", status);
      if (scopeUserId) query = query.eq("owner_id", scopeUserId);
      if (country) query = query.ilike("country", `%${country.replace(/[\\%_]/g, "\\\\$&")}%`);
      if (aiLevel) query = query.eq("ai_level", aiLevel);
      return query;
    };
    let validCustomersQuery = supabase.from("customers").select("id", { count: "exact", head: true })
      .is("deleted_at", null).not("owner_id", "is", null).gte("created_at", fromDate.toISOString()).lt("created_at", exclusiveTo.toISOString())
      .eq("ai_screening_done", true).eq("is_target_customer", true);
    if (scopeUserId) validCustomersQuery = validCustomersQuery.eq("owner_id", scopeUserId);
    if (country) validCustomersQuery = validCustomersQuery.ilike("country", `%${country.replace(/[\\%_]/g, "\\\\$&")}%`);
    if (aiLevel) validCustomersQuery = validCustomersQuery.eq("ai_level", aiLevel);
    const followupDay = followupDayBounds(now);
    let todayFollowupsQuery = supabase.from("customer_followup_queue")
      .select("id,customer_id,company_name,phone,email,country,ai_level,created_at,next_follow_date,type,status", { count: "exact" })
      .gte("next_follow_date", followupDay.start).lt("next_follow_date", followupDay.end)
      .order("next_follow_date", { ascending: true }).order("customer_id", { ascending: true }).limit(5);
    if (scopeUserId) todayFollowupsQuery = todayFollowupsQuery.eq("owner_id", scopeUserId);
    const [potentialCustomersResult, followingCustomersResult, validCustomersResult, todayFollowupsResult, systemCustomersResult] = await Promise.all([
      statusCount("CLAIMED"), statusCount("FOLLOWING"), validCustomersQuery, todayFollowupsQuery,
      account.role === "ADMIN" ? supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null) : Promise.resolve(null),
    ]);
    if (potentialCustomersResult.error) throw new Error(potentialCustomersResult.error.message);
    if (followingCustomersResult.error) throw new Error(followingCustomersResult.error.message);
    if (validCustomersResult.error) throw new Error(validCustomersResult.error.message);
    if (todayFollowupsResult.error) throw new Error(todayFollowupsResult.error.message);
    if (systemCustomersResult?.error) throw new Error(systemCustomersResult.error.message);
    const todayFollowups = (todayFollowupsResult.data || []).map((row) => ({
      id: row.id, customer_id: row.customer_id, customer_name: row.company_name,
      phone: row.phone, email: row.email, country: row.country, ai_level: row.ai_level,
      last_followup: row.created_at, followup_time: row.next_follow_date, type: row.type, status: row.status,
    }));
    const funnelRows = [
      { label: "潜在客户", value: Number(potentialCustomersResult.count || 0) }, { label: "意向客户", value: Number(followingCustomersResult.count || 0) },
      { label: "报价中", value: Number(totals.quotes || 0) }, { label: "成交客户", value: Number(totals.deals || 0) },
    ];
    const activities = ((overview.activities || []) as Array<Record<string, unknown>>).map((item) => ({ id: String(item.id), action: String(item.action || ""), text: activityText(String(item.action || ""), String(item.customer_name || "客户"), item.content), created_at: String(item.created_at || "") }));

    return NextResponse.json({
      scope: scopeUserId || "ALL", range: { from: dateKey(fromDate), to: dateKey(toDate) }, filters: overview.filters || { countries: [] },
      totals: { my_customers: totalCustomers, system_customers: account.role === "ADMIN" ? systemCustomersResult?.count ?? 0 : null, pending_ai: Number(totals.pending_ai || 0), valid_customers: Number(validCustomersResult.count || 0), intentions: Number(potentialCustomersResult.count || 0), today_followups: Number(todayFollowupsResult.count || 0), expiring_protection: Number(totals.expiring_protection || 0), quotes: Number(totals.quotes || 0), deals: Number(totals.deals || 0) },
      distribution, funnel: funnelRows.map((item) => ({ ...item, percentage: percentage(item.value, totalCustomers) })), country_top: countryTop,
      protections: overview.protections || [], followups: todayFollowups, activities,
    }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作台数据加载失败";
    const status = message === "UNAUTHORIZED" || message === "SESSION_REVOKED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录已失效，请重新登录" : message }, { status });
  }
}
