import { NextRequest, NextResponse } from "next/server";
import {
  authErrorStatus,
  hasPermission,
  requestedOwnerId,
  requirePermission,
} from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { SALES_ORDER_STATUS_LABELS } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.view");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Math.floor(Number(params.get("page") || 1) || 1));
    const pageSize = Math.min(
      500,
      Math.max(10, Math.floor(Number(params.get("page_size") || 20) || 20)),
    );
    const status = params.get("status")?.trim() || "";
    const currency = params.get("currency")?.trim().toUpperCase() || "";
    const type = params.get("type")?.trim() || "";
    const dateFrom = params.get("date_from")?.trim() || "";
    const dateTo = params.get("date_to")?.trim() || "";
    if (status && !(status in SALES_ORDER_STATUS_LABELS)) throw new Error("订单状态无效");
    if (currency && !QUOTE_CURRENCY_CODES.has(currency)) throw new Error("付款币种无效");
    if (type && type !== "PI") throw new Error("订单类型无效");
    if ([dateFrom, dateTo].some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error("日期格式无效");
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
    const ownerId = await requestedOwnerId(request, account, "orders.data_all");
    let query = supabase
      .from("sales_orders")
      .select(
        "id,order_number,quote_id,quote_number,confirmation_method,sales_user_id,customer_short_name,destination_country,currency,total_amount,status,delivery_date,confirmed_at,created_at,updated_at",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (ownerId) query = query.eq("sales_user_id", ownerId);
    if (status) query = query.eq("status", status);
    if (currency) query = query.eq("currency", currency);
    if (type === "PI") query = query.eq("confirmation_method", "DIRECT_PI");
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+08:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999+08:00`);
    const q = params
      .get("q")
      ?.trim()
      .replace(/[%_,()]/g, "");
    if (q)
      query = query.or(
        `order_number.ilike.%${q}%,quote_number.ilike.%${q}%,customer_short_name.ilike.%${q}%`,
      );
    const { data, error, count } = await query;
    if (error) throw error;
    const rows = data || [];
    const ownerIds = [...new Set(rows.map((item) => item.sales_user_id).filter(Boolean))] as string[];
    const orderIds = rows.map((item) => item.id);
    const [owners, stockOrders] = await Promise.all([
      ownerIds.length
        ? supabase.from("users").select("id,name,email").in("id", ownerIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? supabase.from("stock_orders").select("id,sales_order_id,stock_number,status").in("sales_order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (owners.error) throw owners.error;
    if (stockOrders.error) throw stockOrders.error;
    const ownerById = new Map((owners.data || []).map((item) => [item.id, item]));
    const stockByOrderId = new Map<string, Array<{ id: string; stock_number: string; status: string }>>();
    for (const stock of stockOrders.data || []) {
      const list = stockByOrderId.get(stock.sales_order_id) || [];
      list.push({ id: stock.id, stock_number: stock.stock_number, status: stock.status });
      stockByOrderId.set(stock.sales_order_id, list);
    }
    return NextResponse.json({
      data: rows.map((item) => ({
        ...item,
        owner: ownerById.get(item.sales_user_id) || null,
        stock: stockByOrderId.get(item.id) || [],
      })),
      count: count || 0,
      page,
      page_size: pageSize,
      can_view_all: hasPermission(account, "orders.data_all"),
      can_create: (account.role === "SALES" || account.role === "SUPERVISOR" || account.role === "ADMIN") && hasPermission(account, "orders.create"),
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
