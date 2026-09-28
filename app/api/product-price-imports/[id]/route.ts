import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("pricebooks.import");
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "批次编号无效" }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.from("product_price_import_batches").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "批次不存在" }, { status: 404 });
    if (data.rows.some((row: { price_kind: string }) => row.price_kind === "SALE_REFERENCE") && !hasPermission(account, "pricebooks.sales.view"))
      return NextResponse.json({ error: "无销售参考价查看权限" }, { status: 403 });
    if (data.rows.some((row: { price_kind: string }) => row.price_kind !== "SALE_REFERENCE") && !hasPermission(account, "pricebooks.cost.view"))
      return NextResponse.json({ error: "无采购成本查看权限" }, { status: 403 });
    return NextResponse.json({ data, can_publish: hasPermission(account, "pricebooks.publish") && hasPermission(account, "pricebooks.manage") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "调价预览读取失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
