import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

const validMoney = (value: unknown) => typeof value === "number" && Number.isFinite(value)
  && value >= 0 && value <= 999999999999.99
  && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json();
    const itemId = String(body.item_id || "");
    const expectedRevision = Number(body.expected_revision);
    const reason = String(body.reason || "").trim();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(id) || !uuid.test(itemId)
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !validMoney(body.expected_sale_cny) || !validMoney(body.expected_cost_cny)
      || !validMoney(body.revised_sale_cny) || !validMoney(body.revised_cost_cny)
      || reason.length < 1 || reason.length > 500) {
      return NextResponse.json({ error: "请核对产品、价格和500字以内的更正原因" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("correct_direct_pi_line_prices", {
      p_order_id: id, p_item_id: itemId, p_expected_revision: expectedRevision,
      p_expected_sale_cny: body.expected_sale_cny, p_expected_cost_cny: body.expected_cost_cny,
      p_revised_sale_cny: body.revised_sale_cny, p_revised_cost_cny: body.revised_cost_cny,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ result: data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI产品价格更正失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
