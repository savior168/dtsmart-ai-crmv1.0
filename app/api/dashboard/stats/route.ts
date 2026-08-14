import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

type DashboardCustomer = {
  id: string;
  company_name: string;
  country: string | null;
  ai_level: string | null;
  ai_score: number | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  last_contact_time: string | null;
};

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
    const { supabase, user } = await requireUser();
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = validDate(request.nextUrl.searchParams.get("from"), defaultFrom);
    const toDate = validDate(request.nextUrl.searchParams.get("to"), now);
    const exclusiveTo = new Date(toDate);
    exclusiveTo.setDate(exclusiveTo.getDate() + 1);
    const country = request.nextUrl.searchParams.get("country")?.trim() || "";
    const aiLevel = request.nextUrl.searchParams.get("ai_level")?.trim() || "";

    const [profileResult, customerResult] = await Promise.all([
      supabase.from("users").select("name,email,role").eq("id", user.id).single(),
      supabase.from("customers").select("id,company_name,country,ai_level,ai_score,status,created_at,updated_at,last_contact_time").is("deleted_at", null).gte("created_at", fromDate.toISOString()).lt("created_at", exclusiveTo.toISOString()).order("created_at", { ascending: false }).limit(5000),
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (customerResult.error) throw new Error(customerResult.error.message);

    const sourceCustomers = (customerResult.data || []) as DashboardCustomer[];
    const countries = Array.from(new Set(sourceCustomers.map((item) => item.country?.trim()).filter((item): item is string => Boolean(item)))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const customers = sourceCustomers.filter((item) => (!country || item.country === country) && (!aiLevel || item.ai_level === aiLevel));
    const customerMap = new Map(customers.map((item) => [item.id, item]));

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);
    const protectionEnd = new Date(todayStart); protectionEnd.setDate(protectionEnd.getDate() + 8);

    const [followupResult, protectionResult, auditResult] = await Promise.all([
      supabase.from("followups").select("id,customer_id,type,content,next_follow_date,created_at").gte("next_follow_date", todayStart.toISOString()).lt("next_follow_date", tomorrow.toISOString()).order("next_follow_date", { ascending: true }).limit(50),
      supabase.from("customer_protection").select("id,customer_id,type,expire_date,status").eq("status", "ACTIVE").not("expire_date", "is", null).gte("expire_date", todayStart.toISOString()).lt("expire_date", protectionEnd.toISOString()).order("expire_date", { ascending: true }).limit(30),
      supabase.from("audit_logs").select("id,action,target_id,content,created_at").eq("target_type", "customer").order("created_at", { ascending: false }).limit(20),
    ]);
    if (followupResult.error) throw new Error(followupResult.error.message);
    if (protectionResult.error) throw new Error(protectionResult.error.message);
    if (auditResult.error) throw new Error(auditResult.error.message);

    const distribution = ["A", "B", "C", "D"].map((grade) => {
      const count = customers.filter((item) => item.ai_level === grade).length;
      return { grade, count, percentage: percentage(count, customers.length) };
    });
    const countryCounts = new Map<string, number>();
    customers.forEach((item) => { const key = item.country?.trim() || "未知"; countryCounts.set(key, (countryCounts.get(key) || 0) + 1); });
    const countryTop = Array.from(countryCounts, ([name, count]) => ({ name, count, percentage: percentage(count, customers.length) })).sort((a, b) => b.count - a.count).slice(0, 10);
    const pendingAi = customers.filter((item) => item.ai_score === null).length;
    const targetCustomers = customers.filter((item) => item.ai_score !== null && item.ai_score >= 60).length;
    const followups = (followupResult.data || []).filter((item) => customerMap.has(item.customer_id)).slice(0, 5).map((item) => { const customer = customerMap.get(item.customer_id)!; return { id: item.id, customer_id: item.customer_id, customer_name: customer.company_name, country: customer.country, ai_level: customer.ai_level, last_followup: customer.last_contact_time, followup_time: item.next_follow_date, type: item.type, status: customer.status }; });
    const protections = (protectionResult.data || []).filter((item) => customerMap.has(item.customer_id)).slice(0, 6).map((item) => { const customer = customerMap.get(item.customer_id)!; const expires = new Date(String(item.expire_date)); const days = Math.max(0, Math.ceil((expires.getTime() - todayStart.getTime()) / 86400000)); return { id: item.id, customer_id: item.customer_id, customer_name: customer.company_name, country: customer.country, expires_at: item.expire_date, days }; });
    const activities = (auditResult.data || []).filter((item) => !item.target_id || customerMap.has(item.target_id)).slice(0, 5).map((item) => { const customerName = item.target_id ? customerMap.get(item.target_id)?.company_name || "客户" : "客户"; return { id: item.id, action: item.action, text: activityText(item.action, customerName, item.content), created_at: item.created_at }; });
    const quotes = customers.filter((item) => item.status === "QUOTE").length;
    const deals = customers.filter((item) => item.status === "DEAL").length;
    const following = customers.filter((item) => item.status === "FOLLOWING").length;
    const totals = { my_customers: customers.length, pending_ai: pendingAi, grade_a: distribution[0].count, today_followups: followups.length, expiring_protection: protections.length, quotes, deals, target_customers: targetCustomers };

    return NextResponse.json({
      profile: profileResult.data,
      scope: "SELF",
      range: { from: dateKey(fromDate), to: dateKey(toDate) },
      filters: { countries },
      totals,
      distribution,
      funnel: [
        { label: "线索客户（全部）", value: customers.length, percentage: 100 },
        { label: "AI筛选通过", value: targetCustomers, percentage: percentage(targetCustomers, customers.length) },
        { label: "报价中", value: quotes, percentage: percentage(quotes, customers.length) },
        { label: "谈判中", value: following, percentage: percentage(following, customers.length) },
        { label: "已成交", value: deals, percentage: percentage(deals, customers.length) },
      ],
      country_top: countryTop,
      protections,
      followups,
      activities,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作台数据加载失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录已失效，请重新登录" : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
