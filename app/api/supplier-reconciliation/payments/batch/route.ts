import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";
import { sqlErrorMessage } from "@/lib/sales-flow";

const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const money = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("supplier.reconciliation.manage");
    assertSupplierRoleAllowed(account.role);
    const body = await request.json() as Record<string, unknown>;
    const supplierId = String(body.supplier_id || "");
    const paidOn = String(body.paid_on || "");
    const method = String(body.payment_method || "");
    const reference = String(body.payment_reference || "").trim();
    const lines = body.lines;
    if (!uuid.test(supplierId) || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)
      || !["CASH", "BANK", "ALIPAY", "WECHAT", "OTHER"].includes(method)
      || reference.length > 200 || !Array.isArray(lines) || lines.length < 2 || lines.length > 50
      || new Set(lines.map((line) => line?.delivery_note_id)).size !== lines.length
      || lines.some((line) => !line || typeof line.delivery_note_id !== "string" || !uuid.test(line.delivery_note_id)
        || !money.test(String(line.amount_cny ?? "")) || Number(line.amount_cny) <= 0
        || !money.test(String(line.expected_unpaid_cny ?? "")))) {
      throw new Error("请选择同一供应商的2至50张送货单，逐张核对付款金额和未付余额");
    }
    const { data, error } = await supabase.rpc("record_supplier_payments_batch", {
      p_supplier_id: supplierId, p_paid_on: paidOn, p_payment_method: method,
      p_payment_reference: reference, p_lines: lines,
    });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "批量付款登记失败，整批未入账");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
