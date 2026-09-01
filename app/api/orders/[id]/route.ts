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
    const [order, items, stock] = await Promise.all([
      supabase
        .from("sales_orders")
        .select(
          "*,owner:users!sales_orders_sales_user_id_fkey(name,email),customer:customers(company_name)",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("sales_order_items")
        .select("*")
        .eq("sales_order_id", id)
        .order("line_number"),
      supabase
        .from("stock_orders")
        .select("id,stock_number,status,status_note,updated_at")
        .eq("sales_order_id", id)
        .single(),
    ]);
    if (order.error) throw order.error;
    if (items.error) throw items.error;
    if (stock.error) throw stock.error;
    const writable =
      order.data.sales_user_id === account.id || account.role === "ADMIN";
    return NextResponse.json({
      order: order.data,
      items: items.data || [],
      stock_order: stock.data,
      can_edit:
        writable &&
        hasPermission(account, "orders.edit") &&
        !["READY", "CANCELLED"].includes(order.data.status),
      can_cancel:
        writable &&
        hasPermission(account, "orders.cancel") &&
        !["READY", "CANCELLED"].includes(order.data.status),
      can_export: hasPermission(account, "orders.export"),
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
