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
import { resolvePiRequirementAttachments } from "@/lib/orders/pi-requirement-attachment-view";

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
          "*,owner:users!sales_orders_sales_user_id_fkey(name,email),customer:customers(company_name,contact_name,tax_number)",
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
      .select("line_number,quantity,received_quantity,prepared_quantity,shipped_quantity,preparation_status").eq("stock_order_id", stock.data.id).is("pi_amendment_cancelled_at", null) : null;
    if (stockItems?.error) throw stockItems.error;
    const amendmentResult = order.data.confirmation_method === "DIRECT_PI"
      ? await createAdminClient().from("pi_amendment_requests")
        .select("id,status,base_revision,applied_revision,reason,decision_note,created_at,decided_at,before_items,proposed_items")
        .eq("sales_order_id", id).order("created_at", { ascending: false }).limit(20)
      : null;
    if (amendmentResult?.error) throw amendmentResult.error;
    const amendments = amendmentResult?.data || [];
    const appliedCountResult = order.data.confirmation_method === "DIRECT_PI"
      ? await createAdminClient().from("pi_amendment_requests")
        .select("id", { count: "exact", head: true })
        .eq("sales_order_id", id).eq("status", "APPLIED") : null;
    if (appliedCountResult?.error) throw appliedCountResult.error;
    const requirementAttachments = order.data.confirmation_method === "DIRECT_PI"
      ? await createAdminClient().from("attachments")
        .select("id,filename,mime_type,size_bytes,created_at,pi_line_number_snapshot,pi_product_label_snapshot,sales_order_item_id")
        .eq("sales_order_id", id).in("kind", ["PI_ORDER_REQUIREMENT", "PI_LINE_REQUIREMENT"])
        .order("created_at") : null;
    if (requirementAttachments?.error) throw requirementAttachments.error;
    const receivingProgress = stockItems ? {
      total_items: stockItems.data?.length || 0,
      received_items: (stockItems.data || []).filter((item) => Number(item.received_quantity) >= Number(item.quantity)).length,
      ordered_units: (stockItems.data || []).reduce((sum, item) => sum + Number(item.quantity), 0),
      received_units: (stockItems.data || []).reduce((sum, item) => sum + Number(item.received_quantity), 0),
    } : null;
    const clerkCustomer = account.role === "ORDER_CLERK" ? await relatedClient.from("customers")
      .select("company_name,contact_name,tax_number").eq("id", order.data.customer_id).maybeSingle() : null;
    if (clerkCustomer?.error) throw clerkCustomer.error;
    const clerkOwner = account.role === "ORDER_CLERK" && !order.data.owner && order.data.sales_user_id
      ? await relatedClient.from("users").select("name,email").eq("id", order.data.sales_user_id).maybeSingle()
      : null;
    if (clerkOwner?.error) throw clerkOwner.error;
    const preparer = order.data.prepared_by ? await createAdminClient().from("users")
      .select("name,email").eq("id", order.data.prepared_by).maybeSingle() : null;
    if (preparer?.error) throw preparer.error;
    const writable = order.data.confirmation_method === "DIRECT_PI"
      ? (order.data.prepared_by || order.data.sales_user_id) === account.id
      : order.data.sales_user_id === account.id || account.role === "ADMIN";
    return NextResponse.json({
      order: { ...order.data, owner: clerkOwner?.data || order.data.owner,
        preparer: preparer?.data || null, customer: {
        ...(account.role === "ORDER_CLERK" ? clerkCustomer?.data : order.data.customer),
        contact_name: customerNames.get(id) || null,
      } },
      items: items.data || [],
      stock_order: stock.data ? { ...stock.data, progress: summarizeStockProgress(stock.data.status, stockItems?.data || []) } : null,
      receiving_progress: receivingProgress,
      item_progress: stockItems?.data || [],
      amendments,
      requirement_attachments: resolvePiRequirementAttachments(requirementAttachments?.data || [], items.data || []),
      applied_amendment_count: appliedCountResult?.count || 0,
      can_request_amendment: writable && hasPermission(account, "orders.edit")
        && order.data.confirmation_method === "DIRECT_PI"
        && Boolean(stock.data) && ["PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHORTAGE"].includes(stock.data!.status)
        && !amendments.some((item) => item.status === "PENDING")
        && (appliedCountResult?.count || 0) < 3,
      stocking_requirements: quote.data?.stocking_requirements || "",
      can_edit_draft: writable && hasPermission(account, "orders.edit") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "DRAFT",
      can_delete_draft: writable &&
        hasPermission(account, "orders.delete_draft") && order.data.confirmation_method === "DIRECT_PI" &&
        order.data.status === "DRAFT" && order.data.confirmed_at === null && !stock.data,
      can_submit: writable && hasPermission(account, "orders.create") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "DRAFT",
      can_recall: writable && hasPermission(account, "orders.edit") && order.data.confirmation_method === "DIRECT_PI" && order.data.status === "WAITING_STOCK" && stock.data?.status === "WAITING",
      can_review_seller_cost: (order.data.prepared_by || order.data.sales_user_id) === account.id
        && ["SALES", "SUPERVISOR", "ORDER_CLERK", "ADMIN"].includes(account.role)
        && hasPermission(account, "orders.cost_review")
        && order.data.confirmation_method === "DIRECT_PI"
        && order.data.status === "SHIPPED" && stock.data?.status === "SHIPPED"
        && Boolean(stockItems?.data?.length)
        && (stockItems?.data || []).every((item) => Number(item.shipped_quantity) === Number(item.quantity)),
      can_edit:
        account.role !== "ORDER_CLERK" && writable &&
        hasPermission(account, "orders.edit") &&
        order.data.confirmation_method !== "DIRECT_PI" &&
        !["READY", "SHIPPED", "CANCELLED"].includes(order.data.status),
      can_cancel:
        writable &&
        hasPermission(account, "orders.cancel") &&
        !(order.data.confirmation_method === "DIRECT_PI" && !["DRAFT", "WAITING_STOCK"].includes(order.data.status)) &&
        !["READY", "SHIPPED", "CANCELLED"].includes(order.data.status),
      can_export: hasPermission(account, "orders.export") && !["DRAFT", "CANCELLED"].includes(order.data.status),
      can_preview: hasPermission(account, "orders.preview"),
      can_view_stock: hasPermission(account, "stock.view"),
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
