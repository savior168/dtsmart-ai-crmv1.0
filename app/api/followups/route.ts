import { NextResponse } from "next/server";
import { hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { followupDayBounds } from "@/lib/customers/followup-day";
import { countryFilterRawValues } from "@/lib/countries";
import { CUSTOMER_STATUSES } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";

const scopes = new Set(["today", "overdue", "upcoming", "unscheduled", "history"]);

export async function GET(request: Request) {
  try {
    const { account } = await requirePermission("followups.view");
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") || "today";
    if (!scopes.has(scope)) return NextResponse.json({ error: "无效的跟进范围" }, { status: 400 });
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(10, Number(params.get("page_size") || 20)));
    const search = params.get("q")?.trim().replace(/[%_,()]/g, "") || "";
    const stage = params.get("stage")?.trim() || "";
    if (stage && !new Set<string>(CUSTOMER_STATUSES).has(stage)) return NextResponse.json({ error: "无效的客户阶段" }, { status: 400 });
    const countries = [...new Set(params.getAll("country").map((item) => item.trim()).filter(Boolean))];
    const scopeUserId = await requestedOwnerId(request, account, "followups.data_all");
    const followupReader = createAdminClient();
    const { start, end } = followupDayBounds();

    if (scope === "history") {
      let query = followupReader.from("customer_followup_history")
        .select("id,customer_id,user_id,type,content,next_follow_date,created_at,company_name,contact_name,country,ai_level,ai_score,status,actor_name,actor_email", { count: "exact" });
      if (scopeUserId) query = query.eq("owner_id", scopeUserId);
      if (stage) query = query.eq("status", stage);
      if (countries.length) query = query.in("country", countryFilterRawValues(countries));
      if (search) query = query.or(`content.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw error;
      return NextResponse.json({
        data: (data || []).map((row) => ({ ...row, user: { name: row.actor_name, email: row.actor_email }, customer: { company_name: row.company_name, contact_name: row.contact_name, country: row.country, ai_level: row.ai_level, ai_score: row.ai_score, status: row.status } })),
        count: count || 0, page, page_size: pageSize, scope, can_export: hasPermission(account, "followups.export"), profile: { id: account.id, role: account.role },
      });
    }

    let query = followupReader.from("customer_followup_queue")
      .select("id,customer_id,owner_id,type,content,next_follow_date,created_at,company_name,contact_name,country,ai_level,ai_score,status,owner_name,owner_email", { count: "exact" });
    if (scopeUserId) query = query.eq("owner_id", scopeUserId);
    if (stage) query = query.eq("status", stage);
    if (countries.length) query = query.in("country", countryFilterRawValues(countries));
    if (search) query = query.or(`content.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    if (scope === "today") query = query.gte("next_follow_date", start).lt("next_follow_date", end);
    if (scope === "overdue") query = query.lt("next_follow_date", start);
    if (scope === "upcoming") query = query.gte("next_follow_date", end);
    if (scope === "unscheduled") query = query.is("next_follow_date", null);
    const { data, error, count } = await query.order(scope === "unscheduled" ? "company_name" : "next_follow_date", { ascending: true }).order("id", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return NextResponse.json({
      data: (data || []).map((row) => ({ ...row, user_id: row.owner_id, user: { name: row.owner_name, email: row.owner_email }, customer: { company_name: row.company_name, contact_name: row.contact_name, country: row.country, ai_level: row.ai_level, ai_score: row.ai_score, status: row.status } })),
      count: count || 0, page, page_size: pageSize, scope, can_export: hasPermission(account, "followups.export"), profile: { id: account.id, role: account.role },
    });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "跟进任务加载失败" }, { status: 400 }); }
}
