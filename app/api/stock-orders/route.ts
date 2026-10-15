import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { STOCK_STATUS_LABELS } from "@/lib/types";
import { COUNTRY_OPTIONS, countryFilterRawValues } from "@/lib/countries";
import { buildStockWorkbook } from "@/lib/template-xlsx";
import { buildWorkbookZip } from "@/lib/batch-xlsx-zip";
import { summarizeStockProgress } from "@/lib/stock-progress";
import { loadStockProgressItems } from "@/lib/stock-progress-query";
import { createAdminClient } from "@/lib/supabase/admin";

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
    if (exporting && !hasPermission(account, "stock.export")) throw new Error("FORBIDDEN");
    if (params.get("view") === "dashboard") {
      const dashboard = await supabase.rpc("stock_order_dashboard");
      if (dashboard.error) throw dashboard.error;
      return NextResponse.json(dashboard.data || { counts: {}, recent: [] }, {
        headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
      });
    }
    const ownerId = account.role === "WAREHOUSE" ? null : await requestedOwnerId(request, account, "stock.data_all");
    const page = Math.max(1, Math.floor(Number(params.get("page") || 1) || 1));
    const pageSize = Math.min(500, Math.max(10, Math.floor(Number(params.get("page_size") || 20) || 20)));
    const status = params.get("status")?.trim() || "";
    const country = params.get("country")?.trim().toUpperCase() || "";
    const sortBy = params.get("sort_by") || "updated_at";
    const sortDir = params.get("sort_dir") || "desc";
    const dateFrom = params.get("date_from")?.trim() || "";
    const dateTo = params.get("date_to")?.trim() || "";
    if (status && !(status in STOCK_STATUS_LABELS)) throw new Error("备货状态无效");
    if (country && !COUNTRY_OPTIONS.some((option) => option.code === country)) throw new Error("目的国家无效");
    if (!(sortBy in SORT_COLUMNS) || !["asc", "desc"].includes(sortDir)) throw new Error("排序参数无效");
    if ([dateFrom, dateTo].some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error("日期格式无效");
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
    const from = (page - 1) * pageSize;
    let query = supabase.from("stock_orders")
      .select("id,quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at,sales:users!stock_orders_sales_user_id_fkey(name,email)", { count: "exact" })
      .order(SORT_COLUMNS[sortBy as keyof typeof SORT_COLUMNS], { ascending: sortDir === "asc" })
      .order("id", { ascending: true }).range(exporting ? 0 : from, exporting ? 49 : from + pageSize - 1);
    if (ownerId) query = query.eq("sales_user_id", ownerId);
    if (status) query = query.eq("status", status);
    if (country) query = query.in("destination_country", countryFilterRawValues([country]));
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+08:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999+08:00`);
    const q = params.get("q")?.replace(/[%_,()]/g, "").trim();
    if (q) query = query.or(`stock_number.ilike.%${q}%,warehouse_reference_number.ilike.%${q}%,order_number.ilike.%${q}%,customer_short_name.ilike.%${q}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    if (exporting) {
      if (!count) throw new Error("当前筛选条件下没有可导出的备货单");
      if (count > 50) throw new Error("一次最多导出50张备货单，请缩小筛选范围后重试");
      const rows = data || [];
      if (rows.length !== count) throw new Error("筛选结果读取不完整，请重试");
      if (rows.some((row) => ["DRAFT", "CANCELLED"].includes(row.status))) {
        throw new Error("筛选结果包含待完善、已撤回或已取消备货单，请先筛选可导出的状态");
      }
      const ids = rows.map((row) => row.id);
      const [details, itemResult, shippedResult] = await Promise.all([
        supabase.from("stock_orders").select(
          "id,sales_order_id,stock_number,quote_number,order_number,warehouse_reference_number,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,created_at,delivery_recipient,delivery_phone,delivery_email,delivery_address,salesperson:users!stock_orders_sales_user_id_fkey(name,email)",
        ).in("id", ids),
        supabase.from("stock_order_items").select(
          "stock_order_id,line_number,product_type_snapshot,product_specifications_snapshot,product_color_snapshot,item_name,brand,model,quality,description,description_zh,estimated_unit_cost_cny,procurement_cost,procurement_cost_confirmed,quantity,received_quantity,warehouse_supplier_code,preparation_requirement,internal_note",
        ).in("stock_order_id", ids).order("line_number"),
        supabase.from("stock_order_events").select("stock_order_id,created_at").in("stock_order_id", ids).eq("to_status", "SHIPPED").order("created_at", { ascending: false }),
      ]);
      if (details.error) throw details.error;
      if (itemResult.error) throw itemResult.error;
      if (shippedResult.error) throw shippedResult.error;
      if ((details.data || []).length !== ids.length) throw new Error("部分备货单已无权查看，请刷新筛选结果");
      const piNotes = await createAdminClient().from("sales_orders")
        .select("id,confirmation_note").in("id", (details.data || []).map((item) => item.sales_order_id));
      if (piNotes.error) throw piNotes.error;
      const piNoteById = new Map((piNotes.data || []).map((item) => [item.id, item.confirmation_note]));
      const detailById = new Map((details.data || []).map((item) => [item.id, item]));
      const itemsByStockId = new Map<string, NonNullable<typeof itemResult.data>>();
      for (const item of itemResult.data || []) {
        const list = itemsByStockId.get(item.stock_order_id) || [];
        list.push(item);
        itemsByStockId.set(item.stock_order_id, list);
      }
      const shippedByStockId = new Map<string, string>();
      for (const event of shippedResult.data || []) {
        if (!shippedByStockId.has(event.stock_order_id)) shippedByStockId.set(event.stock_order_id, event.created_at);
      }
      const files = await Promise.all(rows.map(async (row) => {
        const detail = detailById.get(row.id);
        const items = itemsByStockId.get(row.id) || [];
        if (!detail || !items.length || detail.status !== row.status) throw new Error("备货数据已更新，请刷新筛选结果");
        return { name: `${row.warehouse_reference_number || row.order_number}-备货单.xlsx`,
          data: await buildStockWorkbook({ ...detail, order_change_note: piNoteById.get(detail.sales_order_id) || null,
            shipped_at: shippedByStockId.get(row.id) || null } as never, items as never) };
      }));
      const zip = buildWorkbookZip(files);
      return new NextResponse(new Uint8Array(zip), { headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename*=UTF-8''stock-orders.zip",
        "Cache-Control": "private, no-store",
      } });
    }
    const visibleIds = (data || []).map((item) => item.id);
    const itemsByStockId = await loadStockProgressItems(supabase, visibleIds);
    return NextResponse.json({ data: (data || []).map((item) => ({ ...item,
      progress: summarizeStockProgress(item.status, itemsByStockId.get(item.id) || []) })),
      count: count || 0, page, page_size: pageSize, profile: { id: account.id, role: account.role }, can_update: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account, "stock.update"), can_export: hasPermission(account, "stock.export"), can_view_pi: account.role !== "WAREHOUSE" && hasPermission(account, "orders.view"), can_view_all: account.role === "WAREHOUSE" || hasPermission(account, "stock.data_all") });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单列表加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
