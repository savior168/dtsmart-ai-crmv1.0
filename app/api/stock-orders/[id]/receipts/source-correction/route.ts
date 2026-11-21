import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    assertSupplierRoleAllowed(account.role);
    if (!hasPermission(account, "stock.procurement.edit")) throw new Error("无采购核价权限");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const quantity = body.quantity;
    const noteNumber = String(body.note_number ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const date = String(body.document_date ?? "");
    if (typeof body.allocation_id !== "string" || typeof body.supplier_id !== "string"
      || !Number.isSafeInteger(quantity) || Number(quantity) <= 0
      || noteNumber.length < 1 || noteNumber.length > 100 || noteNumber.startsWith("__PENDING__")
      || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || reason.length < 2 || reason.length > 500
      || !Number.isFinite(Date.parse(String(body.expected_updated_at ?? "")))) {
      throw new Error("请填写有效的更正数量、供应商、真实送货单号、日期和原因");
    }
    const { data, error } = await supabase.rpc("correct_shipped_receipt_source", {
      p_stock_order_id: id,
      p_allocation_id: body.allocation_id,
      p_quantity: quantity,
      p_supplier_id: body.supplier_id,
      p_note_number: noteNumber,
      p_document_date: date,
      p_expected_updated_at: body.expected_updated_at,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "回货来源更正失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
