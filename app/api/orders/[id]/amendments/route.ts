import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json();
    const expectedRevision = Number(body.expected_revision);
    const reason = String(body.reason || "").trim();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500
      || !reason || reason.length > 500) throw new Error("请填写有效的PI版本、产品和变更原因");
    const { data, error } = await supabase.rpc("request_direct_pi_amendment", {
      p_order_id: id, p_expected_revision: expectedRevision,
      p_items: body.items, p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ amendment: data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI变更申请失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const requestId = new URL(request.url).searchParams.get("request_id");
    if (!requestId) throw new Error("缺少变更申请编号");
    const { data: order, error: orderError } = await supabase.from("sales_orders")
      .select("id").eq("id", id).maybeSingle();
    if (orderError || !order) throw new Error("PI订单不存在或无权访问");
    const { data, error } = await supabase.rpc("withdraw_direct_pi_amendment", {
      p_order_id: id, p_request_id: requestId,
    });
    if (error) throw error;
    if (data?.sales_order_id !== id) throw new Error("变更申请不属于此PI订单");
    return NextResponse.json({ amendment: data });
  } catch (error) {
    const message = sqlErrorMessage(error, "撤回PI变更失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
