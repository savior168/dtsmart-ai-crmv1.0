import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";

export async function POST(request: Request, context: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const { supabase } = await requirePermission("pricebooks.import");
    const { id, rowId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const excerpt = typeof body.excerpt === "string" ? body.excerpt.trim() : "";
    if (excerpt.length < 2 || excerpt.length > 1000) {
      return NextResponse.json({ error: "请填写原始单元格中2至1000字的准确片段" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("split_product_import_row", {
      p_batch_id: id, p_row_id: rowId, p_excerpt: excerpt,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "来源单元格拆分失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
