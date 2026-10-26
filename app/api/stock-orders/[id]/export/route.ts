import { NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { buildStockWorkbook } from "@/lib/template-xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { documentExportFilename } from "@/lib/export-file-name";
import { stockProgressLabel, summarizeStockProgress } from "@/lib/stock-progress";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.export");
    const { id } = await context.params;
    const canViewProcurement = account.role === "WAREHOUSE"
      && hasPermission(account, "stock.procurement.edit");
    const [{ data: order, error }, { data: items, error: itemError }, { data: shippedEvents, error: eventError }] = await Promise.all([
      supabase.from("stock_orders").select("sales_order_id,sales_user_id,stock_number,quote_number,order_number,warehouse_reference_number,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,created_at,archived_at,delivery_recipient,delivery_phone,delivery_email,delivery_address,salesperson:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).single(),
      supabase.from("stock_order_items").select("id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,quantity,received_quantity,prepared_quantity,shipped_quantity,preparation_status,warehouse_supplier_code,preparation_requirement,internal_note").eq("stock_order_id", id).order("line_number"),
      supabase.from("stock_order_events").select("created_at").eq("stock_order_id", id).eq("to_status", "SHIPPED").order("created_at", { ascending: false }).limit(1),
    ]);
    if (error) throw error;
    if (itemError) throw itemError;
    if (eventError) throw eventError;
    if(order.archived_at)throw new Error("已归档备货单不能导出，请先由系统管理员恢复");
    if(["DRAFT", "CANCELLED"].includes(order.status))throw new Error("草稿或已取消的备货单不能作为正式单据导出");
    let exportItems = items || [];
    if (canViewProcurement) {
      const procurement = await createAdminClient().from("stock_order_items")
        .select("id,procurement_cost,procurement_cost_confirmed,warehouse_note")
        .eq("stock_order_id", id);
      if (procurement.error) throw procurement.error;
      const procurementById = new Map((procurement.data || []).map((item) => [item.id, item]));
      exportItems = exportItems.map((item) => ({ ...item, ...procurementById.get(item.id) }));
    }
    const customerNames = await loadOrderCustomerNames([order.sales_order_id], true);
    const piNote = await createAdminClient().from("sales_orders").select("confirmation_note,forwarder_address,forwarder_recipient,forwarder_phone").eq("id", order.sales_order_id).single();
    if (piNote.error) throw piNote.error;
    const salesOwner = !order.salesperson && order.sales_user_id ? await createAdminClient().from("users")
      .select("name,email").eq("id", order.sales_user_id).maybeSingle() : null;
    if (salesOwner?.error) throw salesOwner.error;
    const buffer = await buildStockWorkbook({ ...order, customer_name: customerNames.get(order.sales_order_id) || null,
      salesperson: order.salesperson || salesOwner?.data || null,
      order_change_note: piNote.data.confirmation_note,
      forwarder_address: piNote.data.forwarder_address,
      forwarder_recipient: piNote.data.forwarder_recipient,
      forwarder_phone: piNote.data.forwarder_phone,
      shipped_at: shippedEvents?.[0]?.created_at || null,
      status_label: stockProgressLabel(summarizeStockProgress(order.status, items || [])) } as never, exportItems as never, { includeProcurement: canViewProcurement });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(documentExportFilename(order.stock_number, "备货单", "xlsx"))}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单导出失败");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
