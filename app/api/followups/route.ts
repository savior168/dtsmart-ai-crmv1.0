import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const scope = new URL(request.url).searchParams.get("scope") || "today";
    const now = new Date(); const start = new Date(now); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(end.getDate()+1);
    let query = supabase.from("followups").select("id,customer_id,user_id,type,content,attachment,next_follow_date,created_at,customer:customers(id,company_name,country,ai_level,ai_score,status,owner_id)").order("next_follow_date", { ascending: true, nullsFirst: false }).limit(200);
    if (scope === "overdue") query = query.lt("next_follow_date", start.toISOString());
    else if (scope === "upcoming") query = query.gte("next_follow_date", start.toISOString());
    else if (scope === "today") query = query.gte("next_follow_date", start.toISOString()).lt("next_follow_date", end.toISOString());
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data: data || [], scope });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "跟进任务加载失败" }, { status: 400 }); }
}
