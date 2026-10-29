import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { performanceOwnerFilter, summarizePiPerformance, type PiOrderRow } from "@/lib/reports/pi-performance";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 500;
const PERFORMANCE_STATUSES = ["CONFIRMED", "STOCK_DRAFT", "WAITING_STOCK", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED", "READY", "SHORTAGE"];

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("reports.view");
    if (!["ADMIN", "SUPERVISOR", "SALES"].includes(account.role)) throw new Error("FORBIDDEN");
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
      return NextResponse.json({ error: "无效日期范围" }, { status: 400 });
    }
    const selectedOwner = await requestedOwnerId(request, account, "reports.data_all");
    const admin = createAdminClient();
    // requestedOwnerId validates every non-admin selection against the direct
    // report relationship and the live role permission before privileged reads.
    const allowedOwners = performanceOwnerFilter(account.role, account.id, selectedOwner);
    const rawOrders: Array<{
      id: string; order_number: string; customer_id: string | null; customer_short_name: string | null;
      sales_user_id: string; currency: string; total_amount: number; total_cny: number | null;
      fx_rate_cny_to_payment: number | null; archived_at: string | null; status: string; confirmed_at: string;
    }> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = admin.from("sales_orders")
        .select("id,order_number,customer_id,customer_short_name,sales_user_id,currency,total_amount,total_cny,fx_rate_cny_to_payment,archived_at,status,confirmed_at")
        .gte("confirmed_at", from).lt("confirmed_at", to).is("archived_at", null).in("status", PERFORMANCE_STATUSES)
        .order("confirmed_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (allowedOwners) query = query.in("sales_user_id", allowedOwners);
      const { data, error } = await query;
      if (error) throw error;
      rawOrders.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    const customerIds = [...new Set(rawOrders.map((order) => order.customer_id).filter((id): id is string => Boolean(id)))];
    const customerNames = new Map<string, string>();
    for (let index = 0; index < customerIds.length; index += 100) {
      const { data, error } = await admin.from("customers").select("id,company_name").in("id", customerIds.slice(index, index + 100));
      if (error) throw error;
      for (const customer of data || []) customerNames.set(customer.id, customer.company_name || "");
    }
    const itemsByOrder = new Map<string, PiOrderRow["items"]>();
    const ids = rawOrders.map((order) => order.id);
    for (let index = 0; index < ids.length; index += 50) {
      const batch = ids.slice(index, index + 50);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("sales_order_items")
          .select("sales_order_id,item_name,brand,model,quantity,amount,unit_price_cny")
          .in("sales_order_id", batch).order("sales_order_id").order("line_number").range(offset, offset + 999);
        if (error) throw error;
        for (const item of data || []) {
          const entries = itemsByOrder.get(item.sales_order_id) || [];
          entries.push({ item_name: item.item_name || "", brand: item.brand || "", model: item.model || "", quantity: Number(item.quantity || 0), amount: Number(item.amount || 0), unit_price_cny: item.unit_price_cny == null ? null : Number(item.unit_price_cny) });
          itemsByOrder.set(item.sales_order_id, entries);
        }
        if (!data || data.length < 1000) break;
      }
    }
    const orders: PiOrderRow[] = rawOrders.map((order) => ({
      id: order.id, order_number: order.order_number, customer_id: order.customer_id,
      customer_name: (order.customer_id && customerNames.get(order.customer_id)) || order.customer_short_name || "未命名客户",
      sales_user_id: order.sales_user_id, currency: order.currency, total_amount: Number(order.total_amount || 0),
      confirmed_at: order.confirmed_at, items: itemsByOrder.get(order.id) || [],
    }));
    return NextResponse.json(summarizePiPerformance(orders, rawOrders, selectedOwner), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "业绩明细加载失败";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
    }
    console.error("PI performance report failed", error);
    return NextResponse.json({ error: "业绩明细加载失败，请稍后重试" }, { status: 500 });
  }
}
