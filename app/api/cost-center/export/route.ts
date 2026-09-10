import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { costLedgerRange } from "@/lib/cost-center";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selectedIds = (request: NextRequest, key: string) => [...new Set(request.nextUrl.searchParams.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => uuidPattern.test(value)))].slice(0, 50);

function cell(value: unknown) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

type CostExportRow = {
  user_id: string | null;
  task_id: string | null;
  customer_id: string | null;
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
    const range = costLedgerRange(params.get("from"), params.get("to"));
    const { from, to } = range;
    const provider = params.get("provider")?.trim();
    const taskFilterIds = selectedIds(request, "task_id");
    const customerFilterIds = selectedIds(request, "customer_id");
    const data: CostExportRow[] = [];
    // Supabase REST responses are commonly capped at 1,000 rows. Page until
    // EOF so an export never silently drops older cost records.
    for (let offset = 0; ; offset += 1000) {
      let query = supabase.from("api_cost_ledger")
        .select("user_id,task_id,customer_id,provider,service,operation,model_or_sku,quantity,unit,input_tokens,cached_input_tokens,output_tokens,amount_usd,amount_type,pricing_snapshot,occurred_at")
        .gte("occurred_at", from).lt("occurred_at", to).order("occurred_at", { ascending: false })
        .range(offset, offset + 999);
      if (provider) query = query.eq("provider", provider);
      const operation = params.get("operation")?.trim();
      if (operation) query = query.or(`operation.ilike.%${operation.replace(/[%_,()]/g, "")}%,model_or_sku.ilike.%${operation.replace(/[%_,()]/g, "")}%`);
      if (params.get("user_id")) query = query.eq("user_id", params.get("user_id")!);
      if (taskFilterIds.length) query = query.in("task_id", taskFilterIds);
      if (customerFilterIds.length) query = query.in("customer_id", customerFilterIds);
      const page = await query;
      if (page.error) throw page.error;
      data.push(...((page.data || []) as CostExportRow[]));
      if ((page.data || []).length < 1000) break;
    }
    const userIds = [...new Set(data.map((row) => row.user_id).filter((value): value is string => Boolean(value)))];
    const users = userIds.length ? await createAdminClient().from("users").select("id,name,email").in("id", userIds) : { data: [], error: null };
    if (users.error) throw users.error;
    const userMap = new Map((users.data || []).map((user) => [user.id, user]));
    const taskIds=[...new Set(data.map(row=>row.task_id).filter((value):value is string=>Boolean(value)))];
    const customerIds=[...new Set(data.map(row=>row.customer_id).filter((value):value is string=>Boolean(value)))];
    const admin=createAdminClient();
    const [tasks,customers]=await Promise.all([
      taskIds.length?admin.from("ai_screening_tasks").select("id,name,task_number").in("id",taskIds):{data:[],error:null},
      customerIds.length?admin.from("customers").select("id,company_name").in("id",customerIds):{data:[],error:null},
    ]);
    if(tasks.error)throw tasks.error;if(customers.error)throw customers.error;
    const taskMap=new Map((tasks.data||[]).map(task=>[task.id,task]));
    const customerMap=new Map((customers.data||[]).map(customer=>[customer.id,customer]));
    const headings = ["发生时间", "服务商", "服务", "操作", "模型或计费项", "任务", "任务编号", "客户", "数量", "单位", "输入Token", "缓存输入Token", "输出Token", "费用性质", "金额（美元）", "调用人"];
    const rows = data.map((row) => {
      const snapshot = row.pricing_snapshot;
      const amountType = row.amount_type === "FINAL" ? "账单已确认" : row.amount_type === "FREE" ? "明确免费" : snapshot?.pricing_configured === false ? "单价待配置" : "按价目预估";
      const user = row.user_id ? userMap.get(row.user_id) : null;
      const occurred=new Date(row.occurred_at);const occurredText=Number.isFinite(occurred.getTime())?occurred.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }):"时间未知";
      const task=row.task_id?taskMap.get(row.task_id):null;const customer=row.customer_id?customerMap.get(row.customer_id):null;
      return [occurredText, row.provider, row.service, row.operation, row.model_or_sku, task?.name||"非任务调用",task?.task_number||"—",customer?.company_name||"—", row.quantity, row.unit, row.input_tokens, row.cached_input_tokens, row.output_tokens, amountType, snapshot?.pricing_configured === false ? "待配置" : Number(row.amount_usd || 0).toFixed(6), user?.name || user?.email || (row.user_id ? "历史账号" : "系统")].map(cell).join(",");
    });
    const csv = `\uFEFF${headings.map(cell).join(",")}\r\n${rows.join("\r\n")}`;
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`API费用明细_${String(from).slice(0, 10)}_${String(params.get("to") || new Date().toISOString().slice(0, 10))}.csv`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "费用明细导出失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
