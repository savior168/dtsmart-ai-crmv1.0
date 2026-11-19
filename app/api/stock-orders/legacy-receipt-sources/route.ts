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

async function readAccess() {
  const context = await requirePermission("stock.view");
  if (!["WAREHOUSE", "ADMIN"].includes(context.account.role)
    || !hasPermission(context.account, "supplier.documents.view")) throw new Error("FORBIDDEN");
  return context;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await readAccess();
    const page = Number(request.nextUrl.searchParams.get("page") || "1");
    if (!Number.isSafeInteger(page) || page < 1 || page > 2000) throw new Error("分页参数无效");
    const orderId = request.nextUrl.searchParams.get("order_id") || "";
    if (orderId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(orderId)) throw new Error("备货单编号无效");
    const admin = createAdminClient();
    const baselines: Array<{ stock_order_item_id: string; quantity: number; captured_at: string }> = [];
    for (let offset = 0; ; offset += 1000) {
      const batch = await admin.from("supplier_receipt_legacy_baselines")
        .select("stock_order_item_id,quantity,captured_at")
        .order("captured_at").order("stock_order_item_id").range(offset, offset + 999);
      if (batch.error) throw batch.error;
      baselines.push(...(batch.data || []));
      if ((batch.data || []).length < 1000) break;
    }
    if (!baselines.length) return NextResponse.json({ data: [], count: 0, page });
    const itemRows: Array<{ id: string; stock_order_id: string; line_number: number; item_name: string | null; brand: string | null; model: string | null; quality: string | null; quantity: number; received_quantity: number; shipped_quantity: number; warehouse_supplier_code: string | null; procurement_cost: number; procurement_cost_confirmed: boolean }> = [];
    for (let offset = 0; offset < baselines.length; offset += 200) {
      const items = await admin.from("stock_order_items")
        .select("id,stock_order_id,line_number,item_name,brand,model,quality,quantity,received_quantity,shipped_quantity,warehouse_supplier_code,procurement_cost,procurement_cost_confirmed")
        .in("id", baselines.slice(offset, offset + 200).map((row) => row.stock_order_item_id));
      if (items.error) throw items.error;
      itemRows.push(...(items.data || []));
    }
    const byItem = new Map(itemRows.map((item) => [item.id, item]));
    const orderIds = [...new Set(baselines.map((row) => byItem.get(row.stock_order_item_id)?.stock_order_id).filter((id): id is string => Boolean(id)))];
    const authorizedOrders: Array<{ id: string; order_number: string; stock_number: string; warehouse_reference_number: string | null; status: string; updated_at: string }> = [];
    for (let offset = 0; offset < orderIds.length; offset += 200) {
      const result = await supabase.from("stock_orders")
        .select("id,order_number,stock_number,warehouse_reference_number,status,updated_at")
        .in("id", orderIds.slice(offset, offset + 200));
      if (result.error) throw result.error;
      authorizedOrders.push(...(result.data || []));
    }
    const byOrder = new Map(authorizedOrders.map((order) => [order.id, order]));
    const scopedOrderIds = orderId ? orderIds.filter((id) => id === orderId && byOrder.has(id)) : orderIds.filter((id) => byOrder.has(id));
    const visibleOrderIds = scopedOrderIds.slice((page - 1) * 50, page * 50);
    if (!visibleOrderIds.length) return NextResponse.json({ data: [], count: scopedOrderIds.length, page });
    const visible = new Set(visibleOrderIds);
    return NextResponse.json({ data: baselines.flatMap((baseline) => {
      const item = byItem.get(baseline.stock_order_item_id);
      const order = item && byOrder.get(item.stock_order_id);
      return item && order && visible.has(order.id) ? [{ ...baseline, item, order }] : [];
    }), count: scopedOrderIds.length, item_count: baselines.length, page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = sqlErrorMessage(error, "历史来源待补清单加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await warehouseAccess();
    const body = await request.json();
    if ("lines" in body) {
      const supplierId = String(body.supplier_id || "");
      const noteNumber = String(body.note_number || "").trim();
      const date = String(body.document_date || "");
      const version = String(body.expected_stock_updated_at || "");
      const lines = body.lines;
      const validId = (value: unknown) => typeof value === "string"
        && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
      if (!validId(supplierId) || !noteNumber || noteNumber.length > 100
        || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(version))
        || !Array.isArray(lines) || lines.length < 1 || lines.length > 50
        || lines.some((line) => !line || !validId(line.stock_order_item_id)
          || !Number.isSafeInteger(line.quantity) || line.quantity <= 0
          || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(line.purchase_unit_price_cny)))) {
        throw new Error("请核对同一张纸单的供应商、单号、日期，以及每项数量和采购价");
      }
      const result = await supabase.rpc("link_legacy_supplier_receipt_sources_batch", {
        p_supplier_id: supplierId, p_note_number: noteNumber, p_document_date: date,
        p_expected_stock_updated_at: version, p_lines: lines,
      });
      if (result.error) throw result.error;
      return NextResponse.json({ data: result.data }, { headers: { "Cache-Control": "private, no-store" } });
    }
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
