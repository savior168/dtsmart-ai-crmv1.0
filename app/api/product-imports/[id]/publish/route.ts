import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("pricebooks.publish");
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const rowIds = body?.row_ids;
    if (!Array.isArray(rowIds) || rowIds.length < 1 || rowIds.length > 100 ||
      new Set(rowIds).size !== rowIds.length ||
      rowIds.some((value) => typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) {
      return NextResponse.json({ error: "请选择1至100条不重复的已核准记录" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("publish_product_import_rows", { p_batch_id: id, p_row_ids: rowIds });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品价格表发布失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
