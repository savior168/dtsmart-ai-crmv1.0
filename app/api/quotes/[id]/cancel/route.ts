import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("quotes.cancel");
    const { id } = await context.params;
    const body = await request.json();
    const { data, error } = await supabase.rpc("cancel_quote", { p_quote_id: id, p_reason: String(body.reason || "") });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "报价取消失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
