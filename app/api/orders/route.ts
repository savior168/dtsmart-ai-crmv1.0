import { NextRequest, NextResponse } from "next/server";
import {
  authErrorStatus,
  hasPermission,
  requestedOwnerId,
  requirePermission,
} from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.view");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(
      100,
      Math.max(10, Number(params.get("page_size") || 20)),
    );
    const ownerId = await requestedOwnerId(request, account, "orders.data_all");
    let query = supabase
      .from("sales_orders")
      .select(
        "id,order_number,warehouse_reference_number,quote_id,quote_number,sales_user_id,customer_short_name,destination_country,currency,total_amount,status,delivery_date,confirmed_at,updated_at",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (ownerId) query = query.eq("sales_user_id", ownerId);
    const status = params.get("status")?.trim();
    if (status) query = query.eq("status", status);
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
      can_create: (account.role === "SALES" || account.role === "SUPERVISOR") && hasPermission(account, "orders.create"),
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
