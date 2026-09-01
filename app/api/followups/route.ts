import { NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";

export async function GET(request: Request) {
  try {
    const { supabase, account } = await requirePermission("followups.view");
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") || "today";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") || 20)));
    const search = params.get("q")?.trim() || "";
    const scopeUserId = requestedOwnerId(request, account, "followups.data_all");
    const now = new Date(); const start = new Date(now); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(end.getDate()+1);
    let query = supabase.from("followups").select("id,customer_id,user_id,type,content,attachment,next_follow_date,created_at,user:users!followups_user_id_fkey(id,name,email),customer:customers!inner(id,company_name,country,ai_level,ai_score,status,owner_id)",{count:"exact"});
    if (scopeUserId) query = query.eq("user_id", scopeUserId);
    if(search) query=query.ilike("customer.company_name",`%${search.replace(/[%_]/g,"\\$&")}%`);
    if (scope === "overdue") query = query.lt("next_follow_date", start.toISOString());
    else if (scope === "upcoming") query = query.gte("next_follow_date", start.toISOString());
    else if (scope === "today") query = query.gte("next_follow_date", start.toISOString()).lt("next_follow_date", end.toISOString());
    query=scope==="history"?query.order("created_at",{ascending:false}):query.order("next_follow_date", { ascending: true, nullsFirst: false });
    const { data, error, count } = await query.range((page-1)*pageSize,page*pageSize-1);
    if (error) throw error;
    return NextResponse.json({ data: data || [], count:count||0, page, page_size:pageSize, scope, profile:{id:account.id,role:account.role} });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "跟进任务加载失败" }, { status: 400 }); }
}
