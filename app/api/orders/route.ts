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
    const ownerId = requestedOwnerId(request, account, "orders.data_all");
    let query = supabase
      .from("sales_orders")
      .select(
        "id,order_number,quote_id,quote_number,sales_user_id,customer_short_name,destination_country,currency,total_amount,status,delivery_date,confirmed_at,updated_at,owner:users!sales_orders_sales_user_id_fkey(name,email),stock:stock_orders(id,stock_number,status)",
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
    return NextResponse.json({
      data: data || [],
      count: count || 0,
      page,
      page_size: pageSize,
      can_view_all: hasPermission(account, "orders.data_all"),
    });
  } catch (error) {
    const message = sqlErrorMessage(error, "销售订单加载失败");
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(message) || 400 },
    );
  }
}
