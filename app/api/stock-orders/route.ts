import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requestedPiCreatorId, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { STOCK_STATUS_LABELS } from "@/lib/types";
import { COUNTRY_OPTIONS, countryFilterRawValues } from "@/lib/countries";
import { buildStockWorkbook } from "@/lib/template-xlsx";
import { buildWorkbookZip, mapExportBatches, streamZipBytes } from "@/lib/batch-xlsx-zip";
import { STOCK_EXECUTING_STATUSES, stockProgressLabel, summarizeStockProgress } from "@/lib/stock-progress";
import { loadStockProgressItems } from "@/lib/stock-progress-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";
import { documentSearchFilter, matchingCustomerIds, matchingOrderIds, normalizeDocumentSearch } from "@/lib/document-search";
import { batchExportFilename, documentExportFilename } from "@/lib/export-file-name";

const SORT_COLUMNS = {
  stock_number: "stock_number",
  order_number: "warehouse_reference_number",
  customer_name: "customer_short_name",
  status: "status",
  created_at: "created_at",
  updated_at: "updated_at",
} as const;

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    const params = request.nextUrl.searchParams;
    const exporting = params.get("export") === "1";
    const selectedIds = params.getAll("id");
    if (selectedIds.length && (!exporting || selectedIds.length > 50 ||
      new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
      throw new Error("所选备货单无效；每次最多导出50张");
    }
    if (exporting && !hasPermission(account, "stock.export")) throw new Error("FORBIDDEN");
    if (params.get("view") === "dashboard") {
      const dashboard = await supabase.rpc("stock_order_dashboard");
      if (dashboard.error) throw dashboard.error;
      const result = dashboard.data || { counts: {}, recent: [] };
      const recent = Array.isArray(result.recent) ? result.recent : [];
      const itemsByStockId = await loadStockProgressItems(supabase, recent.map((order: { id: string }) => order.id));
      const customerNames = await loadOrderCustomerNames(recent.map((order: { sales_order_id: string }) => order.sales_order_id));
      return NextResponse.json({ ...result, recent: recent.map((order: { id: string; status: string; sales_order_id: string }) => ({
        ...order, customer_name: customerNames.get(order.sales_order_id) || null,
        progress: summarizeStockProgress(order.status, itemsByStockId.get(order.id) || []),
      })) }, {
        headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
      });
    }
    const ownerId = account.role === "WAREHOUSE" ? null : await requestedOwnerId(request, account, "stock.data_all");
    const creatorId = await requestedPiCreatorId(request, account, "stock.data_all");
    const page = Math.max(1, Math.floor(Number(params.get("page") || 1) || 1));
    const requestedPageSize = Number(params.get("page_size") || 20);
    const pageSize = [10, 20, 50, 100, 300, 500].includes(requestedPageSize) ? requestedPageSize : 20;
    const status = params.get("status")?.trim() || "";
    const country = params.get("country")?.trim().toUpperCase() || "";
    const sortBy = params.get("sort_by") || "updated_at";
    const sortDir = params.get("sort_dir") || "desc";
    const dateFrom = params.get("date_from")?.trim() || "";
    const dateTo = params.get("date_to")?.trim() || "";
    const q = normalizeDocumentSearch(params.get("q"));
    if (status && !["ACTIVE", "OTHER"].includes(status) && !(status in STOCK_STATUS_LABELS)) throw new Error("备货状态无效");
    if (country && !COUNTRY_OPTIONS.some((option) => option.code === country)) throw new Error("目的国家无效");
    if (!(sortBy in SORT_COLUMNS) || !["asc", "desc"].includes(sortDir)) throw new Error("排序参数无效");
    if ([dateFrom, dateTo].some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error("日期格式无效");
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
    const matchingCustomerOrderIds = await matchingOrderIds(await matchingCustomerIds(q));
    const from = (page - 1) * pageSize;
    const makeQuery = (rangeStart: number, rangeEnd: number) => {
      let query = supabase.from("stock_orders_with_pi_preparer")
        .select("id,quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,pi_prepared_by,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at", { count: "exact" })
        .order(SORT_COLUMNS[sortBy as keyof typeof SORT_COLUMNS], { ascending: sortDir === "asc" })
        .order("id", { ascending: true }).range(rangeStart, rangeEnd);
      if (ownerId) query = query.eq("sales_user_id", ownerId);
      if (creatorId) query = query.eq("pi_prepared_by", creatorId);
      if (selectedIds.length) query = query.in("id", selectedIds);
      if (status === "ACTIVE") query = query.in("status", [...STOCK_EXECUTING_STATUSES]);
      else if (status === "OTHER") query = query.in("status", ["DRAFT", "CANCELLED", "READY"]);
      else if (status) query = query.eq("status", status);
      if (country) query = query.in("destination_country", countryFilterRawValues([country]));
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+08:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999+08:00`);
      if (q) query = query.or(documentSearchFilter(q,
        ["stock_number", "warehouse_reference_number", "order_number", "customer_short_name", "delivery_phone", "delivery_email"],
        "sales_order_id", matchingCustomerOrderIds));
      return query;
    };
    const { data, error, count } = await makeQuery(exporting ? 0 : from, exporting ? 499 : from + pageSize - 1);
    if (error) throw error;
    if (exporting) {
      if (!selectedIds.length) throw new Error("请先勾选要导出的备货单");
      if (!count) throw new Error("当前筛选条件下没有可导出的备货单");
      if (count !== selectedIds.length) throw new Error("部分所选备货单已不在当前筛选结果或无权查看，请刷新后重新勾选");
      if (count > 65535) throw new Error("筛选结果超过ZIP格式的单包文件上限，请缩小筛选范围");
      const rows = [...(data || [])];
      for (let offset = rows.length; offset < count; offset += 500) {
        const next = await makeQuery(offset, Math.min(offset + 499, count - 1));
        if (next.error) throw next.error;
        rows.push(...(next.data || []));
      }
      if (rows.length !== count) throw new Error("筛选结果读取不完整，请重试");
      if (new Set(rows.map((row) => row.id)).size !== count) throw new Error("导出期间备货单列表发生变更，请刷新后重试");
      if (rows.some((row) => ["DRAFT", "CANCELLED"].includes(row.status))) {
        throw new Error("筛选结果包含待完善、已撤回或已取消备货单，请先筛选可导出的状态");
      }
      const ids = rows.map((row) => row.id);
      const idBatches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, (index + 1) * 50));
      const batches = await mapExportBatches(idBatches, 4, async (batchIds) => {
        const [details, firstItems, firstShipped] = await Promise.all([
          supabase.from("stock_orders").select(
            "id,sales_order_id,sales_user_id,stock_number,quote_number,order_number,warehouse_reference_number,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,created_at,delivery_recipient,delivery_phone,delivery_email,delivery_address,salesperson:users!stock_orders_sales_user_id_fkey(name,email)",
          ).in("id", batchIds),
          supabase.from("stock_order_items").select(
            "stock_order_id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,procurement_cost,procurement_cost_confirmed,quantity,received_quantity,prepared_quantity,shipped_quantity,preparation_status,warehouse_supplier_code,preparation_requirement,internal_note",
          ).in("stock_order_id", batchIds).order("stock_order_id").order("line_number").range(0, 999),
          supabase.from("stock_order_events").select("stock_order_id,created_at").in("stock_order_id", batchIds).eq("to_status", "SHIPPED").order("created_at", { ascending: false }).order("id").range(0, 999),
        ]);
        if (details.error) throw details.error;
        if (firstItems.error) throw firstItems.error;
        if (firstShipped.error) throw firstShipped.error;
        const items = [...(firstItems.data || [])];
        for (let offset = items.length; offset > 0 && offset % 1000 === 0; offset += 1000) {
          const next = await supabase.from("stock_order_items").select(
            "stock_order_id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,procurement_cost,procurement_cost_confirmed,quantity,received_quantity,prepared_quantity,shipped_quantity,preparation_status,warehouse_supplier_code,preparation_requirement,internal_note",
          ).in("stock_order_id", batchIds).order("stock_order_id").order("line_number").range(offset, offset + 999);
          if (next.error) throw next.error;
          items.push(...(next.data || []));
          if ((next.data || []).length < 1000) break;
        }
        const shipped = [...(firstShipped.data || [])];
        for (let offset = shipped.length; offset > 0 && offset % 1000 === 0; offset += 1000) {
          const next = await supabase.from("stock_order_events").select("stock_order_id,created_at")
            .in("stock_order_id", batchIds).eq("to_status", "SHIPPED")
            .order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
          if (next.error) throw next.error;
          shipped.push(...(next.data || []));
          if ((next.data || []).length < 1000) break;
        }
        const piNotes = await createAdminClient().from("sales_orders")
          .select("id,confirmation_note,forwarder_address,forwarder_recipient,forwarder_phone").in("id", (details.data || []).map((item) => item.sales_order_id));
        if (piNotes.error) throw piNotes.error;
        const ownerIds = [...new Set((details.data || []).map((item) => item.sales_user_id).filter(Boolean))];
        const salesOwners = ownerIds.length ? await createAdminClient().from("users")
          .select("id,name,email").in("id", ownerIds) : { data: [], error: null };
        if (salesOwners.error) throw salesOwners.error;
        return { details: details.data || [], items, shipped, piNotes: piNotes.data || [], salesOwners: salesOwners.data || [] };
      });
      const details = batches.flatMap((batch) => batch.details);
      if (details.length !== ids.length) throw new Error("部分备货单已无权查看，请刷新筛选结果");
      const piNoteById = new Map(batches.flatMap((batch) => batch.piNotes).map((item) => [item.id, item]));
      const salesOwnerById = new Map(batches.flatMap((batch) => batch.salesOwners).map((item) => [item.id, item]));
      const detailById = new Map(details.map((item) => [item.id, item]));
      const itemsByStockId = new Map<string, typeof batches[number]["items"]>();
      for (const item of batches.flatMap((batch) => batch.items)) {
        const list = itemsByStockId.get(item.stock_order_id) || [];
        list.push(item);
        itemsByStockId.set(item.stock_order_id, list);
      }
      const shippedByStockId = new Map<string, string>();
      for (const event of batches.flatMap((batch) => batch.shipped)) {
        if (!shippedByStockId.has(event.stock_order_id)) shippedByStockId.set(event.stock_order_id, event.created_at);
      }
      const exportedAt = new Date();
      const customerNames = await loadOrderCustomerNames(rows.map((row) => row.sales_order_id));
      const files: Array<{ name: string; data: ArrayBuffer | Uint8Array }> = [];
      for (const row of rows) {
        const detail = detailById.get(row.id);
        const items = itemsByStockId.get(row.id) || [];
        if (!detail || !items.length || detail.status !== row.status) throw new Error("备货数据已更新，请刷新筛选结果");
        files.push({ name: documentExportFilename(row.stock_number, "备货单", "xlsx", exportedAt),
          data: await buildStockWorkbook({ ...detail, customer_name: customerNames.get(detail.sales_order_id) || null,
            salesperson: detail.salesperson || salesOwnerById.get(detail.sales_user_id) || null,
            order_change_note: piNoteById.get(detail.sales_order_id)?.confirmation_note || null,
            forwarder_address: piNoteById.get(detail.sales_order_id)?.forwarder_address || null,
            forwarder_recipient: piNoteById.get(detail.sales_order_id)?.forwarder_recipient || null,
            forwarder_phone: piNoteById.get(detail.sales_order_id)?.forwarder_phone || null,
            shipped_at: shippedByStockId.get(row.id) || null,
            status_label: stockProgressLabel(summarizeStockProgress(detail.status, items)) } as never, items as never) });
      }
      const zip = buildWorkbookZip(files);
      return new NextResponse(streamZipBytes(zip), { headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(batchExportFilename("备货单", "zip", exportedAt))}`,
        "Cache-Control": "private, no-store",
      } });
    }
    const visibleIds = (data || []).map((item) => item.id);
    const itemsByStockId = await loadStockProgressItems(supabase, visibleIds);
    const clerkOwnerIds = [...new Set((data || []).map((item) => item.sales_user_id).filter(Boolean))];
    const preparerIds = [...new Set((data || []).map((item) => item.pi_prepared_by).filter(Boolean))];
    const customerNames = await loadOrderCustomerNames((data || []).map((item) => item.sales_order_id));
    const clerkOwners = clerkOwnerIds.length
      ? await createAdminClient().from("users").select("id,name,email").in("id", clerkOwnerIds)
      : { data: [], error: null };
    if (clerkOwners.error) throw clerkOwners.error;
    const preparers = preparerIds.length
      ? await createAdminClient().from("users").select("id,name,email").in("id", preparerIds)
      : { data: [], error: null };
    if (preparers.error) throw preparers.error;
    const clerkOwnerById = new Map((clerkOwners.data || []).map((owner) => [owner.id, owner]));
    const preparerById = new Map((preparers.data || []).map((user) => [user.id, user]));
    return NextResponse.json({ data: (data || []).map((item) => ({ ...item,
      customer_name: customerNames.get(item.sales_order_id) || null,
      sales: clerkOwnerById.get(item.sales_user_id) || null,
      preparer: item.pi_prepared_by ? preparerById.get(item.pi_prepared_by) || null : null,
      progress: summarizeStockProgress(item.status, itemsByStockId.get(item.id) || []) })),
      count: count || 0, page, page_size: pageSize, profile: { id: account.id, role: account.role }, can_update: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account, "stock.update"), can_export: hasPermission(account, "stock.export"), can_preview: hasPermission(account, "stock.preview"), can_view_pi: account.role !== "WAREHOUSE" && hasPermission(account, "orders.view"), can_view_all: account.role === "WAREHOUSE" || hasPermission(account, "stock.data_all") });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单列表加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
