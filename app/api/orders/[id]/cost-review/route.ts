import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.cost_review");
    const { id } = await params;
    const body = await request.json();
    const itemId = String(body.item_id || "");
    const expected = Number(body.expected_unit_cost_cny);
    const revised = Number(body.revised_unit_cost_cny);
    const reason = String(body.reason || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)
      || !Number.isFinite(expected) || expected < 0 || !Number.isFinite(revised)
      || revised < 0 || revised > 999999999999.99
      || Math.abs(revised * 100 - Math.round(revised * 100)) > 0.000001
      || !reason || reason.length > 500) {
      throw new Error("请填写有效的产品、人民币成本单价和复核原因");
    }
    const { data, error } = await supabase.rpc("review_shipped_pi_seller_cost", {
      p_order_id: id,
      p_item_id: itemId,
      p_expected_unit_cost_cny: expected,
      p_revised_unit_cost_cny: revised,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (error) {
    const message = sqlErrorMessage(error, "销售成本复核失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
