import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CNY = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.update");
    const { id } = await context.params;
    if (!UUID.test(id)) throw new Error("备货单编号无效");
    const body = await request.json() as Record<string, unknown>;
    const lines = body.lines;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 500
      || lines.some((line) => !line || typeof line.item_id !== "string" || !UUID.test(line.item_id)
        || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      || new Set(lines.map((line) => line.item_id)).size !== lines.length) {
      throw new Error("请选择1至500项不重复的产品，并填写本次交货正整数数量");
    }
    const expected = String(body.expected_updated_at || "");
    if (!Number.isFinite(Date.parse(expected))) throw new Error("备货单版本无效，请刷新后重试");
    const note = String(body.note || "").trim();
    if (!note || note.length > 1000) throw new Error("请填写货代交接信息（最多1000字）");
    const costFields = ["packaging_cost_cny", "procurement_expenses_cny", "shipping_expenses_cny"] as const;
    if (costFields.some((key) => typeof body[key] !== "string" || !CNY.test(body[key]))) {
      throw new Error("包装费用、出货费用、其他费用均须填写人民币金额；无费用填0，最多两位小数");
    }
    const { data, error } = await supabase.rpc("record_stock_shipment_quantities", {
      p_stock_order_id: id,
      p_lines: lines,
      p_expected_updated_at: expected,
      p_note: note,
      p_packaging_cost_cny: Number(body.packaging_cost_cny),
      p_procurement_expenses_cny: Number(body.procurement_expenses_cny),
      p_shipping_expenses_cny: Number(body.shipping_expenses_cny),
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "交货代记录失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

