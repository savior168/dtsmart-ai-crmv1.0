import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const url = new URL(request.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 30)));
    const until = new Date(Date.now() + days * 86400000).toISOString();
    const { data, error } = await supabase.from("customer_protection").select("*,customer:customers(id,company_name,country,owner_id,ai_level,ai_score,status,last_contact_time,phone,email,website,google_url,source,updated_at)").eq("status", "ACTIVE").not("expire_date", "is", null).lte("expire_date", until).order("expire_date", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ data: data || [], days });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保护到期数据加载失败" }, { status: 400 });
  }
}
