import { NextRequest, NextResponse } from "next/server";
import {
  authErrorStatus,
  hasPermission,
  requirePermission,
} from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { summarizeStockProgress } from "@/lib/stock-progress";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";

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
          "*,owner:users!sales_orders_sales_user_id_fkey(name,email),customer:customers(company_name,contact_name)",
        )
        .eq("id", id)
        .single();
    if (order.error) throw order.error;
    if (account.role === "ORDER_CLERK" && order.data.confirmation_method !== "DIRECT_PI") throw new Error("FORBIDDEN");
    const relatedClient = account.role === "ORDER_CLERK" ? createAdminClient() : supabase;
    const [items, stock, quote, customerNames] = await Promise.all([
      supabase
        .from("sales_order_items")
        .select("*")
        .eq("sales_order_id", id)
        .order("line_number"),
      relatedClient
        .from("stock_orders")
        .select("id,stock_number,status,status_note,updated_at")
        .eq("sales_order_id", id)
        .maybeSingle(),
      relatedClient
        .from("quotes")
        .select("stocking_requirements")
        .eq("id", order.data.quote_id)
        .maybeSingle(),
      loadOrderCustomerNames([id]),
    ]);
    if (items.error) throw items.error;
    if (stock.error) throw stock.error;
    if (quote.error) throw quote.error;
    const stockItems = stock.data ? await relatedClient.from("stock_order_items")
      .select("quantity,received_quantity,prepared_quantity,shipped_quantity,preparation_status").eq("stock_order_id", stock.data.id) : null;
    if (stockItems?.error) throw stockItems.error;
    const receivingProgress = stockItems ? {
      total_items: stockItems.data?.length || 0,
      received_items: (stockItems.data || []).filter((item) => Number(item.received_quantity) >= Number(item.quantity)).length,
      ordered_units: (stockItems.data || []).reduce((sum, item) => sum + Number(item.quantity), 0),
      received_units: (stockItems.data || []).reduce((sum, item) => sum + Number(item.received_quantity), 0),
    } : null;
    const clerkCustomer = account.role === "ORDER_CLERK" ? await relatedClient.from("customers")
      .select("company_name,contact_name").eq("id", order.data.customer_id).maybeSingle() : null;
    if (clerkCustomer?.error) throw clerkCustomer.error;
    const writable = account.role === "ORDER_CLERK"
      ? order.data.prepared_by === account.id
      : order.data.sales_user_id === account.id || account.role === "ADMIN";
    return NextResponse.json({
      order: { ...order.data, customer: {
        ...(account.role === "ORDER_CLERK" ? clerkCustomer?.data : order.data.customer),
        contact_name: customerNames.get(id) || null,
      } },
      items: items.data || [],
      stock_order: stock.data ? { ...stock.data, progress: summarizeStockProgress(stock.data.status, stockItems?.data || []) } : null,
      receiving_progress: receivingProgress,
      stocking_requirements: quote.data?.stocking_requirements || "",
      can_edit_draft: writable && hasPermission(account, "orders.edit") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "DRAFT",
      can_delete_draft: (account.role === "SALES" || account.role === "ADMIN") && writable &&
        hasPermission(account, "orders.delete_draft") && order.data.confirmation_method === "DIRECT_PI" &&
        order.data.status === "DRAFT" && !stock.data,
      can_submit: writable && hasPermission(account, "orders.create") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "DRAFT",
      can_recall: account.role !== "ORDER_CLERK" && writable && hasPermission(account, "orders.edit") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "WAITING_STOCK" && stock.data?.status === "WAITING",
      can_edit:
        account.role !== "ORDER_CLERK" && writable &&
        hasPermission(account, "orders.edit") &&
        order.data.confirmation_method !== "DIRECT_PI" &&
        !["READY", "SHIPPED", "CANCELLED"].includes(order.data.status),
      can_cancel:
        account.role !== "ORDER_CLERK" && writable &&
        hasPermission(account, "orders.cancel") &&
        !(order.data.confirmation_method === "DIRECT_PI" && !["DRAFT", "WAITING_STOCK"].includes(order.data.status)) &&
        !["READY", "SHIPPED", "CANCELLED"].includes(order.data.status),
      can_export: hasPermission(account, "orders.export") && !["DRAFT", "CANCELLED"].includes(order.data.status),
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "销售订单详情加载失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePermission("orders.delete_draft");
    const { id } = await params;
    const body = await request.json();
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 1 || body.revision === null) {
      throw new Error("PI草稿版本号无效，请刷新后重试");
    }
    const { error } = await supabase.rpc("delete_never_submitted_pi_draft", {
      p_order_id: id,
      p_expected_revision: revision,
    });
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = sqlErrorMessage(error, "删除PI草稿失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
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
