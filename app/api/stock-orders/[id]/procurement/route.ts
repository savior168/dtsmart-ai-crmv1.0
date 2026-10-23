import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.procurement.edit");
    if (account.role !== "WAREHOUSE") throw new Error("无采购核价权限");
    const { id } = await context.params;
    const body = await request.json();
    if (!Array.isArray(body.items)) throw new Error("采购价明细格式不正确");
    const items = body.items.map((item: Record<string, unknown>) => {
      const line = Number(item.line_number);
      const cost = item.procurement_cost;
      const warehouseNote = item.warehouse_note;
      if (!Number.isInteger(line) || line <= 0 || (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || !/^\d+(?:\.\d{1,2})?$/.test(String(cost))))) {
        throw new Error("采购价明细存在无效行号或金额");
      }
      if (warehouseNote !== null && (typeof warehouseNote !== "string" || warehouseNote.length > 1000)) {
        throw new Error("仓库备注最多1000字");
      }
      return { line_number: line, procurement_cost: cost, warehouse_note: warehouseNote };
    });
    const { data, error } = await supabase.rpc("save_stock_order_procurement_costs", { p_stock_order_id: id, p_items: items });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "采购价保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
