import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { sqlErrorMessage } from "@/lib/sales-flow";

async function warehouseAccess() {
  const context = await requirePermission("stock.view");
  if (context.account.role !== "WAREHOUSE"
    || !hasPermission(context.account, "stock.update")
    || !hasPermission(context.account, "stock.procurement.edit")
    || !hasPermission(context.account, "supplier.documents.view")
    || !hasPermission(context.account, "supplier.documents.manage")) throw new Error("FORBIDDEN");
  return context;
}

export async function GET(request: NextRequest) {
  try {
    await warehouseAccess();
    const page = Number(request.nextUrl.searchParams.get("page") || "1");
    if (!Number.isSafeInteger(page) || page < 1 || page > 2000) throw new Error("分页参数无效");
    const admin = createAdminClient();
    const baselines = await admin.from("supplier_receipt_legacy_baselines")
      .select("stock_order_item_id,quantity,captured_at", { count: "exact" })
      .order("captured_at").order("stock_order_item_id")
      .range((page - 1) * 50, page * 50 - 1);
    if (baselines.error) throw baselines.error;
    const itemIds = (baselines.data || []).map((row) => row.stock_order_item_id);
    if (!itemIds.length) return NextResponse.json({ data: [], count: baselines.count || 0, page });
    const items = await admin.from("stock_order_items")
      .select("id,stock_order_id,line_number,item_name,brand,model,quality,quantity,received_quantity,shipped_quantity")
      .in("id", itemIds);
    if (items.error) throw items.error;
    const orders = await admin.from("stock_orders")
      .select("id,order_number,warehouse_reference_number,status,updated_at")
      .in("id", [...new Set((items.data || []).map((item) => item.stock_order_id))]);
    if (orders.error) throw orders.error;
    const byItem = new Map((items.data || []).map((item) => [item.id, item]));
    const byOrder = new Map((orders.data || []).map((order) => [order.id, order]));
    return NextResponse.json({ data: (baselines.data || []).flatMap((baseline) => {
      const item = byItem.get(baseline.stock_order_item_id);
      const order = item && byOrder.get(item.stock_order_id);
      return item && order ? [{ ...baseline, item, order }] : [];
    }), count: baselines.count || 0, page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = sqlErrorMessage(error, "历史来源待补清单加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await warehouseAccess();
    const body = await request.json();
    const id = String(body.stock_order_item_id || "");
    const supplierId = String(body.supplier_id || "");
    const noteNumber = String(body.note_number || "").trim();
    const date = String(body.document_date || "");
    const quantity = Number(body.quantity);
    const unitPrice = String(body.purchase_unit_price_cny ?? "");
    const version = String(body.expected_stock_updated_at || "");
    if (![id, supplierId].every((value) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value))
      || !noteNumber || noteNumber.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isSafeInteger(quantity) || quantity <= 0
      || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(unitPrice)
      || !Number.isFinite(Date.parse(version))) throw new Error("请填写真实送货单号、日期、供应商、数量及采购价");
    const result = await supabase.rpc("link_legacy_supplier_receipt_source", {
      p_stock_order_item_id: id, p_supplier_id: supplierId,
      p_note_number: noteNumber, p_document_date: date,
      p_quantity: quantity, p_purchase_unit_price_cny: Number(unitPrice),
      p_expected_stock_updated_at: version,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ data: result.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = sqlErrorMessage(error, "补全历史送货单来源失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
