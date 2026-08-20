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
    const search = params.get("search")?.trim() || "";
    const admin = createAdminClient();
    const task = await admin.from("ai_screening_tasks").select("id").eq("id", id).eq("user_id", user.id).single();
    if (task.error) throw task.error;
    let customerIds:string[]|null=null;
    if(search){const safe=search.replace(/[,%()]/g," ").trim();const customers=await admin.from("customers").select("id").or(`company_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`).limit(1000);if(customers.error)throw customers.error;customerIds=(customers.data||[]).map(row=>row.id);if(!customerIds.length)return NextResponse.json({data:[],count:0,page,pageSize});}
    let query = admin.from("ai_screening_task_items").select("*,customer:customers(id,company_name,contact_name,phone,email,country,ai_score,ai_level)", { count: "exact" }).eq("task_id", id);
    if (status) query = query.eq("status", status);
    if (customerIds) query = query.in("customer_id",customerIds);
    const result = await query.order("created_at", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    return NextResponse.json({ data: result.data || [], count: result.count || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务客户查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
