import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("supplier.reconciliation.manage");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const amountText = String(body.paper_total_cny ?? "");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const version = typeof body.expected_updated_at === "string" ? body.expected_updated_at : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)
      || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amountText)
      || !reason || reason.length > 500 || !Number.isFinite(Date.parse(version))) {
      throw new Error("请输入有效的纸质送货单金额、核对说明并刷新单据版本");
    }
    const { data, error } = await supabase.rpc("confirm_supplier_note_paper_total", {
      p_delivery_note_id: id,
      p_paper_total_cny: Number(amountText),
      p_expected_updated_at: version,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "纸质送货单金额核对失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
