import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CNY = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.update");
    if (!["WAREHOUSE", "ADMIN"].includes(account.role)) throw new Error("无费用更正权限");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const entryId = String(body.entry_id || "");
    const expected = String(body.expected_cny ?? "");
    const revised = String(body.revised_cny ?? "");
    const type = String(body.expense_type || "");
    const supplierId = body.supplier_id == null ? null : String(body.supplier_id);
    const noteId = body.delivery_note_id == null ? null : String(body.delivery_note_id);
    const item = String(body.expense_item || "").trim();
    const description = String(body.description || "").trim();
    const reason = String(body.reason || "").trim();
    if (!UUID.test(id) || !UUID.test(entryId) || !["PACKAGING", "SHIPPING", "OTHER"].includes(type)
      || !CNY.test(expected) || !CNY.test(revised)
      || (supplierId && !UUID.test(supplierId)) || (noteId && !UUID.test(noteId))
      || (type === "PACKAGING" && Number(revised) > 0 && (!supplierId || !noteId))
      || (type !== "PACKAGING" && (supplierId || noteId))
      || (type === "OTHER" && Number(revised) > 0 && (item.length < 2 || description.length < 2))
      || item.length > 100 || description.length > 500 || reason.length < 2 || reason.length > 500) {
      throw new Error("请核对费用金额、关联单据、项目说明及更正原因");
    }
    const { data, error } = await supabase.rpc("correct_stock_order_expense_entry", {
      p_stock_order_id: id, p_entry_id: entryId, p_expected_cny: Number(expected),
      p_revised_cny: Number(revised), p_supplier_id: supplierId, p_delivery_note_id: noteId,
      p_expense_item: item || null, p_description: description || null, p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "费用更正失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
