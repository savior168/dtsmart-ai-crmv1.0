import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("pricebooks.publish");
    const { id } = await context.params;
    const { data, error } = await supabase.rpc("publish_product_import", { p_batch_id: id });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品价格表发布失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
