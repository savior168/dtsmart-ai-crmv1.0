import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (account.role !== "WAREHOUSE" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    if (!hasPermission(account, "stock.procurement.edit")) throw new Error("无采购核价权限");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const quantity = Number(body.quantity);
    const priceText = String(body.purchase_unit_price_cny ?? "");
    const unitPrice = Number(priceText);
    const date = String(body.document_date || "");
    const version = String(body.expected_updated_at || "");
    const noteNumber = String(body.note_number || "").trim();
    const note = String(body.note || "").trim();
    const cashPaidText = body.cash_paid_reported_cny == null || body.cash_paid_reported_cny === ""
      ? null : String(body.cash_paid_reported_cny);
    if (typeof body.stock_order_item_id !== "string" || typeof body.supplier_id !== "string"
      || !Number.isSafeInteger(quantity) || quantity <= 0
      || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(priceText) || !Number.isFinite(unitPrice)
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(version))
      || !noteNumber || noteNumber.length > 100 || note.length > 1000
      || cashPaidText !== null && !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(cashPaidText)
      || cashPaidText !== null && Number(cashPaidText) > quantity * unitPrice) {
      throw new Error("请选择产品、供应商，填写本次回货数量、送货单号、送货日期和采购单价");
    }
    const { data, error } = await supabase.rpc("record_supplier_receipt", {
      p_stock_order_id: id,
      p_stock_order_item_id: body.stock_order_item_id,
      p_supplier_id: body.supplier_id,
      p_note_number: noteNumber,
      p_document_date: date,
      p_quantity: quantity,
      p_purchase_unit_price_cny: unitPrice,
      p_expected_updated_at: version,
      p_note: note || null,
      p_cash_paid_reported_cny: cashPaidText === null ? null : Number(cashPaidText),
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "回货登记失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
