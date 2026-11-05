import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (!hasPermission(account, "stock.procurement.edit")) throw new Error("无采购核价权限");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const quantity = body.quantity;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const version = typeof body.expected_updated_at === "string" ? body.expected_updated_at : "";
    if (typeof body.allocation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.allocation_id)
      || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0
      || !reason || reason.length > 1000 || !Number.isFinite(Date.parse(version))) {
      throw new Error("请选择回货记录，填写有效冲正数量、原因并刷新备货单版本");
    }
    const { data, error } = await supabase.rpc("reverse_supplier_receipt", {
      p_stock_order_id: id,
      p_allocation_id: body.allocation_id,
      p_quantity: quantity,
      p_expected_updated_at: version,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "回货冲正失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
