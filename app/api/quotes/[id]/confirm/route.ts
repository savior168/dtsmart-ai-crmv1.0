import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("quotes.confirm");
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { order_number?: string; method?: string; note?: string };
    const orderNumber = String(body.order_number || "").trim();
    if (!orderNumber) throw new Error("请输入客户确认后的订单编号");
    const { data, error } = await supabase.rpc("confirm_quote_create_sales_order", {
      p_quote_id: id,
      p_order_number: orderNumber,
      p_confirmation_method: String(body.method || "").trim() || null,
      p_confirmation_note: String(body.note || "").trim() || null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "客户确认失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
