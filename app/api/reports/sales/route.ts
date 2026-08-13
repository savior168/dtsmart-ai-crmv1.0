import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { defaultMonthRange, loadSalesReport } from "@/lib/reports/sales";

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const defaults = defaultMonthRange();
    const from = request.nextUrl.searchParams.get("from") || defaults.from;
    const to = request.nextUrl.searchParams.get("to") || defaults.to;
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) > Date.parse(to)) return NextResponse.json({ error: "无效日期范围" }, { status: 400 });
    return NextResponse.json(await loadSalesReport(supabase, user.id, from, to));
  } catch (error) {
    const message = error instanceof Error ? error.message : "销售报表加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
