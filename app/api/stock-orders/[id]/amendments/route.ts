import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("stock.update");
    const { id } = await params;
    const body = await request.json();
    const requestId = String(body.request_id || "");
    const reason = String(body.reason || "").trim();
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)
      || typeof body.approve !== "boolean" || reason.length > 500
      || !body.approve && !reason) throw new Error("请核对备货单、变更申请及审批原因");
    const visible = await supabase.from("stock_orders").select("id").eq("id", id).maybeSingle();
    if (visible.error) throw visible.error;
    if (!visible.data) throw new Error("FORBIDDEN");
    const match = await createAdminClient().from("pi_amendment_requests")
      .select("id").eq("id", requestId).eq("stock_order_id", id).maybeSingle();
    if (match.error) throw match.error;
    if (!match.data) throw new Error("PI变更申请不属于此备货单");
    const { data, error } = await supabase.rpc("decide_direct_pi_amendment", {
      p_request_id: requestId, p_approve: body.approve, p_reason: reason || null,
    });
    if (error) throw error;
    return NextResponse.json({ amendment: data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI变更审批失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
