import { NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { buildStockWorkbook } from "@/lib/template-xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { documentExportFilename } from "@/lib/export-file-name";
import { stockProgressLabel, summarizeStockProgress } from "@/lib/stock-progress";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";
import { warehousePiAmendment, type PiAmendmentRecord } from "@/lib/orders/pi-amendment-view";
import { loadStockExportRequirementImages } from "@/lib/orders/stock-export-requirement-images";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.export");
    const { id } = await context.params;
    const canViewProcurement = hasPermission(account, "stock.procurement.edit");
    const [{ data: order, error }, { data: items, error: itemError }, { data: shippedEvents, error: eventError }] = await Promise.all([
      supabase.from("stock_orders").select("sales_order_id,sales_user_id,stock_number,quote_number,order_number,warehouse_reference_number,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,created_at,delivery_recipient,delivery_phone,delivery_email,delivery_address,salesperson:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).single(),
      supabase.from("stock_order_items").select("id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,quantity,received_quantity,prepared_quantity,shipped_quantity,preparation_status,warehouse_supplier_code,preparation_requirement,internal_note").eq("stock_order_id", id).is("pi_amendment_cancelled_at", null).order("line_number"),
      supabase.from("stock_order_events").select("created_at").eq("stock_order_id", id).eq("to_status", "SHIPPED").order("created_at", { ascending: false }).limit(1),
    ]);
    if (error) throw error;
    if (itemError) throw itemError;
    if (eventError) throw eventError;
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
    const admin = createAdminClient();
    const { data: piNote, error: piNoteError } = await admin.from("sales_orders")
      .select("confirmation_note,forwarder_address,forwarder_recipient,forwarder_phone")
      .eq("id", order.sales_order_id).single();
    if (piNoteError) throw piNoteError;
    const amendmentResult = await createAdminClient().from("pi_amendment_requests")
      .select("*").eq("stock_order_id", id).in("status", ["PENDING", "APPLIED"])
      .order("created_at", { ascending: true });
    if (amendmentResult.error) throw amendmentResult.error;
    const amendmentNotes = (amendmentResult.data || []).flatMap((raw) => {
      const amendment = warehousePiAmendment(raw as PiAmendmentRecord);
      const prefix = amendment.status === "PENDING" ? "待仓库确认、尚未生效" : `已生效 v${amendment.applied_revision}`;
      return amendment.changes.map((change) => {
        const before = change.before;
        const after = change.after;
        const product = (line: Record<string, unknown> | null) => line
          ? [line.item_name, line.brand, line.model, line.quality].filter(Boolean).join("/") : "—";
        return `${prefix}：${change.kind}${change.line_number ? `第${change.line_number}项` : "产品"} ${product(before)} ${before ? `${before.quantity}件` : ""} → ${product(after)} ${after ? `${after.quantity}件` : ""}${change.sales_price_changed || change.seller_cost_changed ? "（销售价格/预估成本有调整）" : ""}`;
      });
    });
    const salesOwner = !order.salesperson && order.sales_user_id ? await createAdminClient().from("users")
      .select("name,email").eq("id", order.sales_user_id).maybeSingle() : null;
    if (salesOwner?.error) throw salesOwner.error;
    const requirementAttachmentsByOrder = await loadStockExportRequirementImages(admin, [order.sales_order_id], request.url);
    const requirementAttachments = requirementAttachmentsByOrder.get(order.sales_order_id) || [];
    const buffer = await buildStockWorkbook({ ...order, customer_name: customerNames.get(order.sales_order_id) || null,
      salesperson: order.salesperson || salesOwner?.data || null,
      order_change_note: [piNote.confirmation_note, ...amendmentNotes].filter(Boolean).join("\n"),
      forwarder_address: piNote.forwarder_address,
      forwarder_recipient: piNote.forwarder_recipient,
      forwarder_phone: piNote.forwarder_phone,
      shipped_at: shippedEvents?.[0]?.created_at || null,
      status_label: stockProgressLabel(summarizeStockProgress(order.status, items || [])) } as never, exportItems as never, { includeProcurement: canViewProcurement, requirementAttachments });
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
