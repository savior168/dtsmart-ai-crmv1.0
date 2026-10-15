import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.update");
    const { id } = await context.params;
    const body = await request.json();
    const status = String(body.status || "");
    const note = String(body.note || "").trim();
    if (!["SHORTAGE", "CANCELLED", "PREPARING"].includes(status)) throw new Error("常规备货进度请通过产品数量及整单交接更新");
    if (!note) throw new Error("请填写异常处理或恢复采购的原因");
    if (note.length > 1000) throw new Error("说明不能超过1000字");
    if (["packaging_cost_cny", "procurement_expenses_cny", "shipping_expenses_cny"].some((key) => body[key] != null)) throw new Error("此入口不处理费用");
    const { data, error } = await supabase.rpc("update_stock_order_status", {
      p_stock_order_id: id, p_status: status, p_note: note || null,
      p_packaging_cost_cny: null,
      p_procurement_expenses_cny: null,
      p_shipping_expenses_cny: null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货状态更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
