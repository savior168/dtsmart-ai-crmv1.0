import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json().catch(() => { throw new Error("请求数据格式不正确"); });
    const entityType = String(body.entity_type || "");
    const action = String(body.action || "");
    const ids = Array.isArray(body.ids) && body.ids.every((id: unknown) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      ? body.ids as string[]
      : [];
    const reason = String(body.reason || "").trim();
    if (!["sales_order", "stock_order"].includes(entityType)) throw new Error("单据类型不正确");
    if (!["ARCHIVE", "RESTORE"].includes(action)) throw new Error("操作类型不正确");
    if (!ids.length || ids.length > 100) throw new Error("请选择 1 至 100 张单据");
    if (new Set(ids).size !== ids.length) throw new Error("所选单据包含重复记录，请刷新后重试");
    if (action === "ARCHIVE" && !reason) throw new Error("请填写归档原因");
    if (reason.length > 500) throw new Error("归档原因不能超过 500 个字符");
    const targetQuery = entityType === "sales_order"
      ? await supabase.from("sales_orders").select("id,confirmation_method").in("id", ids)
      : await supabase.from("stock_orders").select("id").in("id", ids);
    if (targetQuery.error) throw targetQuery.error;
    if ((targetQuery.data || []).length !== ids.length) throw new Error("部分单据已不存在或不可访问，请刷新列表后重试");
    if (entityType === "sales_order" && (targetQuery.data || []).some((row) => "confirmation_method" in row && row.confirmation_method !== "DIRECT_PI")) {
      throw new Error("本入口仅支持归档 PI 订单");
    }
    const { data, error } = await supabase.rpc("manage_order_archives", {
      p_entity_type: entityType,
      p_ids: ids,
      p_action: action,
      p_reason: reason || null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "单据归档操作失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
