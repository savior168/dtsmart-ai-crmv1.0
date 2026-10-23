import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.procurement.edit");
    if (account.role !== "WAREHOUSE") throw new Error("无采购与备货更新权限");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const expected = String(body.expected_updated_at || "");
    if (!Number.isFinite(Date.parse(expected))) throw new Error("备货单版本无效，请刷新后重试");
    const note = String(body.note || "").trim();
    if (note.length > 1000) throw new Error("说明不能超过1000字");
    if (!Array.isArray(body.items) || body.items.length > 500 || body.items.length === 0) {
      throw new Error("采购与进度明细格式不正确");
    }
    const items = body.items.map((raw: unknown) => {
      if (!raw || typeof raw !== "object") throw new Error("采购与进度明细格式不正确");
      const item = raw as Record<string, unknown>;
      const cost = item.procurement_cost;
      const note = item.warehouse_note;
      const code = item.warehouse_supplier_code;
      if (typeof item.item_id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.item_id)
        || (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost)
          || cost < 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(cost))))
        || (note !== null && (typeof note !== "string" || note.length > 1000))
        || typeof code !== "string" || code.length > 100
        || !Number.isSafeInteger(item.received_quantity) || Number(item.received_quantity) < 0
        || !Number.isSafeInteger(item.prepared_quantity) || Number(item.prepared_quantity) < 0) {
        throw new Error("采购价、数量或备注格式不正确");
      }
      return {
        item_id: item.item_id,
        procurement_cost: cost,
        warehouse_note: note,
        warehouse_supplier_code: code,
        received_quantity: item.received_quantity,
        prepared_quantity: item.prepared_quantity,
      };
    });
    const { data, error } = await supabase.rpc("save_stock_entry_details", {
      p_stock_order_id: id,
      p_expected_updated_at: expected,
      p_items: items,
      p_note: note || null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "采购与进度保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
