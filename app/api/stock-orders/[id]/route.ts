import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    const { id } = await context.params;
    const [{ data: order, error }, { data: items, error: itemError }, { data: events, error: eventError }] = await Promise.all([
      supabase.from("stock_orders").select("id,quote_id,quote_number,stock_number,sales_user_id,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at,sales:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).single(),
      supabase.from("stock_order_items").select("id,line_number,item_name,brand,model,quality,description,description_zh,procurement_cost,quantity,preparation_requirement").eq("stock_order_id", id).order("line_number"),
      supabase.from("stock_order_events").select("id,from_status,to_status,note,created_by,created_at,creator:users!stock_order_events_created_by_fkey(name,email)").eq("stock_order_id", id).order("created_at", { ascending: false }),
    ]);
    if (error) throw error;
    if (itemError) throw itemError;
    if (eventError) throw eventError;
    return NextResponse.json({ order, items: items || [], events: events || [], can_update: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account, "stock.update") });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单详情加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
