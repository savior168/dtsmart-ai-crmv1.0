import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("supplier.reconciliation.manage");
    const body = await request.json() as Record<string, unknown>;
    const amountText = String(body.amount_cny ?? "");
    const amount = Number(amountText);
    const paidOn = String(body.paid_on || "");
    const method = String(body.payment_method || "");
    const reference = String(body.payment_reference || "").trim();
    if (typeof body.delivery_note_id !== "string"
      || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountText)
      || !Number.isFinite(amount) || amount <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)
      || !["CASH", "BANK", "ALIPAY", "WECHAT", "OTHER"].includes(method)
      || !reference || reference.length > 200) {
      throw new Error("请填写有效的送货单、付款金额、日期、方式及凭证号");
    }
    const { data, error } = await supabase.rpc("record_supplier_payment", {
      p_delivery_note_id: body.delivery_note_id, p_amount_cny: amount,
      p_paid_on: paidOn, p_payment_method: method, p_payment_reference: reference,
    });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "供应商付款登记失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
