import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { defaultMonthRange, loadSalesReport, type ReportCountRow } from "@/lib/reports/sales";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user, account } = await requirePermission("reports.export");
    const defaults = defaultMonthRange();
    const from = request.nextUrl.searchParams.get("from") || defaults.from;
    const to = request.nextUrl.searchParams.get("to") || defaults.to;
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) > Date.parse(to)) {
      return NextResponse.json({ error: "无效日期范围" }, { status: 400 });
    }
    const scopeUserId = requestedOwnerId(request, account, "reports.data_all");
    const report = await loadSalesReport(supabase, user.id, from, to, scopeUserId);
    const lines: string[] = [];
    const add = (values: unknown[]) => lines.push(values.map(csvCell).join(","));
    add(["销售业务报表", `${from.slice(0, 10)} 至 ${to.slice(0, 10)}`]);
    add(["指标", "数值"]);
    add(["期间新增客户", report.totals.new_customers]); add(["当前有效目标", report.totals.ai_valid]);
    add(["期间跟进次数", report.totals.followups]); add(["期间报价数量", report.totals.quotes]);
    add(["期间成交数量", report.totals.deals]); add(["当前客户成交率", `${report.totals.conversion_rate}%`]);
    lines.push("");
    add(["销售员", "邮箱", "当前客户", "期间新增", "有效目标", "跟进", "报价", "成交", "成交率"]);
    report.ranking.forEach((row) => add([row.name, row.email, row.customer_count, row.new_customers, row.ai_valid, row.followups, row.quotes, row.deals, `${row.conversion_rate}%`]));
    const section = (title: string, rows: ReportCountRow[]) => { lines.push(""); add([title, "数量", "金额"]); rows.forEach((row) => add([row.label, row.count, row.amount ?? ""])); };
    section("AI等级分布", report.breakdowns.ai_levels); section("客户阶段分布", report.breakdowns.customer_stages);
    section("国家/地区", report.breakdowns.countries); section("跟进方式", report.breakdowns.followup_types);
    section("报价状态", report.breakdowns.quote_statuses); section("备货状态", report.breakdowns.stock_statuses);
    lines.push(""); add(["日期", "新增客户", "跟进记录", "新增报价"]);
    report.breakdowns.trend.forEach((row) => add([row.date, row.customers, row.followups, row.quotes]));
    return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`销售业务报表_${from.slice(0, 10)}_${to.slice(0, 10)}.csv`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "销售报表导出失败" }, { status: 400 });
  }
}
