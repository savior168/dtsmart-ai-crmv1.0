import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    const params = request.nextUrl.searchParams;
    if (params.get("view") === "dashboard") {
      const dashboard = await supabase.rpc("stock_order_dashboard");
      if (dashboard.error) throw dashboard.error;
      return NextResponse.json(dashboard.data || { counts: {}, recent: [] }, {
        headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
      });
    }
    const ownerId = account.role === "WAREHOUSE" ? null : requestedOwnerId(request, account, "stock.data_all");
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("page_size") || 20)));
    const from = (page - 1) * pageSize;
    let query = supabase.from("stock_orders")
      .select("id,quote_id,sales_order_id,quote_number,order_number,stock_number,sales_user_id,customer_short_name,destination_country,status,stocking_requirements,status_note,expected_ready_at,ready_at,created_at,updated_at,sales:users!stock_orders_sales_user_id_fkey(name,email)", { count: "exact" })
      .order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
    if (ownerId) query = query.eq("sales_user_id", ownerId);
    const status = params.get("status")?.trim();
    if (status) query = query.eq("status", status);
    const q = params.get("q")?.replace(/[%_,()]/g, "").trim();
    if (q) query = query.or(`stock_number.ilike.%${q}%,order_number.ilike.%${q}%,quote_number.ilike.%${q}%,customer_short_name.ilike.%${q}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: count || 0, page, page_size: pageSize, profile: { id: account.id, role: account.role }, can_update: ["WAREHOUSE","ADMIN"].includes(account.role) && hasPermission(account, "stock.update"), can_view_all: account.role === "WAREHOUSE" || hasPermission(account, "stock.data_all") });
  } catch (error) {
    const message = sqlErrorMessage(error, "备货单列表加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
