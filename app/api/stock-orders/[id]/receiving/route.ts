import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.update");
    const { id } = await context.params;
    const body = await request.json();
    const expectedUpdatedAt = String(body.expected_updated_at || "");
    if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error("缺少备货单版本，请刷新页面重试");
    if (!Array.isArray(body.items)) throw new Error("回货明细格式不正确");
    const items = body.items.map((item: Record<string, unknown>) => {
      const line = Number(item.line_number);
      const received = item.received_quantity;
      const supplierCode = String(item.warehouse_supplier_code ?? "").trim();
      if (!Number.isInteger(line) || line <= 0 || typeof received !== "number" || !Number.isSafeInteger(received)
        || received < 0 || supplierCode.length > 100) throw new Error("回货数量须为非负整数，供应商编码不能超过100字");
      return { line_number: line, received_quantity: received, warehouse_supplier_code: supplierCode };
    });
    const { data, error } = await supabase.rpc("save_stock_receiving_details", { p_stock_order_id: id, p_items: items, p_expected_updated_at: expectedUpdatedAt });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "回货信息保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
