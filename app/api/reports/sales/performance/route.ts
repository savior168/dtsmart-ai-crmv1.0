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
    const teamScopeRequested = account.role === "SUPERVISOR" && request.nextUrl.searchParams.get("scope") === "team";
    if (teamScopeRequested && (!account.supervisor_can_view_subordinates || !account.permissions.includes("reports.data_all"))) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const selectedOwner = await requestedOwnerId(request, account, "reports.data_all");
    const admin = createAdminClient();
    // requestedOwnerId validates every non-admin selection against the direct
    // report relationship and the live role permission before privileged reads.
    let allowedOwners = performanceOwnerFilter(account.role, account.id, selectedOwner);
    if (teamScopeRequested) {
      const { data: reports, error } = await admin.from("users").select("id")
        .eq("manager_id", account.id).eq("role", "SALES").eq("status", "ACTIVE");
      if (error) throw error;
      allowedOwners = [...new Set([account.id, ...(reports || []).map((row) => String(row.id))])];
    }
    const includeTeamLeaderboard = account.role === "ADMIN" && selectedOwner === null || teamScopeRequested;
    const rawOrders: Array<{
      id: string; order_number: string; customer_id: string | null; customer_short_name: string | null;
      sales_user_id: string; currency: string; total_amount: number; total_cny: number | null;
      fx_rate_cny_to_payment: number | null; usd_cny_rate_snapshot: number | null;
      usd_rate_source_snapshot: string | null; usd_rate_reference_date_snapshot: string | null;
      usd_rate_synced_at_snapshot: string | null; archived_at: string | null; status: string; confirmed_at: string;
    }> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = admin.from("sales_orders")
        .select("id,order_number,customer_id,customer_short_name,sales_user_id,currency,total_amount,total_cny,fx_rate_cny_to_payment,usd_cny_rate_snapshot,usd_rate_source_snapshot,usd_rate_reference_date_snapshot,usd_rate_synced_at_snapshot,archived_at,status,confirmed_at")
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
    const customerCountries = new Map<string, string>();
    for (let index = 0; index < customerIds.length; index += 100) {
      const { data, error } = await admin.from("customers").select("id,company_name,country").in("id", customerIds.slice(index, index + 100));
      if (error) throw error;
      for (const customer of data || []) {
        customerNames.set(customer.id, customer.company_name || "");
        customerCountries.set(customer.id, String(customer.country || "").trim());
      }
    }
    const customerOptions = customerIds.map((id) => ({
      id,
      label: customerNames.get(id) || rawOrders.find((order) => order.customer_id === id)?.customer_short_name || "未命名客户",
      country: customerCountries.get(id) || "",
    })).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    const countryOptions = [...new Set(customerOptions.map((customer) => customer.country || "__unknown__"))]
      .map((value) => ({ value, label: value === "__unknown__" ? "未填写国家/地区" : value }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    const selectedCountry = request.nextUrl.searchParams.get("country") || "";
    const selectedCustomer = request.nextUrl.searchParams.get("customer_id") || "";
    const scopedOrders = rawOrders.filter((order) => {
      if (selectedCustomer && order.customer_id !== selectedCustomer) return false;
      if (selectedCountry) {
        const country = customerCountries.get(order.customer_id || "") || "__unknown__";
        if (country !== selectedCountry) return false;
      }
      return true;
    });
    const itemsByOrder = new Map<string, PiOrderRow["items"]>();
    const ids = scopedOrders.map((order) => order.id);
    for (let index = 0; index < ids.length; index += 50) {
      const batch = ids.slice(index, index + 50);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("sales_order_items")
          .select("sales_order_id,line_number,item_name,brand,model,quantity,amount,unit_price_cny,estimated_unit_cost_cny")
          .in("sales_order_id", batch).order("sales_order_id").order("line_number").range(offset, offset + 999);
        if (error) throw error;
        for (const item of data || []) {
          const entries = itemsByOrder.get(item.sales_order_id) || [];
          entries.push({ line_number: Number(item.line_number), item_name: item.item_name || "", brand: item.brand || "", model: item.model || "", quantity: Number(item.quantity || 0), amount: Number(item.amount || 0), unit_price_cny: item.unit_price_cny == null ? null : Number(item.unit_price_cny), estimated_unit_cost_cny: item.estimated_unit_cost_cny == null ? null : Number(item.estimated_unit_cost_cny) });
          itemsByOrder.set(item.sales_order_id, entries);
        }
        if (!data || data.length < 1000) break;
      }
    }
    const stockByOrder = new Map<string, string>();
    for (let index = 0; index < ids.length; index += 100) {
      const { data, error } = await admin.from("stock_orders").select("id,sales_order_id")
        .in("sales_order_id", ids.slice(index, index + 100)).order("updated_at", { ascending: false });
      if (error) throw error;
      for (const stock of data || []) if (!stockByOrder.has(stock.sales_order_id)) stockByOrder.set(stock.sales_order_id, stock.id);
    }
    const procurementByLine = new Map<string, number>();
    const stockIds = [...new Set(stockByOrder.values())];
    for (let index = 0; index < stockIds.length; index += 50) {
      const batch = stockIds.slice(index, index + 50);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("stock_order_items")
          .select("stock_order_id,line_number,procurement_cost,procurement_cost_confirmed")
          .in("stock_order_id", batch).range(offset, offset + 999);
        if (error) throw error;
        for (const item of data || []) {
          const cost = Number(item.procurement_cost);
          if (item.procurement_cost_confirmed && Number.isFinite(cost) && cost >= 0) {
            procurementByLine.set(String(item.stock_order_id) + ":" + String(item.line_number), cost);
          }
        }
        if (!data || data.length < 1000) break;
      }
    }
    const orders: PiOrderRow[] = rawOrders.map((order) => ({
      id: order.id, order_number: order.order_number, customer_id: order.customer_id,
      customer_name: (order.customer_id && customerNames.get(order.customer_id)) || order.customer_short_name || "未命名客户",
      sales_user_id: order.sales_user_id, currency: order.currency, total_amount: Number(order.total_amount || 0),
      confirmed_at: order.confirmed_at, items: (itemsByOrder.get(order.id) || []).map((item) => ({ ...item, procurement_unit_cost_cny: item.line_number == null ? null : procurementByLine.get(String(stockByOrder.get(order.id)) + ":" + String(item.line_number)) ?? null })),
    }));
    const summary = summarizePiPerformance(orders, scopedOrders, teamScopeRequested ? null : selectedOwner);
    let teamLeaderboard: Array<{ user_id: string; name: string; email: string; orders: number; customers: number; products: number; quantity: number; cny: number; usd: number; product_profit_cny: number; product_profit_usd: number; product_margin: number | null }> = [];
    if (includeTeamLeaderboard) {
      const ownerIds = [...new Set(scopedOrders.map((order) => order.sales_user_id))];
      const ownerNames = new Map<string, { name: string; email: string }>();
      for (let index = 0; index < ownerIds.length; index += 100) {
        const { data, error } = await admin.from("users").select("id,name,email").in("id", ownerIds.slice(index, index + 100));
        if (error) throw error;
        for (const owner of data || []) ownerNames.set(String(owner.id), { name: String(owner.name || ""), email: String(owner.email || "") });
      }
      teamLeaderboard = ownerIds.map((ownerId) => {
        const ownerRows = scopedOrders.filter((order) => order.sales_user_id === ownerId);
        const ownerOrders = orders.filter((order) => order.sales_user_id === ownerId);
        const ownerSummary = summarizePiPerformance(ownerOrders, ownerRows, ownerId);
        const owner = ownerNames.get(ownerId) || { name: "", email: "" };
        return {
          user_id: ownerId, name: owner.name || owner.email || "未命名销售员", email: owner.email,
          orders: ownerSummary.totals.orders, customers: ownerSummary.customers.length, products: ownerSummary.products.length,
          quantity: ownerSummary.orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
          cny: ownerSummary.totals.cny, usd: ownerSummary.totals.usd,
          product_profit_cny: ownerSummary.totals.product_profit_cny, product_profit_usd: ownerSummary.totals.product_profit_usd,
          product_margin: ownerSummary.totals.product_margin,
        };
      });
    }
    return NextResponse.json({
      filters: { countries: countryOptions, customers: customerOptions },
      team_leaderboard: { available: account.role === "SUPERVISOR" && account.supervisor_can_view_subordinates && account.permissions.includes("reports.data_all"), selected: includeTeamLeaderboard, rows: teamLeaderboard },
      totals: { orders: summary.totals.orders, cny: summary.totals.cny, usd: summary.totals.usd,
        missing_cny: summary.totals.missing_cny, missing_usd: summary.totals.missing_usd,
        product_sales_cny: summary.totals.product_sales_cny, cost_cny: summary.totals.cost_cny, product_profit_cny: summary.totals.product_profit_cny,
        product_profit_usd: summary.totals.product_profit_usd, product_margin: summary.totals.product_margin,
        missing_profit_orders: summary.totals.missing_profit_orders, missing_profit_usd_orders: summary.totals.missing_profit_usd_orders },
      customers: summary.customers.map((row) => ({ id: row.id, label: row.label, order_count: row.order_count, quantity: row.quantity,
        cny: row.cny, usd: row.usd, missing_cny: row.missing_cny, missing_usd: row.missing_usd,
        product_profit_cny: row.product_profit_cny, product_profit_usd: row.product_profit_usd,
        product_sales_cny: row.product_sales_cny, missing_profit_orders: row.missing_profit_orders,
        missing_profit_usd_orders: row.missing_profit_usd_orders, product_margin: row.product_margin })),
      products: summary.products.map((row) => ({ key: row.key, label: row.label, model: row.model, quantity: row.quantity,
        cny: row.cny, usd: row.usd, missing_cny: row.missing_cny, missing_usd: row.missing_usd,
        product_profit_cny: row.product_profit_cny, product_profit_usd: row.product_profit_usd,
        product_sales_cny: row.product_sales_cny, missing_cost_lines: row.missing_cost_lines,
        missing_profit_lines: row.missing_profit_lines, missing_profit_usd_lines: row.missing_profit_usd_lines,
        product_margin: row.product_margin })),
      orders: summary.orders.map((row) => ({
        id: row.id, order_number: row.order_number, customer_id: row.customer_id, customer_name: row.customer_name,
        currency: row.currency, total_amount: row.total_amount, total_cny: row.total_cny, total_usd: row.total_usd,
        product_sales_cny: row.product_sales_cny, product_profit_cny: row.product_profit_cny, product_profit_usd: row.product_profit_usd,
        product_margin: row.product_margin, missing_cost_lines: row.missing_cost_lines, actual_cost_lines: row.actual_cost_lines,
        estimated_cost_lines: row.estimated_cost_lines, missing_profit_usd: row.missing_profit_usd,
        usd_cny_rate_snapshot: row.usd_cny_rate_snapshot, usd_rate_source_snapshot: row.usd_rate_source_snapshot,
        usd_rate_reference_date_snapshot: row.usd_rate_reference_date_snapshot, usd_rate_synced_at_snapshot: row.usd_rate_synced_at_snapshot,
        confirmed_at: row.confirmed_at,
        items: row.items.map((item) => ({ item_name: item.item_name, brand: item.brand, model: item.model,
          quantity: item.quantity, amount: item.amount, unit_price_cny: item.unit_price_cny,
          sales_cny: item.sales_cny, sales_usd: item.sales_usd, profit_cny: item.profit_cny, profit_usd: item.profit_usd })),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "业绩明细加载失败";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
    }
    console.error("PI performance report failed", error);
    return NextResponse.json({ error: "业绩明细加载失败，请稍后重试" }, { status: 500 });
  }
}
