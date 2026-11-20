import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CNY = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (!["WAREHOUSE", "ADMIN"].includes(account.role)) throw new Error("无仓库费用登记权限");
    const { id } = await context.params;
    if (!UUID.test(id)) throw new Error("备货单编号无效");
    const body = await request.json() as Record<string, unknown>;
    const requestId = String(body.request_id || "");
    if (!UUID.test(requestId)) throw new Error("费用提交编号无效，请刷新后重试");
    const rawEntries = Array.isArray(body.entries) ? body.entries : [body];
    if (rawEntries.length < 1 || rawEntries.length > 20) throw new Error("每次可登记1至20项费用");
    const entries = rawEntries.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("费用资料格式不正确");
      const entry = raw as Record<string, unknown>;
      const expenseType = String(entry.expense_type || "");
      const amount = String(entry.amount_cny ?? "");
      const supplierId = entry.supplier_id == null ? null : String(entry.supplier_id);
      const noteId = entry.delivery_note_id == null ? null : String(entry.delivery_note_id);
      const expenseItem = entry.expense_item == null ? null : String(entry.expense_item).trim();
      const description = entry.description == null ? null : String(entry.description).trim();
      if (!["PACKAGING", "SHIPPING", "OTHER"].includes(expenseType)
        || !CNY.test(amount) || Number(amount) <= 0
        || (supplierId && !UUID.test(supplierId)) || (noteId && !UUID.test(noteId))
        || (expenseType === "PACKAGING" && (!supplierId || !noteId))
        || (expenseType !== "PACKAGING" && (supplierId || noteId))
        || (expenseType === "OTHER" && (expenseItem?.length || 0) < 2)
        || (expenseItem?.length || 0) > 100 || (description?.length || 0) > 500) {
        throw new Error("请核对费用金额、供应商代码及费用项目");
      }
      return { expense_type: expenseType, amount_cny: Number(amount), supplier_id: supplierId,
        delivery_note_id: noteId, expense_item: expenseItem, description };
    });
    const { data, error } = await supabase.rpc("record_stock_order_expenses_batch", {
      p_stock_order_id: id, p_entries: entries, p_request_id: requestId,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "费用登记失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
