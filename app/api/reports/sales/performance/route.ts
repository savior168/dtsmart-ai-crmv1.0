import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("reports.view");
    const from = request.nextUrl.searchParams.get("from"); const to = request.nextUrl.searchParams.get("to");
    if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) return NextResponse.json({ error: "无效日期范围" }, { status: 400 });
    const { data, error } = await supabase.rpc("sales_performance_detail", { p_from: from, p_to: to });
    if (error) throw error;
    return NextResponse.json(data || { totals: {}, customers: [], products: [], orders: [] }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) { const message = error instanceof Error ? error.message : "业绩明细加载失败"; return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 }); }
}
