import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

type CorrectionChange = {
  item_id?: unknown;
  received_quantity?: unknown;
  prepared_quantity?: unknown;
  supplier_code?: unknown;
  revert_start?: unknown;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (account.role !== "WAREHOUSE" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const body = await request.json() as { changes?: CorrectionChange[]; expected_updated_at?: unknown; reason?: unknown };
    const changes = body.changes;
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 500
      || changes.some((change) => !change || typeof change.item_id !== "string"
        || typeof change.received_quantity !== "number" || !Number.isSafeInteger(change.received_quantity) || change.received_quantity < 0
        || typeof change.prepared_quantity !== "number" || !Number.isSafeInteger(change.prepared_quantity) || change.prepared_quantity < 0
        || typeof change.supplier_code !== "string" || change.supplier_code.length > 100
        || (change.revert_start !== undefined && typeof change.revert_start !== "boolean"))) {
      throw new Error("请选择有效产品并填写正确的累计回货数、理货数和供应商编码");
    }
    const expected = String(body.expected_updated_at || "");
    if (!Number.isFinite(Date.parse(expected))) throw new Error("备货单版本无效，请刷新后重试");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 1000) throw new Error("请填写更正原因（最多1000字）");
    const { data, error } = await supabase.rpc("correct_stock_item_progress", {
      p_stock_order_id: id, p_changes: changes, p_expected_updated_at: expected, p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货进度更正失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
