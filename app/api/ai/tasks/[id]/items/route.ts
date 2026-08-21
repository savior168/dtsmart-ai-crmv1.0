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
    const search = params.get("search")?.trim() || "";
    const admin = createAdminClient();
    const task = await admin.from("ai_screening_tasks").select("id").eq("id", id).eq("user_id", user.id).single();
    if (task.error) throw task.error;
    const safeSearch = search.replace(/[,%()]/g," ").trim();
    let query = admin.from("ai_screening_task_items").select("*,customer:customers!inner(id,company_name,contact_name,phone,email,country,ai_score,ai_level)", { count: "exact" }).eq("task_id", id);
    if (status) query = query.eq("status", status);
    if (step) query = query.eq("current_step", step);
    if (retry === "none") query = query.eq("attempt_count", 0);
    if (retry === "retrying") query = query.gt("attempt_count", 0).lt("attempt_count", 3);
    if (retry === "exhausted") query = query.gte("attempt_count", 3);
    if (safeSearch) query = query.or(`company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`, { referencedTable: "customers" });
    const result = await query
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    return NextResponse.json({ data: result.data || [], count: result.count || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务客户查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
