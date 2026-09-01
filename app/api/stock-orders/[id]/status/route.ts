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
    if (["SHORTAGE", "CANCELLED"].includes(status) && !note) throw new Error("缺货异常或取消时必须填写原因说明");
    const { data, error } = await supabase.rpc("update_stock_order_status", { p_stock_order_id: id, p_status: status, p_note: note || null });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货状态更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
