import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { buildQuoteWorkbook } from "@/lib/template-xlsx";
import { buildDirectPiWorkbook } from "@/lib/direct-pi-export";
import { documentExportFilename } from "@/lib/export-file-name";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, account } = await requirePermission("orders.export");
    const { id } = await params;
    const [order, items] = await Promise.all([
      supabase
        .from("sales_orders")
        .select(
          "id,customer_id,prepared_by,order_number,warehouse_reference_number,status,currency,show_dual_currency_prices,delivery_date,payment_method,customer_short_name,destination_country,shipping_cost,subtotal,total_amount,created_at,confirmed_at,confirmation_method,pi_valid_until,seller_company_name,seller_company_address,seller_website,seller_contact_name,seller_contact_phone,seller_contact_email,delivery_recipient,delivery_phone,delivery_email,delivery_address,fx_rate_cny_to_payment,subtotal_cny,shipping_cny,total_cny,last_balance_cny,last_balance_amount,discount_cny,discount_amount,other_charge_cny,other_charge_amount,paypal_fee_percent,paypal_fee_cny,paypal_fee_amount,payment_account_snapshot,owner:users!sales_orders_sales_user_id_fkey(name,email),customer:customers(company_name,contact_name,tax_number,phone)",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("sales_order_items")
        .select(
          "line_number,item_name,brand,model,quality,description,quantity,unit_price,unit_price_cny",
        )
        .eq("sales_order_id", id)
        .order("line_number"),
    ]);
    if (order.error) throw order.error;
    if (items.error) throw items.error;
    if (account.role === "ORDER_CLERK" && order.data.confirmation_method !== "DIRECT_PI") throw new Error("FORBIDDEN");
    const customerNames = await loadOrderCustomerNames([id]);
    const clerkCustomer = account.role === "ORDER_CLERK" ? await createAdminClient().from("customers")
      .select("company_name,contact_name,tax_number,phone").eq("id", order.data.customer_id).maybeSingle() : null;
    if (clerkCustomer?.error) throw clerkCustomer.error;
    const documentOrder = { ...order.data, customer: {
      ...(account.role === "ORDER_CLERK" ? clerkCustomer?.data : order.data.customer),
      contact_name: customerNames.get(id) || null,
    } };
    if (["DRAFT", "CANCELLED"].includes(order.data.status)) throw new Error("PI草稿或已取消订单不能作为正式PI导出");
    const businessNumber = order.data.confirmation_method === "DIRECT_PI"
      ? order.data.warehouse_reference_number || order.data.order_number
      : order.data.order_number;
    const workbook = order.data.confirmation_method === "DIRECT_PI" ? buildDirectPiWorkbook(
      { ...documentOrder, order_number: businessNumber } as never, (items.data || []) as never,
    ) : await buildQuoteWorkbook(
      {
        ...documentOrder,
        quote_number: businessNumber,
        created_at: order.data.confirmed_at,
      } as never,
      (items.data || []).map((item) => ({
        ...item,
        description_zh: null,
        procurement_cost: 0,
        preparation_requirement: null,
      })) as never,
    );
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(documentExportFilename(order.data.order_number, "PI订单", "xlsx"))}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "订单导出失败");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
