import { NextRequest, NextResponse } from "next/server";
import {
  authErrorStatus,
  hasPermission,
  requestedPiCreatorId,
  requestedOwnerId,
  requirePermission,
} from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { SALES_ORDER_STATUS_LABELS } from "@/lib/types";
import { COUNTRY_OPTIONS, countryFilterRawValues } from "@/lib/countries";
import { buildDirectPiWorkbook } from "@/lib/direct-pi-export";
import { buildWorkbookZip, mapExportBatches, streamZipBytes } from "@/lib/batch-xlsx-zip";
import { PI_EXECUTING_STATUSES, summarizeStockProgress } from "@/lib/stock-progress";
import { loadStockProgressItems } from "@/lib/stock-progress-query";
import { batchExportFilename, documentExportFilename } from "@/lib/export-file-name";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderCustomerNames } from "@/lib/order-customer-name";
import { documentSearchFilter, matchingCustomerIds, matchingPiIdsByStockNumber, normalizeDocumentSearch } from "@/lib/document-search";

const SORT_COLUMNS = {
  order_number: "warehouse_reference_number",
  customer_name: "customer_short_name",
  amount: "total_amount",
  status: "status",
  created_at: "created_at",
  updated_at: "updated_at",
} as const;

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.view");
    const params = request.nextUrl.searchParams;
    const exporting = params.get("export") === "1";
    const selectedIds = params.getAll("id");
    if (selectedIds.length && (!exporting || selectedIds.length > 50 ||
      new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
      throw new Error("所选PI订单无效；每次最多导出50张");
    }
    const page = Math.max(1, Math.floor(Number(params.get("page") || 1) || 1));
    const requestedPageSize = Number(params.get("page_size") || 20);
    const pageSize = [10, 20, 50, 100, 300, 500].includes(requestedPageSize) ? requestedPageSize : 20;
    const status = params.get("status")?.trim() || "";
    const currency = params.get("currency")?.trim().toUpperCase() || "";
    const country = params.get("country")?.trim().toUpperCase() || "";
    const type = params.get("type")?.trim() || "";
    const sortBy = params.get("sort_by") || "updated_at";
    const sortDir = params.get("sort_dir") || "desc";
    const dateFrom = params.get("date_from")?.trim() || "";
    const dateTo = params.get("date_to")?.trim() || "";
    const q = normalizeDocumentSearch(params.get("q"));
    if (status && status !== "ACTIVE" && !(status in SALES_ORDER_STATUS_LABELS)) throw new Error("订单状态无效");
    if (currency && !QUOTE_CURRENCY_CODES.has(currency)) throw new Error("付款币种无效");
    if (country && !COUNTRY_OPTIONS.some((option) => option.code === country)) throw new Error("目的国家无效");
    if (type && type !== "PI") throw new Error("订单类型无效");
    if (exporting && !hasPermission(account, "orders.export")) throw new Error("FORBIDDEN");
    if (exporting && type !== "PI") throw new Error("批量导出仅支持当前PI订单，请先选择PI订单类型");
    if (!(sortBy in SORT_COLUMNS) || !["asc", "desc"].includes(sortDir)) throw new Error("排序参数无效");
    if ([dateFrom, dateTo].some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error("日期格式无效");
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
    const ownerId = await requestedOwnerId(request, account, "orders.data_all");
    const creatorId = await requestedPiCreatorId(request, account, "orders.data_all");
    const [customerIds, stockOrderPiIds] = await Promise.all([matchingCustomerIds(q), matchingPiIdsByStockNumber(q)]);
    const makeQuery = (rangeStart: number, rangeEnd: number) => {
      let query = supabase
        .from("sales_orders")
        .select(
          "id,order_number,warehouse_reference_number,quote_id,quote_number,confirmation_method,sales_user_id,prepared_by,customer_short_name,destination_country,currency,total_amount,status,delivery_date,confirmed_at,pi_revision,created_at,updated_at",
          { count: "exact" },
        )
        .order(SORT_COLUMNS[sortBy as keyof typeof SORT_COLUMNS], { ascending: sortDir === "asc" })
        .order("id", { ascending: true })
        .range(rangeStart, rangeEnd);
      if (account.role === "ORDER_CLERK") query = query.eq("confirmation_method", "DIRECT_PI");
      if (ownerId) query = query.eq("sales_user_id", ownerId);
      if (creatorId) query = query.eq("prepared_by", creatorId);
      if (selectedIds.length) query = query.in("id", selectedIds);
      if (status === "ACTIVE") query = query.in("status", [...PI_EXECUTING_STATUSES]);
      else if (status) query = query.eq("status", status);
      if (currency) query = query.eq("currency", currency);
      if (country) query = query.in("destination_country", countryFilterRawValues([country]));
      if (type === "PI") query = query.eq("confirmation_method", "DIRECT_PI");
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+08:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999+08:00`);
      if (q) {
        const filter = documentSearchFilter(q,
          ["warehouse_reference_number", "order_number", "quote_number", "customer_short_name", "delivery_phone", "delivery_email"],
          "customer_id", customerIds);
        query = query.or(stockOrderPiIds.length ? `${filter},id.in.(${stockOrderPiIds.join(",")})` : filter);
      }
      return query;
    };
    const { data, error, count } = await makeQuery(exporting ? 0 : (page - 1) * pageSize,
      exporting ? 499 : page * pageSize - 1);
    if (error) throw error;
    const rows = [...(data || [])];
    if (exporting) {
      if (!selectedIds.length) throw new Error("请先勾选要导出的PI订单");
      if (!count) throw new Error("当前筛选条件下没有可导出的PI订单");
      if (count !== selectedIds.length) throw new Error("部分所选PI已不在当前筛选结果或无权查看，请刷新后重新勾选");
      if (count > 65535) throw new Error("筛选结果超过ZIP格式的单包文件上限，请缩小筛选范围");
      for (let offset = rows.length; offset < count; offset += 500) {
        const next = await makeQuery(offset, Math.min(offset + 499, count - 1));
        if (next.error) throw next.error;
        rows.push(...(next.data || []));
      }
      if (rows.length !== count) throw new Error("筛选结果读取不完整，请重试");
      if (new Set(rows.map((row) => row.id)).size !== count) throw new Error("导出期间订单列表发生变更，请刷新后重试");
      if (rows.some((row) => ["DRAFT", "CANCELLED"].includes(row.status))) {
        throw new Error("筛选结果包含PI草稿或已取消订单，请先筛选可导出的正式PI状态");
      }
      const ids = rows.map((row) => row.id);
      const idBatches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, (index + 1) * 50));
      const details = (await mapExportBatches(idBatches, 4, async (batchIds) => {
        const result = await supabase.from("sales_orders").select(
          "id,customer_id,prepared_by,order_number,warehouse_reference_number,status,confirmation_method,currency,show_dual_currency_prices,price_display_mode,delivery_date,payment_method,customer_short_name,customer_tax_number_snapshot,shipping_cost,subtotal,total_amount,created_at,confirmed_at,pi_valid_until,seller_company_name,seller_company_address,seller_website,seller_contact_name,seller_contact_phone,seller_contact_email,delivery_recipient,delivery_phone,delivery_email,delivery_address,fx_rate_cny_to_payment,subtotal_cny,shipping_cny,total_cny,last_balance_cny,last_balance_amount,discount_cny,discount_amount,other_charge_cny,other_charge_amount,paypal_fee_percent,paypal_fee_cny,paypal_fee_amount,payment_account_snapshot,customer:customers(company_name,contact_name,tax_number)",
        ).in("id", batchIds);
        if (result.error) throw result.error;
        return result.data || [];
      })).flat();
      const itemRows = (await mapExportBatches(idBatches, 4, async (batchIds) => {
        const first = await supabase.from("sales_order_items").select(
          "sales_order_id,line_number,item_name,brand,model,quality,description,quantity,unit_price,unit_price_cny",
        ).in("sales_order_id", batchIds).order("sales_order_id").order("line_number").range(0, 999);
        if (first.error) throw first.error;
        const items = [...(first.data || [])];
        for (let offset = items.length; offset > 0 && offset % 1000 === 0; offset += 1000) {
          const next = await supabase.from("sales_order_items").select(
            "sales_order_id,line_number,item_name,brand,model,quality,description,quantity,unit_price,unit_price_cny",
          ).in("sales_order_id", batchIds).order("sales_order_id").order("line_number").range(offset, offset + 999);
          if (next.error) throw next.error;
          items.push(...(next.data || []));
          if ((next.data || []).length < 1000) break;
        }
        return items;
      })).flat();
      if (details.length !== ids.length) throw new Error("部分PI已无权查看，请刷新筛选结果");
      const customerNames = await loadOrderCustomerNames(ids);
      const clerkCustomers = account.role === "ORDER_CLERK" ? await createAdminClient().from("customers")
        .select("id,company_name,contact_name,tax_number").in("id", [...new Set(details.map((item) => item.customer_id))]) : null;
      if (clerkCustomers?.error) throw clerkCustomers.error;
      const clerkCustomerById = new Map((clerkCustomers?.data || []).map((item) => [item.id, item]));
      const orderById = new Map(details.map((item) => [item.id, item]));
      const itemsByOrderId = new Map<string, typeof itemRows>();
      for (const item of itemRows) {
        const list = itemsByOrderId.get(item.sales_order_id) || [];
        list.push(item);
        itemsByOrderId.set(item.sales_order_id, list);
      }
      const exportedAt = new Date();
      const files = rows.map((row) => {
        const detail = orderById.get(row.id);
        const items = itemsByOrderId.get(row.id) || [];
        if (!detail || !items.length || detail.status !== row.status) throw new Error("PI数据已更新，请刷新筛选结果");
        const customer = account.role === "ORDER_CLERK" ? clerkCustomerById.get(detail.customer_id) || null : detail.customer;
        return { name: documentExportFilename(row.order_number, "PI订单", "xlsx", exportedAt),
          data: buildDirectPiWorkbook({ ...detail, customer: { ...customer, contact_name: customerNames.get(detail.id) || null },
            order_number: row.warehouse_reference_number || row.order_number } as never, items as never) };
      });
      const zip = buildWorkbookZip(files);
      return new NextResponse(streamZipBytes(zip), { headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(batchExportFilename("PI订单", "zip", exportedAt))}`,
        "Cache-Control": "private, no-store",
      } });
    }
    const ownerIds = [...new Set(rows.map((item) => item.sales_user_id).filter(Boolean))] as string[];
    const creatorIds = [...new Set(rows.map((item) => item.prepared_by).filter(Boolean))] as string[];
    const orderIds = rows.map((item) => item.id);
    const relatedClient = account.role === "ORDER_CLERK" ? createAdminClient() : supabase;
    const [owners, creators, stockOrders, customerNames] = await Promise.all([
      ownerIds.length
        ? createAdminClient().from("users").select("id,name,email").in("id", ownerIds)
        : Promise.resolve({ data: [], error: null }),
      creatorIds.length
        ? createAdminClient().from("users").select("id,name,email").in("id", creatorIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? relatedClient.from("stock_orders").select("id,sales_order_id,stock_number,status").in("sales_order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      loadOrderCustomerNames(orderIds),
    ]);
    if (owners.error) throw owners.error;
    if (creators.error) throw creators.error;
    if (stockOrders.error) throw stockOrders.error;
    const visibleStockIds = (stockOrders.data || []).map((item) => item.id);
    const stockItemsById = await loadStockProgressItems(relatedClient, visibleStockIds);
    const ownerById = new Map((owners.data || []).map((item) => [item.id, item]));
    const creatorById = new Map((creators.data || []).map((item) => [item.id, item]));
    const stockByOrderId = new Map<string, Array<{ id: string; stock_number: string; status: string; progress: ReturnType<typeof summarizeStockProgress> }>>();
    for (const stock of stockOrders.data || []) {
      const list = stockByOrderId.get(stock.sales_order_id) || [];
      list.push({ id: stock.id, stock_number: stock.stock_number, status: stock.status,
        progress: summarizeStockProgress(stock.status, stockItemsById.get(stock.id) || []) });
      stockByOrderId.set(stock.sales_order_id, list);
    }
    return NextResponse.json({
      data: rows.map((item) => ({
        ...item,
        customer_name: customerNames.get(item.id) || null,
        owner: ownerById.get(item.sales_user_id) || null,
        creator: item.prepared_by ? creatorById.get(item.prepared_by) || null : null,
        stock: stockByOrderId.get(item.id) || [],
        can_delete_draft: (account.role === "SALES" || account.role === "ADMIN") &&
          hasPermission(account, "orders.delete_draft") &&
          (account.role === "ADMIN" || item.sales_user_id === account.id) &&
          item.confirmation_method === "DIRECT_PI" && item.status === "DRAFT" &&
          item.confirmed_at === null && !stockByOrderId.has(item.id),
      })),
      count: count || 0,
      page,
      page_size: pageSize,
      can_view_all: hasPermission(account, "orders.data_all"),
      can_filter_creator: ["ADMIN", "ORDER_CLERK"].includes(account.role) && hasPermission(account, "orders.data_all"),
      can_view_stock: hasPermission(account, "stock.view"),
      can_export: hasPermission(account, "orders.export"),
      can_preview: hasPermission(account, "orders.preview"),
      can_create: (account.role === "SALES" || account.role === "SUPERVISOR" || account.role === "ADMIN" || account.role === "ORDER_CLERK") && hasPermission(account, "orders.create"),
      can_import: (account.role === "SALES" || account.role === "SUPERVISOR" || account.role === "ADMIN") && hasPermission(account, "orders.import"),
    });
  } catch (error) {
    console.error("[sales-orders:list]", error);
    const message = sqlErrorMessage(error, "销售订单加载失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}
