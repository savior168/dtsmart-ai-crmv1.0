import { NextRequest, NextResponse } from "next/server";
import {
  authErrorStatus,
  hasPermission,
  requirePermission,
} from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, account } = await requirePermission("orders.view");
    const { id } = await params;
    const order = await supabase
        .from("sales_orders")
        .select(
          "*,owner:users!sales_orders_sales_user_id_fkey(name,email),customer:customers(company_name)",
        )
        .eq("id", id)
        .single();
    if (order.error) throw order.error;
    const [items, stock, quote] = await Promise.all([
      supabase
        .from("sales_order_items")
        .select("*")
        .eq("sales_order_id", id)
        .order("line_number"),
      supabase
        .from("stock_orders")
        .select("id,stock_number,status,status_note,updated_at")
        .eq("sales_order_id", id)
        .maybeSingle(),
      supabase
        .from("quotes")
        .select("stocking_requirements")
        .eq("id", order.data.quote_id)
        .maybeSingle(),
    ]);
    if (items.error) throw items.error;
    if (stock.error) throw stock.error;
    if (quote.error) throw quote.error;
    const stockItems = stock.data ? await supabase.from("stock_order_items")
      .select("quantity,received_quantity").eq("stock_order_id", stock.data.id) : null;
    if (stockItems?.error) throw stockItems.error;
    const receivingProgress = stockItems ? {
      total_items: stockItems.data?.length || 0,
      received_items: (stockItems.data || []).filter((item) => Number(item.received_quantity) >= Number(item.quantity)).length,
      ordered_units: (stockItems.data || []).reduce((sum, item) => sum + Number(item.quantity), 0),
      received_units: (stockItems.data || []).reduce((sum, item) => sum + Number(item.received_quantity), 0),
    } : null;
    const writable =
      order.data.sales_user_id === account.id || account.role === "ADMIN";
    return NextResponse.json({
      order: order.data,
      items: items.data || [],
      stock_order: stock.data,
      receiving_progress: receivingProgress,
      stocking_requirements: quote.data?.stocking_requirements || "",
      can_edit_draft: writable && hasPermission(account, "orders.edit") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "DRAFT",
      can_submit: writable && hasPermission(account, "orders.create") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "DRAFT",
      can_recall: writable && hasPermission(account, "orders.edit") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "WAITING_STOCK" && stock.data?.status === "WAITING",
      can_edit:
        writable &&
        hasPermission(account, "orders.edit") &&
        order.data.confirmation_method !== "DIRECT_PI" &&
        !["READY", "SHIPPED", "CANCELLED"].includes(order.data.status),
      can_cancel:
        writable &&
        hasPermission(account, "orders.cancel") &&
        !(order.data.confirmation_method === "DIRECT_PI" && !["DRAFT", "WAITING_STOCK"].includes(order.data.status)) &&
        !["READY", "SHIPPED", "CANCELLED"].includes(order.data.status),
      can_export: hasPermission(account, "orders.export") && order.data.status !== "DRAFT",
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "销售订单详情加载失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePermission("orders.edit");
    const { id } = await params;
    const body = await request.json();
    const { data, error } = await supabase.rpc("update_sales_order_details", {
      p_sales_order_id: id,
      p_delivery_date: String(body.delivery_date || "") || null,
      p_confirmation_note: String(body.confirmation_note || "") || null,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "销售订单保存失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}
