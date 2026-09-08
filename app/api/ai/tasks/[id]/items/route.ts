import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.tasks.view");
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const status = params.get("status") || "";
    const step = params.get("step") || "";
    const retry = params.get("retry") || "";
    const industry = params.get("industry")?.trim() || "";
    const target = params.get("target") || "";
    const grade = params.get("grade") || "";
    const options = params.get("options") || "";
    const search = params.get("search")?.trim() || "";
    const admin = createAdminClient();
    let taskQuery = admin.from("ai_screening_tasks").select("id").eq("id", id);
    if (!hasPermission(account, "ai.data_all")) taskQuery = taskQuery.eq("user_id", user.id);
    const task = await taskQuery.single();
    if (task.error) throw task.error;
    if (options === "industries") {
      const values: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const pageResult = await admin.from("ai_screening_results")
          .select("industry_type")
          .eq("task_id", id)
          .eq("is_latest_valid", true)
          .range(offset, offset + 999);
        if (pageResult.error) throw pageResult.error;
        const rows = pageResult.data || [];
        for (const row of rows) {
          const value = String(row.industry_type || "").trim();
          if (value) values.push(value);
        }
        if (rows.length < 1000) break;
      }
      const data = [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
      return NextResponse.json({ data, count: data.length });
    }
    const safeSearch = search.replace(/[,%()]/g," ").trim();
    let query = admin.from("ai_screening_task_items").select("*,customer:customers!inner(id,company_name,contact_name,phone,email,country,industry,is_target_customer,ai_score,ai_level)", { count: "exact" }).eq("task_id", id);
    if (status) query = query.eq("status", status);
    if (step) query = query.eq("current_step", step);
    if (retry === "none") query = query.eq("attempt_count", 0);
    if (retry === "retrying") query = query.gt("attempt_count", 0).lt("attempt_count", 3);
    if (retry === "exhausted") query = query.gte("attempt_count", 3);
    if (industry || (grade && ["A", "B", "C", "D"].includes(grade)) || ["valid", "invalid", "review"].includes(target)) {
      const decision = target === "valid" ? "VALID" : target === "invalid" ? "INVALID" : "REVIEW";
      let resultFilter = admin.from("ai_screening_results").select("task_item_id").eq("task_id", id).eq("is_latest_valid", true);
      if (industry) resultFilter = resultFilter.eq("industry_type", industry);
      if (grade && ["A", "B", "C", "D"].includes(grade)) resultFilter = resultFilter.eq("grade", grade);
      if (["valid", "invalid", "review"].includes(target)) resultFilter = resultFilter.eq("target_decision", decision);
      const decisions = await resultFilter;
      if (decisions.error) throw decisions.error;
      const itemIds = (decisions.data || []).map((item) => item.task_item_id).filter(Boolean);
      if (!itemIds.length) return NextResponse.json({ data: [], count: 0, page, pageSize });
      query = query.in("id", itemIds);
    }
    if (safeSearch) query = query.or(`company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`, { referencedTable: "customers" });
    const result = await query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const resultIds = [...new Set(rows.map((row) => String(row.result_id || "")).filter(Boolean))];
    const analysisResults = resultIds.length
      ? await admin.from("ai_screening_results").select("id,score,grade,target_decision,industry_type").in("id", resultIds)
      : { data: [], error: null };
    if (analysisResults.error) throw analysisResults.error;
    const resultById = new Map((analysisResults.data || []).map((row) => [String(row.id), row]));
    const customerIds = [...new Set(rows.map((row) => String(row.customer_id || "")).filter(Boolean))];
    const placesByCustomer = new Map<string, number>();
    if (customerIds.length) {
      for (let offset = 0; ; offset += 1000) {
        const ledger = await admin.from("api_cost_ledger")
          .select("customer_id,quantity")
          .eq("task_id", id)
          .eq("provider", "GOOGLE_PLACES")
          .in("customer_id", customerIds)
          .range(offset, offset + 999);
        if (ledger.error) throw ledger.error;
        const calls = ledger.data || [];
        for (const call of calls) {
          const customerId = String(call.customer_id || "");
          if (!customerId) continue;
          placesByCustomer.set(customerId, (placesByCustomer.get(customerId) || 0) + Math.max(0, Number(call.quantity || 1)));
        }
        if (calls.length < 1000) break;
      }
    }
    const data = rows.map((row) => ({
      ...row,
      result: resultById.get(String(row.result_id || "")) || null,
      google_places_call_count: placesByCustomer.get(String(row.customer_id || "")) || 0,
    }));
    return NextResponse.json({ data, count: result.count || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务客户查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
