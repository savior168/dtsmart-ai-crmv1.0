import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { parsePiOrderInput } from "@/lib/pi-order-input";
import { isPiOrderNumberConflict, sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.fx_rate_confirmed !== true) throw new Error("请核对汇率参考来源并确认后再保存PI");
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("PI草稿版本不正确，请刷新");
    const { p_customer_id: _customerId, ...payload } = parsePiOrderInput(body);
    void _customerId;
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
