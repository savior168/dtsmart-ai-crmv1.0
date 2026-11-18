import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    assertSupplierRoleAllowed(account.role);
    if (!hasPermission(account, "stock.procurement.edit")
      || !hasPermission(account, "supplier.documents.manage")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const number = typeof body.note_number === "string" ? body.note_number.trim() : "";
    const version = typeof body.expected_updated_at === "string" ? body.expected_updated_at : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !number || number.length > 100
      || number.startsWith("__PENDING__") || !Number.isFinite(Date.parse(version))) {
      throw new Error("请输入真实送货单号并刷新待补记录后重试");
    }
    const result = await supabase.rpc("complete_supplier_delivery_note_number", {
      p_delivery_note_id: id, p_note_number: number, p_expected_updated_at: version,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ data: result.data });
  } catch (error) {
    const message = sqlErrorMessage(error, "补录送货单号失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
