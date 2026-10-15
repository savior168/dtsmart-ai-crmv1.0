import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    const { id } = await context.params;
    const [{ data: order, error }, { data: items, error: itemError }, { data: events, error: eventError }] = await Promise.all([
      supabase.from("stock_orders").select("id,quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at,sales:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).maybeSingle(),
      supabase.from("stock_order_items").select("id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,procurement_cost,procurement_cost_confirmed,quantity,received_quantity,warehouse_supplier_code,preparation_requirement,internal_note,preparation_status").eq("stock_order_id", id).order("line_number"),
      supabase.from("stock_order_events").select("id,from_status,to_status,note,created_by,created_at").eq("stock_order_id", id).order("created_at", { ascending: false }),
    ]);
    if (error) throw error;
    if (!order) {
      // A recalled direct PI is deliberately hidden from warehouse RLS. A
      // warehouse user who keeps its old detail tab open still needs a clear
      // handoff message, without regaining access to the withdrawn line data.
      if (account.role === "WAREHOUSE") {
        const withdrawn = await createAdminClient().from("stock_orders")
          .select("id,sales_order_id,warehouse_reference_number,status")
          .eq("id", id).eq("status", "DRAFT").not("warehouse_reference_number", "is", null).maybeSingle();
        if (withdrawn.error) throw withdrawn.error;
        const linked = withdrawn.data ? await createAdminClient().from("sales_orders")
          .select("confirmation_method,status").eq("id", withdrawn.data.sales_order_id).maybeSingle() : null;
        if (linked?.error) throw linked.error;
        const salesOrder = linked?.data;
        if (salesOrder?.confirmation_method === "DIRECT_PI" && salesOrder.status === "DRAFT") {
          return NextResponse.json({ withdrawn: true, order_number: withdrawn.data?.warehouse_reference_number,
            message: "此PI订单已由销售员撤回，原备货单不再是仓库待办；请等待销售员重新提交。" }, { status: 410 });
        }
      }
      return NextResponse.json({ error: "备货单不存在或您无权查看" }, { status: 404 });
    }
    if (itemError) throw itemError;
    if (eventError) throw eventError;
    // The event rows are permission-scoped above. Ordinary warehouse users cannot
    // SELECT other users through users RLS, so resolve only those actor IDs here.
    const actorIds = [...new Set((events || []).map((event) => event.created_by).filter(Boolean))];
    const actorResult = actorIds.length
      ? await createAdminClient().from("users").select("id,name,email").in("id", actorIds)
      : { data: [], error: null };
    if (actorResult.error) throw actorResult.error;
    const actors = new Map((actorResult.data || []).map((actor) => [actor.id, actor]));
    const scopedEvents = (events || []).map((event) => ({ ...event, creator: actors.get(event.created_by) || null }));
    let expenses = null;
    if (["WAREHOUSE", "ADMIN"].includes(account.role)) {
      const result = await supabase.from("stock_order_expenses")
        .select("packaging_cost_cny,procurement_expenses_cny,shipping_expenses_cny,updated_at")
        .eq("stock_order_id", id).maybeSingle();
      if (result.error) throw result.error;
      expenses = result.data;
    }
    const warehouseEditor = ["WAREHOUSE", "ADMIN"].includes(account.role);
    const recalledPi = order.status === "DRAFT" && Boolean(order.warehouse_reference_number);
    const transitions:Record<string,string[]>={WAITING:["PREPARING","SHORTAGE","CANCELLED"],PREPARING:["RECEIVED","SHORTAGE","CANCELLED"],RECEIVED:["SORTING","SHORTAGE","CANCELLED"],SORTING:["READY_TO_SHIP","SHORTAGE","CANCELLED"],READY_TO_SHIP:["SHIPPED","CANCELLED"],SHORTAGE:["PREPARING","CANCELLED"],DRAFT:[],SHIPPED:[],READY:[],CANCELLED:[]};
    return NextResponse.json({ order, items: items || [], events: scopedEvents, ...(warehouseEditor ? { expenses } : {}), can_export: hasPermission(account, "stock.export") && !["DRAFT", "CANCELLED"].includes(order.status), can_view_pi: account.role !== "WAREHOUSE" && hasPermission(account,"orders.view"), recalled_pi: recalledPi, can_prepare: warehouseEditor && hasPermission(account,"stock.prepare") && order.status==="DRAFT" && !recalledPi, can_submit: warehouseEditor && hasPermission(account,"stock.submit") && order.status==="DRAFT" && !recalledPi, can_update: warehouseEditor && hasPermission(account, "stock.update") && order.status!=="DRAFT", can_edit_receiving: warehouseEditor && hasPermission(account,"stock.update") && ["WAITING","PREPARING","RECEIVED","SORTING","SHORTAGE"].includes(order.status), can_edit_procurement: warehouseEditor && hasPermission(account, "stock.procurement.edit") && ["WAITING","PREPARING","RECEIVED","SORTING","SHORTAGE"].includes(order.status), allowed_statuses:transitions[order.status]||[] });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单详情加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
