import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("quotes.confirm");
    const { id } = await context.params;
    const { data, error } = await supabase.rpc("confirm_quote_and_create_stock_order", { p_quote_id: id });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "客户确认失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
