import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { account, supabase } = await requirePermission("pricebooks.publish");
    if (!hasPermission(account, "pricebooks.import") || !hasPermission(account, "pricebooks.manage"))
      return NextResponse.json({ error: "无批量调价发布权限" }, { status: 403 });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "批次编号无效" }, { status: 400 });
    const { data, error } = await supabase.rpc("publish_product_price_import", { p_batch_id: id });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量调价失败；整批未生效";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 409 });
  }
}
