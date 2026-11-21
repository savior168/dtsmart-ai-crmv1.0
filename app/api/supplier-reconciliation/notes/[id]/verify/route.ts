import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("supplier.reconciliation.manage");
    if (!["FINANCE", "ADMIN"].includes(account.role) || !hasPermission(account, "supplier.documents.view")) {
      throw new Error("无纸单核对确认权限");
    }
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const quantity = Number(body.paper_quantity);
    const version = typeof body.expected_updated_at === "string" ? body.expected_updated_at : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(quantity) || quantity <= 0
      || !Number.isFinite(Date.parse(version)) || body.acknowledged !== true) {
      throw new Error("请填写照片上的产品总数量，并确认逐项核对后重试");
    }
    const { data, error } = await supabase.rpc("confirm_supplier_note_paper_verification", {
      p_delivery_note_id: id,
      p_paper_quantity: quantity,
      p_expected_updated_at: version,
      p_acknowledged: true,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "确认纸单核对失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
