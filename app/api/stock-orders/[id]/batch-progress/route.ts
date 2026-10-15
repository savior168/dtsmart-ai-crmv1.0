import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (account.role !== "WAREHOUSE" && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (body.stage !== "RECEIVED" && body.stage !== "READY_TO_SHIP") throw new Error("请选择有效的批量进度");
    if (!Array.isArray(body.item_ids) || body.item_ids.length < 1 || body.item_ids.length > 500
      || body.item_ids.some((value) => typeof value !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))
      || new Set(body.item_ids).size !== body.item_ids.length) throw new Error("请选择1至500项不重复的产品");
    const expected = String(body.expected_updated_at || "");
    if (!Number.isFinite(Date.parse(expected))) throw new Error("备货单版本无效，请刷新后重试");
    const { data, error } = await supabase.rpc("complete_stock_items_batch", {
      p_stock_order_id: id, p_stage: body.stage, p_item_ids: body.item_ids,
      p_expected_updated_at: expected,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "批量备货进度更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
