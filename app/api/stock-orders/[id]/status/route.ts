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
    if (["SHORTAGE", "CANCELLED", "READY_TO_SHIP", "SHIPPED"].includes(status) && !note) throw new Error("请填写缺货/取消原因，或测试打包/物流交接说明");
    const expenseFields = ["packaging_cost_cny", "procurement_expenses_cny", "shipping_expenses_cny"] as const;
    const expenses = expenseFields.map((key) => String(body[key] ?? "").trim());
    if (status === "SHIPPED" && expenses.some((value) => !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))) {
      throw new Error("确认已发货前，请填写包装费、采购发生费和出货发生费；无费用请填0，最多两位小数");
    }
    const { data, error } = await supabase.rpc("update_stock_order_status", {
      p_stock_order_id: id, p_status: status, p_note: note || null,
      p_packaging_cost_cny: status === "SHIPPED" ? expenses[0] : null,
      p_procurement_expenses_cny: status === "SHIPPED" ? expenses[1] : null,
      p_shipping_expenses_cny: status === "SHIPPED" ? expenses[2] : null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货状态更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
