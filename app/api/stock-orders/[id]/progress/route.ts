import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (account.role !== "WAREHOUSE" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (!["START", "RECEIVE", "PREPARE", "SHIP"].includes(action)) throw new Error("无效的备货动作");
    const changes = body.changes;
    if (!Array.isArray(changes) || changes.length > 500 || (action === "SHIP" ? changes.length !== 0 : changes.length === 0)
      || changes.some((change) => !change || typeof change !== "object" || typeof change.item_id !== "string"
        || (action !== "START" && (!Number.isSafeInteger(change.quantity) || change.quantity < 0))
        || (action === "RECEIVE" && (typeof change.supplier_code !== "string" || change.supplier_code.length > 100)))) {
      throw new Error("请选择有效产品并填写本次处理数量");
    }
    const expected = String(body.expected_updated_at || "");
    if (!Number.isFinite(Date.parse(expected))) throw new Error("备货单版本无效，请刷新后重试");
    const note = String(body.note || "").trim();
    if (note.length > 1000) throw new Error("说明不能超过1000字");
    if (action === "SHIP" && !note) throw new Error("交货代时请填写交接说明");
    const { data, error } = await supabase.rpc("record_stock_progress", {
      p_stock_order_id: id, p_action: action, p_changes: changes,
      p_expected_updated_at: expected, p_note: note || null,
    });
    if (error) throw error;
    const changedIds = changes.map((change) => change.item_id);
    const updated = changedIds.length ? await supabase.from("stock_order_items")
      .select("id,received_quantity,prepared_quantity,shipped_quantity,preparation_status,warehouse_supplier_code")
      .in("id", changedIds).eq("stock_order_id", id) : null;
    if (updated?.error) throw updated.error;
    return NextResponse.json({ data, items: updated?.data || [] });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货进度更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
