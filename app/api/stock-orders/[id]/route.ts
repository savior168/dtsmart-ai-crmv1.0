import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    const { id } = await context.params;
    const [{ data: order, error }, { data: items, error: itemError }, { data: events, error: eventError }] = await Promise.all([
      supabase.from("stock_orders").select("id,quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at,sales:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).single(),
      supabase.from("stock_order_items").select("id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,procurement_cost,procurement_cost_confirmed,quantity,received_quantity,warehouse_supplier_code,preparation_requirement,internal_note").eq("stock_order_id", id).order("line_number"),
      supabase.from("stock_order_events").select("id,from_status,to_status,note,created_by,created_at,creator:users!stock_order_events_created_by_fkey(name,email)").eq("stock_order_id", id).order("created_at", { ascending: false }),
    ]);
    if (error) throw error;
    if (itemError) throw itemError;
    if (eventError) throw eventError;
    let expenses = null;
    if (["WAREHOUSE", "ADMIN"].includes(account.role)) {
      const result = await supabase.from("stock_order_expenses")
        .select("packaging_cost_cny,procurement_expenses_cny,shipping_expenses_cny,updated_at")
        .eq("stock_order_id", id).maybeSingle();
      if (result.error) throw result.error;
      expenses = result.data;
    }
    const owner = order.sales_user_id === account.id || account.role === "ADMIN";
    const transitions:Record<string,string[]>={WAITING:["PREPARING","SHORTAGE","CANCELLED"],PREPARING:["RECEIVED","SHORTAGE","CANCELLED"],RECEIVED:["SORTING","SHORTAGE","CANCELLED"],SORTING:["READY_TO_SHIP","SHORTAGE","CANCELLED"],READY_TO_SHIP:["SHIPPED","CANCELLED"],SHORTAGE:["PREPARING","CANCELLED"],DRAFT:[],SHIPPED:[],READY:[],CANCELLED:[]};
    return NextResponse.json({ order, items: items || [], events: events || [], ...(["WAREHOUSE", "ADMIN"].includes(account.role) ? { expenses } : {}), can_view_pi: hasPermission(account,"orders.view"), can_prepare: owner && hasPermission(account,"stock.prepare") && order.status==="DRAFT", can_submit: owner && hasPermission(account,"stock.submit") && order.status==="DRAFT", can_update: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account, "stock.update") && order.status!=="DRAFT", can_edit_receiving: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account,"stock.update") && ["WAITING","PREPARING","RECEIVED","SORTING","SHORTAGE"].includes(order.status), can_edit_procurement: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account, "stock.procurement.edit") && ["WAITING","PREPARING","RECEIVED","SORTING","SHORTAGE"].includes(order.status), allowed_statuses:transitions[order.status]||[] });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单详情加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
