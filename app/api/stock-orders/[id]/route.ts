import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";
import { warehousePiAmendment, type PiAmendmentRecord } from "@/lib/orders/pi-amendment-view";
import { resolvePiRequirementAttachments } from "@/lib/orders/pi-requirement-attachment-view";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    const { id } = await context.params;
    const canViewProcurement = ["WAREHOUSE", "ADMIN"].includes(account.role)
      && hasPermission(account, "stock.procurement.edit");
    const [{ data: order, error }, { data: items, error: itemError }, { data: events, count: eventCount, error: eventError }] = await Promise.all([
      supabase.from("stock_orders").select("id,quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,customer_short_name,destination_country,delivery_recipient,delivery_address,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at,sales:users!stock_orders_sales_user_id_fkey(name,email)").eq("id", id).maybeSingle(),
      supabase.from("stock_order_items").select("id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,quantity,received_quantity,prepared_quantity,shipped_quantity,warehouse_supplier_code,preparation_requirement,internal_note,preparation_status,pi_amendment_cancelled_at").eq("stock_order_id", id).order("line_number"),
      supabase.from("stock_order_events").select("id,from_status,to_status,note,created_by,created_at", { count: "exact" }).eq("stock_order_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 9),
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
    const amendmentResult = await createAdminClient().from("pi_amendment_requests")
      .select("id,status,base_revision,applied_revision,reason,decision_note,created_at,decided_at,before_items,proposed_items")
      .eq("stock_order_id", id).order("created_at", { ascending: false }).limit(20);
    if (amendmentResult.error) throw amendmentResult.error;
    const requirementAttachments = await createAdminClient().from("attachments")
      .select("id,filename,mime_type,size_bytes,created_at,pi_line_number_snapshot,pi_product_label_snapshot,sales_order_item_id")
      .eq("sales_order_id", order.sales_order_id)
      .in("kind", ["PI_ORDER_REQUIREMENT", "PI_LINE_REQUIREMENT"]).order("created_at");
    if (requirementAttachments.error) throw requirementAttachments.error;
    const activePiItems = await createAdminClient().from("sales_order_items")
      .select("id,line_number,item_name,brand,model,quality")
      .eq("sales_order_id", order.sales_order_id);
    if (activePiItems.error) throw activePiItems.error;
    const amendments = (amendmentResult.data || []).map((item) => warehousePiAmendment(item as PiAmendmentRecord));
    let visibleItems = (items || []).filter((item) => !item.pi_amendment_cancelled_at);
    if (canViewProcurement) {
      // Sensitive purchase fields are read with the server-only client, after
      // the caller's RLS-scoped stock-order lookup has established access.
      const procurement = await createAdminClient().from("stock_order_items")
        .select("id,procurement_cost,procurement_cost_confirmed,warehouse_note")
        .eq("stock_order_id", id);
      if (procurement.error) throw procurement.error;
      const procurementById = new Map((procurement.data || []).map((item) => [item.id, item]));
      visibleItems = visibleItems.map((item) => ({ ...item, ...procurementById.get(item.id) }));
    }
    // The RLS-scoped stock row establishes access; resolve only its linked PI snapshot.
    const piDelivery = await createAdminClient().from("sales_orders")
      .select("customer_name_snapshot,forwarder_address,forwarder_recipient,forwarder_phone,prepared_by,created_at").eq("id", order.sales_order_id).maybeSingle();
    if (piDelivery.error) throw piDelivery.error;
    const customerNames = await loadOrderCustomerNames([order.sales_order_id]);
    // The visible stock order establishes access before resolving its sales owner.
    // Warehouse RLS intentionally does not expose arbitrary users.
    const salesOwner = order.sales_user_id && !order.sales
      ? await createAdminClient().from("users").select("name,email").eq("id", order.sales_user_id).maybeSingle()
      : null;
    if (salesOwner?.error) throw salesOwner.error;
    const piPreparer = piDelivery.data?.prepared_by ? await createAdminClient().from("users")
      .select("name,email").eq("id", piDelivery.data.prepared_by).maybeSingle() : null;
    if (piPreparer?.error) throw piPreparer.error;
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
    let shipments = null;
    let receipts: Array<{ id: string; stock_order_item_id: string; quantity: number; purchase_unit_price_cny: number; note_number: string; document_date: string; supplier_code: string; correction_of: string | null; remaining_quantity: number }> = [];
    let shipmentFeatureReady = false;
    if (["WAREHOUSE", "ADMIN"].includes(account.role)) {
      const [expenseResult, shipmentResult] = await Promise.all([
        supabase.from("stock_order_expenses")
          .select("packaging_cost_cny,procurement_expenses_cny,shipping_expenses_cny,updated_at")
          .eq("stock_order_id", id).maybeSingle(),
        supabase.from("stock_order_shipments")
          .select("id,item_ids,packaging_cost_cny,procurement_expenses_cny,shipping_expenses_cny,handoff_note,created_by,created_at")
          .eq("stock_order_id", id).order("created_at", { ascending: false }),
      ]);
      if (expenseResult.error) throw expenseResult.error;
      if (shipmentResult.error && !["42P01", "PGRST205"].includes(shipmentResult.error.code || "")) throw shipmentResult.error;
      expenses = expenseResult.data;
      shipments = shipmentResult.data || [];
      shipmentFeatureReady = !shipmentResult.error;
    }
    if (canViewProcurement && visibleItems.length) {
      const admin = createAdminClient();
      const allocations = await admin.from("supplier_receipt_allocations")
        .select("id,stock_order_item_id,delivery_note_id,quantity,purchase_unit_price_cny,correction_of")
        .in("stock_order_item_id", visibleItems.map((item) => item.id))
        .order("recorded_at", { ascending: false });
      if (allocations.error && !["42P01", "PGRST205"].includes(allocations.error.code || "")) throw allocations.error;
      const noteIds = [...new Set((allocations.data || []).map((row) => row.delivery_note_id))];
      const notes = noteIds.length ? await admin.from("supplier_delivery_notes")
        .select("id,supplier_id,note_number,document_date").in("id", noteIds) : { data: [], error: null };
      if (notes.error) throw notes.error;
      const supplierIds = [...new Set((notes.data || []).map((row) => row.supplier_id))];
      const suppliers = supplierIds.length ? await admin.from("suppliers")
        .select("id,system_code").in("id", supplierIds) : { data: [], error: null };
      if (suppliers.error) throw suppliers.error;
      const notesById = new Map((notes.data || []).map((row) => [row.id, row]));
      const codesById = new Map((suppliers.data || []).map((row) => [row.id, row.system_code]));
      const reversedById = new Map<string, number>();
      for (const row of allocations.data || []) if (row.correction_of) {
        reversedById.set(row.correction_of, (reversedById.get(row.correction_of) || 0) - row.quantity);
      }
      receipts = (allocations.data || []).map((row) => {
        const note = notesById.get(row.delivery_note_id);
        return { id: row.id, stock_order_item_id: row.stock_order_item_id,
          quantity: row.quantity, purchase_unit_price_cny: row.purchase_unit_price_cny,
          correction_of: row.correction_of,
          remaining_quantity: row.correction_of ? 0 : row.quantity - (reversedById.get(row.id) || 0),
          note_number: note?.note_number || "", document_date: note?.document_date || "",
          supplier_code: note ? codesById.get(note.supplier_id) || "" : "" };
      });
    }
    const warehouseEditor = ["WAREHOUSE", "ADMIN"].includes(account.role);
    const recalledPi = order.status === "DRAFT" && Boolean(order.warehouse_reference_number);
    const transitions:Record<string,string[]>={WAITING:["PREPARING","SHORTAGE","CANCELLED"],PREPARING:["RECEIVED","SHORTAGE","CANCELLED"],RECEIVED:["SORTING","SHORTAGE","CANCELLED"],SORTING:["READY_TO_SHIP","SHORTAGE","CANCELLED"],READY_TO_SHIP:["SHIPPED","CANCELLED"],SHORTAGE:["PREPARING","CANCELLED"],DRAFT:[],SHIPPED:[],READY:[],CANCELLED:[]};
    return NextResponse.json({ order: { ...order, customer_name_snapshot: piDelivery.data?.customer_name_snapshot || null, forwarder_address: piDelivery.data?.forwarder_address || null, forwarder_recipient: piDelivery.data?.forwarder_recipient || null, forwarder_phone: piDelivery.data?.forwarder_phone || null, pi_created_at: piDelivery.data?.created_at || null, pi_preparer: piPreparer?.data || null, customer_name: customerNames.get(order.sales_order_id) || null, sales: order.sales || salesOwner?.data || null }, items: visibleItems, cancelled_items: (items || []).filter((item) => Boolean(item.pi_amendment_cancelled_at)), requirement_attachments: resolvePiRequirementAttachments(requirementAttachments.data || [], activePiItems.data || []), receipts, amendments, events: scopedEvents, event_count: eventCount || 0, ...(warehouseEditor ? { expenses, shipments, shipment_feature_ready: shipmentFeatureReady } : {}), can_export: hasPermission(account, "stock.export") && !["DRAFT", "CANCELLED"].includes(order.status), can_preview: hasPermission(account, "stock.preview"), can_view_pi: account.role !== "WAREHOUSE" && hasPermission(account,"orders.view"), recalled_pi: recalledPi, can_prepare: warehouseEditor && hasPermission(account,"stock.prepare") && order.status==="DRAFT" && !recalledPi, can_submit: warehouseEditor && hasPermission(account,"stock.submit") && order.status==="DRAFT" && !recalledPi, can_update: warehouseEditor && hasPermission(account, "stock.update") && order.status!=="DRAFT", can_edit_receiving: warehouseEditor && hasPermission(account,"stock.update") && ["WAITING","PREPARING","RECEIVED","SORTING","SHORTAGE"].includes(order.status), can_view_procurement: canViewProcurement, can_edit_procurement: canViewProcurement && ["WAITING","PREPARING","RECEIVED","SORTING","SHORTAGE"].includes(order.status), can_manage_suppliers: hasPermission(account, "suppliers.manage"), allowed_statuses:transitions[order.status]||[] });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单详情加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
