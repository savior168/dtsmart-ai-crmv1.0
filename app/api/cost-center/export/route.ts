import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { costPeriodRange, normalizeCostPeriod } from "@/lib/cost-center";
import { createAdminClient } from "@/lib/supabase/admin";

function cell(value: unknown) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

type CostExportRow = {
  user_id: string | null;
  provider: string;
  service: string;
  operation: string;
  model_or_sku: string | null;
  quantity: number | null;
  unit: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  amount_usd: number | null;
  amount_type: string;
  pricing_snapshot: { pricing_configured?: boolean } | null;
  occurred_at: string;
};

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("costs.export");
    const params = request.nextUrl.searchParams;
    const settings = await supabase.from("cost_center_settings").select("accounting_start_at").eq("id", true).single();
    if (settings.error) throw settings.error;
    const period = normalizeCostPeriod(params.get("period"));
    const range = costPeriodRange({ period, accountingStartAt: settings.data.accounting_start_at, from: params.get("from"), to: params.get("to") });
    const { from, to } = range;
    const provider = params.get("provider")?.trim();
    const data: CostExportRow[] = [];
    // Supabase REST responses are commonly capped at 1,000 rows. Page until
    // EOF so an export never silently drops older cost records.
    for (let offset = 0; !range.empty; offset += 1000) {
      let query = supabase.from("api_cost_ledger")
        .select("user_id,provider,service,operation,model_or_sku,quantity,unit,input_tokens,cached_input_tokens,output_tokens,amount_usd,amount_type,pricing_snapshot,occurred_at")
        .gte("occurred_at", from).lt("occurred_at", to).order("occurred_at", { ascending: false })
        .range(offset, offset + 999);
      if (provider) query = query.eq("provider", provider);
      const page = await query;
      if (page.error) throw page.error;
      data.push(...((page.data || []) as CostExportRow[]));
      if ((page.data || []).length < 1000) break;
    }
    const userIds = [...new Set(data.map((row) => row.user_id).filter((value): value is string => Boolean(value)))];
    const users = userIds.length ? await createAdminClient().from("users").select("id,name,email").in("id", userIds) : { data: [], error: null };
    if (users.error) throw users.error;
    const userMap = new Map((users.data || []).map((user) => [user.id, user]));
    const headings = ["发生时间", "服务商", "服务", "操作", "模型或计费项", "数量", "单位", "输入Token", "缓存输入Token", "输出Token", "费用性质", "金额（美元）", "调用人"];
    const rows = data.map((row) => {
      const snapshot = row.pricing_snapshot;
      const amountType = row.amount_type === "FINAL" ? "账单已确认" : row.amount_type === "FREE" ? "明确免费" : snapshot?.pricing_configured === false ? "单价待配置" : "按价目预估";
      const user = row.user_id ? userMap.get(row.user_id) : null;
      return [new Date(row.occurred_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }), row.provider, row.service, row.operation, row.model_or_sku, row.quantity, row.unit, row.input_tokens, row.cached_input_tokens, row.output_tokens, amountType, snapshot?.pricing_configured === false ? "待配置" : Number(row.amount_usd || 0).toFixed(6), user?.name || user?.email || (row.user_id ? "历史账号" : "系统")].map(cell).join(",");
    });
    const csv = `\uFEFF${headings.map(cell).join(",")}\r\n${rows.join("\r\n")}`;
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`API费用明细_${String(from).slice(0, 10)}_${String(params.get("to") || new Date().toISOString().slice(0, 10))}.csv`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用明细导出失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
