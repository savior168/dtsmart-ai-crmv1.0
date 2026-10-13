import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const { reason } = await request.json() as { reason?: string };
    if (!reason?.trim() || reason.trim().length > 500) throw new Error("请填写500字以内的撤回原因");
    const { data, error } = await supabase.rpc("recall_direct_pi_order", {
      p_order_id: id, p_reason: reason.trim(),
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI撤回失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
