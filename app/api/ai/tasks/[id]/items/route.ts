import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser();
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
    const task = await admin.from("ai_screening_tasks").select("id").eq("id", id).eq("user_id", user.id).single();
    if (task.error) throw task.error;
    if (options === "industries") {
      const values: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const pageResult = await admin.from("ai_screening_task_items")
          .select("customer:customers!inner(industry)")
          .eq("task_id", id)
          .range(offset, offset + 999);
        if (pageResult.error) throw pageResult.error;
        const rows = pageResult.data || [];
        for (const row of rows) {
          const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
          const value = String(customer?.industry || "").trim();
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
    if (industry) query = query.eq("customer.industry", industry);
    if (grade && ["A", "B", "C", "D"].includes(grade)) query = query.eq("customer.ai_level", grade);
    if (target === "valid") query = query.eq("customer.is_target_customer", true);
    if (target === "invalid") query = query.eq("customer.is_target_customer", false);
    if (safeSearch) query = query.or(`company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`, { referencedTable: "customers" });
    const result = await query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const resultIds = [...new Set(rows.map((row) => String(row.result_id || "")).filter(Boolean))];
    const analysisResults = resultIds.length
      ? await admin.from("ai_screening_results").select("id,score,grade,target_decision").in("id", resultIds)
      : { data: [], error: null };
    if (analysisResults.error) throw analysisResults.error;
    const resultById = new Map((analysisResults.data || []).map((row) => [String(row.id), row]));
    const data = rows.map((row) => ({
      ...row,
      result: resultById.get(String(row.result_id || "")) || null,
    }));
    return NextResponse.json({ data, count: result.count || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务客户查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
