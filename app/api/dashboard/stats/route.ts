import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { defaultMonthRange, loadSalesReport } from "@/lib/reports/sales";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const range = defaultMonthRange();
    const report = await loadSalesReport(supabase, user.id, range.from, range.to);
    return NextResponse.json({ ...report.totals, scope: report.profile.role === "ADMIN" ? "ALL" : "SELF", role: report.profile.role, range });
  } catch (error) {
    const message = error instanceof Error ? error.message : "统计加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
