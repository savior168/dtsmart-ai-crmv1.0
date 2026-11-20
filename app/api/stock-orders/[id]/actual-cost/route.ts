import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.actual_cost.edit");
    if (account.role !== "WAREHOUSE" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const body = await request.json();
    const itemId = String(body?.item_id || "");
    const expected = body.expected_cost_cny == null ? null : Number(body.expected_cost_cny);
    const revised = Number(body.actual_cost_cny);
    const reason = String(body.reason || "").trim();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validMoney = (value: number) => Number.isFinite(value) && value >= 0
      && value <= 999999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
    if (!uuid.test(id) || !uuid.test(itemId)
      || (expected !== null && !validMoney(expected)) || !validMoney(revised)
      || reason.length < 2 || reason.length > 500) {
      return NextResponse.json({ error: "请核对产品项、最新成本价及2至500字修改原因" }, { status: 400 });
    }
    const { error } = await supabase.rpc("update_stock_warehouse_actual_cost", {
      p_stock_order_id: id,
      p_item_id: itemId,
      p_expected_cost_cny: expected,
      p_new_cost_cny: revised,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = sqlErrorMessage(error, "最新成本价保存失败").replaceAll("实际成本价", "最新成本价");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
