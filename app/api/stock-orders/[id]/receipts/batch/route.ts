import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

type BatchLine = {
  stock_order_item_id?: unknown;
  supplier_id?: unknown;
  note_number?: unknown;
  document_date?: unknown;
  quantity?: unknown;
  purchase_unit_price_cny?: unknown;
  cash_paid_reported_cny?: unknown;
};

const moneyPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (!hasPermission(account, "stock.procurement.edit")) throw new Error("无采购核价权限");
    const { id } = await context.params;
    const body = await request.json() as { lines?: BatchLine[]; expected_updated_at?: unknown; note?: unknown };
    const lines = body.lines;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 500
      || note.length > 1000
      || lines.some((line) => {
        const quantity = Number(line?.quantity);
        const price = String(line?.purchase_unit_price_cny ?? "");
        const date = String(line?.document_date ?? "");
        const noteNumber = String(line?.note_number ?? "").trim();
        const paid = line?.cash_paid_reported_cny == null || line.cash_paid_reported_cny === ""
          ? null : String(line.cash_paid_reported_cny);
        return typeof line?.stock_order_item_id !== "string" || typeof line?.supplier_id !== "string"
          || !Number.isSafeInteger(quantity) || quantity <= 0
          || !moneyPattern.test(price) || !Number.isFinite(Number(price))
          || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !noteNumber || noteNumber.length > 100
          || paid !== null && (!moneyPattern.test(paid) || Number(paid) > quantity * Number(price));
      })
      || !Number.isFinite(Date.parse(String(body.expected_updated_at || "")))) {
      throw new Error("请为每个来源填写有效的供应商代码、送货单号、日期、回货数量和采购单价");
    }
    const { data, error } = await supabase.rpc("record_supplier_receipts_batch", {
      p_stock_order_id: id,
      p_lines: lines.map((line) => ({
        item_id: line.stock_order_item_id,
        supplier_id: line.supplier_id,
        note_number: String(line.note_number).trim(),
        document_date: line.document_date,
        quantity: Number(line.quantity),
        purchase_unit_price_cny: String(line.purchase_unit_price_cny),
        cash_paid_reported_cny: line.cash_paid_reported_cny == null || line.cash_paid_reported_cny === ""
          ? null : String(line.cash_paid_reported_cny),
      })),
      p_expected_updated_at: body.expected_updated_at,
      p_note: note || null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "批量回货登记失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
