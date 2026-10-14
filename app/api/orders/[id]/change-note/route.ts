import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { numberedPiChangeNote } from "@/lib/pi-change-note";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json() as { revision?: number; note?: string };
    if (!Number.isInteger(body.revision) || Number(body.revision) < 1) throw new Error("PI草稿版本不正确，请刷新");
    if (typeof body.note !== "string" || body.note.length > 2000) throw new Error("订单变更说明最多2000字");
    const { data, error } = await supabase.rpc("set_direct_pi_change_note", {
      p_order_id: id, p_expected_revision: body.revision, p_note: numberedPiChangeNote(body.note),
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "订单变更说明保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
