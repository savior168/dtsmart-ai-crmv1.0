import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";

const ACTIVE_STATUSES = ["PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP"];

export async function GET() {
  try {
    const { supabase, account } = await requirePermission("dashboard.view");
    if (account.role !== "ORDER_CLERK" || !hasPermission(account, "orders.view")) throw new Error("FORBIDDEN");
    const base = () => {
      let query = supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("confirmation_method", "DIRECT_PI");
      if (!hasPermission(account, "orders.data_all")) query = query.eq("sales_user_id", account.id);
      return query;
    };
    let recentQuery = supabase.from("sales_orders")
      .select("id,order_number,warehouse_reference_number,customer_short_name,status,updated_at")
      .eq("confirmation_method", "DIRECT_PI").order("updated_at", { ascending: false }).limit(8);
    if (!hasPermission(account, "orders.data_all")) recentQuery = recentQuery.eq("sales_user_id", account.id);
    const [total, ownDraft, waiting, active, shortage, shipped, recent] = await Promise.all([
      base(), base().eq("status", "DRAFT").eq("prepared_by", account.id),
      base().eq("status", "WAITING_STOCK"), base().in("status", ACTIVE_STATUSES),
      base().eq("status", "SHORTAGE"), base().eq("status", "SHIPPED"), recentQuery,
    ]);
    const failure = total.error || ownDraft.error || waiting.error || active.error || shortage.error || shipped.error || recent.error;
    if (failure) throw failure;
    return NextResponse.json({
      counts: { total: total.count || 0, own_draft: ownDraft.count || 0, waiting: waiting.count || 0, active: active.count || 0, shortage: shortage.count || 0, shipped: shipped.count || 0 },
      recent: recent.data || [], scope: hasPermission(account, "orders.data_all") ? "ALL_AUTHORIZED_PI" : "OWN_SCOPE", user_id: account.id,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "跟单工作台加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
