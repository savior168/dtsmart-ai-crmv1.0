import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.update");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const changes = body.changes;
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 500 ||
      changes.some((item) => !item || typeof item !== "object" ||
        typeof item.item_id !== "string" || typeof item.status !== "string")) {
      throw new Error("请选择1至500项有效产品明细");
    }
    const expected = String(body.expected_updated_at || "");
    if (!Number.isFinite(Date.parse(expected))) throw new Error("备货单版本无效，请刷新后重试");
    const note = String(body.note || "").trim();
    if (note.length > 1000) throw new Error("状态说明不能超过1000字");
    const { data, error } = await supabase.rpc("update_stock_item_stages", {
      p_stock_order_id: id, p_changes: changes, p_expected_updated_at: expected, p_note: note || null,
      p_packaging_cost_cny: body.packaging_cost_cny ?? null,
      p_procurement_expenses_cny: body.procurement_expenses_cny ?? null,
      p_shipping_expenses_cny: body.shipping_expenses_cny ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "逐项备货状态更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
