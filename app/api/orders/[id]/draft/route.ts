import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { parsePiOrderInput } from "@/lib/pi-order-input";
import { isPiOrderNumberConflict, sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertPiDeliveryClassification } from "@/lib/orders/pi-delivery-classification";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.fx_rate_confirmed !== true) throw new Error("请核对汇率参考来源并确认后再保存PI");
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("PI草稿版本不正确，请刷新");
    const { p_customer_id: _customerId, ...payload } = parsePiOrderInput(body);
    void _customerId;
    const { data: order, error: orderError } = await supabase.from("sales_orders")
      .select("prepared_by,sales_user_id,status,confirmation_method").eq("id", id).maybeSingle();
    if (orderError) throw orderError;
    if (!order || (order.prepared_by || order.sales_user_id) !== account.id || order.status !== "DRAFT" || order.confirmation_method !== "DIRECT_PI") {
      return NextResponse.json({ error: "仅可修改本人创建的 PI 草稿" }, { status: 403 });
    }
    await assertPiDeliveryClassification(_customerId, body);
    // The legacy draft RPC replaces every item row. A requirement photo must
    // never silently move to a different product when rows are reordered.
    const admin = createAdminClient();
    const attached = await admin.from("attachments")
      .select("pi_line_number_snapshot")
      .eq("sales_order_id", id).eq("kind", "PI_LINE_REQUIREMENT");
    if (attached.error) throw attached.error;
    if (attached.data?.length) {
      const existing = await admin.from("sales_order_items")
        .select("line_number,item_name,brand,model,quality")
        .eq("sales_order_id", id);
      if (existing.error) throw existing.error;
      const currentByLine = new Map((existing.data || []).map((item) => [item.line_number, item]));
      for (const attachment of attached.data) {
        const number = Number(attachment.pi_line_number_snapshot);
        const before = currentByLine.get(number);
        const after = payload.p_items[number - 1];
        if (!before || !after || ["item_name", "brand", "model", "quality"].some((key) =>
          String(before[key as keyof typeof before] || "") !== String(after[key as keyof typeof after] || ""))) {
          throw new Error(`第 ${number} 行已有理货图片；变更产品身份或删除该行前，请先移除对应图片`);
        }
      }
    }
    const { data, error } = await supabase.rpc("update_direct_pi_draft_with_fees", {
      p_order_id: id,
      p_expected_revision: revision,
      ...payload,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI草稿保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || (isPiOrderNumberConflict(error) ? 409 : 400) });
  }
}
