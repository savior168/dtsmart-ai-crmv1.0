import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.procurement.edit");
    assertSupplierRoleAllowed(account.role);
    const { id } = await context.params;
    const body = await request.json();
    const allocationId = String(body?.allocation_id || "");
    const expected = Number(body?.expected_price_cny);
    const revised = Number(body?.new_price_cny);
    const reason = String(body?.reason || "").trim();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validMoney = (value: number) => Number.isFinite(value) && value >= 0
      && value <= 999999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
    if (!uuid.test(id) || !uuid.test(allocationId)
      || body?.expected_price_cny == null || body?.new_price_cny == null || !validMoney(expected)
      || !validMoney(revised) || reason.length < 2 || reason.length > 500) {
      return NextResponse.json({ error: "请核对送货单产品、采购价及2至500字更正原因" }, { status: 400 });
    }
    const { error } = await supabase.rpc("correct_supplier_receipt_purchase_price", {
      p_stock_order_id: id,
      p_allocation_id: allocationId,
      p_expected_price_cny: expected,
      p_new_price_cny: revised,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = sqlErrorMessage(error, "送货单采购价更正失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
