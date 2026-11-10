import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { performanceOwnerFilter, resolvePiCustomerName, summarizePiPerformance, type PiOrderRow } from "@/lib/reports/pi-performance";
import { createAdminClient } from "@/lib/supabase/admin";
import { productTrendPoints } from "@/lib/reports/product-trend";
import { performanceTrendPeriods } from "@/lib/reports/performance-trend-periods";
import { actualOrderProfit, actualReceiptCostByItem, summarizeActualOrders, type ReceiptAllocation } from "@/lib/reports/actual-receipt-cost";

const PAGE_SIZE = 500;
const PERFORMANCE_STATUSES = ["CONFIRMED", "STOCK_DRAFT", "WAITING_STOCK", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED", "READY", "SHORTAGE"];

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("sales.performance.view");
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
      return NextResponse.json({ error: "无效日期范围" }, { status: 400 });
    }
    const teamScopeRequested = account.role === "SUPERVISOR" && request.nextUrl.searchParams.get("scope") === "team";
    if (teamScopeRequested && (!account.supervisor_can_view_subordinates || !hasPermission(account, "sales.performance.data_all"))) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const selectedOwner = await requestedOwnerId(request, account, "sales.performance.data_all");
    const admin = createAdminClient();
    // requestedOwnerId validates every non-admin selection against the direct
    // report relationship and the live role permission before privileged reads.
    let allowedOwners = performanceOwnerFilter(account.role, account.id, selectedOwner);
    let teamOwnerIds: string[] | null = null;
    if (teamScopeRequested) {
      const { data: reports, error } = await admin.from("users").select("id")
        .eq("manager_id", account.id).eq("role", "SALES").eq("status", "ACTIVE");
      if (error) throw error;
      teamOwnerIds = [...new Set([account.id, ...(reports || []).map((row) => String(row.id))])];
      allowedOwners = teamOwnerIds;
    }
    const includeTeamLeaderboard = account.role === "ADMIN" && selectedOwner === null || teamScopeRequested;
    const rawOrders: Array<{
      id: string; order_number: string; warehouse_reference_number: string | null; customer_id: string | null; customer_short_name: string | null; customer_name_snapshot: string | null;
      sales_user_id: string; currency: string; total_amount: number; total_cny: number | null;
      fx_rate_cny_to_payment: number | null; usd_cny_rate_snapshot: number | null;
      usd_rate_source_snapshot: string | null; usd_rate_reference_date_snapshot: string | null;
      usd_rate_synced_at_snapshot: string | null; archived_at: string | null; status: string; confirmed_at: string;
    }> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = admin.from("sales_orders")
        .select("id,order_number,warehouse_reference_number,customer_id,customer_short_name,customer_name_snapshot,sales_user_id,currency,total_amount,total_cny,fx_rate_cny_to_payment,usd_cny_rate_snapshot,usd_rate_source_snapshot,usd_rate_reference_date_snapshot,usd_rate_synced_at_snapshot,archived_at,status,confirmed_at")
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
      const { data, error } = await admin.from("customers").select("id,contact_name,company_name,country").in("id", customerIds.slice(index, index + 100));
      if (error) throw error;
      for (const customer of data || []) {
        customerNames.set(customer.id, String(customer.contact_name || customer.company_name || "").trim());
        customerCountries.set(customer.id, String(customer.country || "").trim());
      }
    }
    const customerOptions = customerIds.map((id) => ({
      id,
      label: resolvePiCustomerName(rawOrders.find((order) => order.customer_id === id)?.customer_name_snapshot || null,
        customerNames.get(id) || null, rawOrders.find((order) => order.customer_id === id)?.customer_short_name || null),
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
          .in("sales_order_id", batch).is("pi_amendment_cancelled_at", null).order("sales_order_id").order("line_number").range(offset, offset + 999);
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
    const stockItemByLine = new Map<string, { id: string; shipped_quantity: number }>();
    const stockIds = [...new Set(stockByOrder.values())];
    for (let index = 0; index < stockIds.length; index += 50) {
      const batch = stockIds.slice(index, index + 50);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("stock_order_items")
          .select("id,stock_order_id,line_number,shipped_quantity")
          .in("stock_order_id", batch).is("pi_amendment_cancelled_at", null).range(offset, offset + 999);
        if (error) throw error;
        for (const item of data || []) {
          stockItemByLine.set(String(item.stock_order_id) + ":" + String(item.line_number),
            { id: String(item.id), shipped_quantity: Number(item.shipped_quantity || 0) });
        }
        if (!data || data.length < 1000) break;
      }
    }
    const customerOrderNumbers = new Map(rawOrders.map((order) => [order.id, order.warehouse_reference_number?.trim() || null]));
    const orders: PiOrderRow[] = rawOrders.map((order) => ({
      id: order.id, order_number: order.order_number, customer_id: order.customer_id,
      customer_name: resolvePiCustomerName(order.customer_name_snapshot,
        order.customer_id ? customerNames.get(order.customer_id) || null : null, order.customer_short_name),
      sales_user_id: order.sales_user_id, currency: order.currency, total_amount: Number(order.total_amount || 0),
      confirmed_at: order.confirmed_at, items: itemsByOrder.get(order.id) || [],
    }));
    const summary = summarizePiPerformance(orders, scopedOrders, teamScopeRequested ? null : selectedOwner);
    const actualByOrder = new Map<string, NonNullable<ReturnType<typeof actualOrderProfit>>>();
    let actualTotals: {
      complete_orders: number; pending_orders: number; shipped_orders: number; product_sales_cny: number;
      purchase_cost_cny: number; actual_gross_profit_cny: number;
      actual_gross_margin: number | null; actual_net_profit_cny: number;
      actual_net_sales_cny: number; actual_net_margin: number | null;
      pending_expense_orders: number;
    } | null = null;
    if (hasPermission(account, "sales.performance.actual_profit.view")) {
      const stockItemIds = [...new Set([...stockItemByLine.values()].map((item) => item.id))];
      const allocations: ReceiptAllocation[] = [];
      let receiptLedgerAvailable = true;
      for (let index = 0; index < stockItemIds.length; index += 50) {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await admin.from("supplier_receipt_allocations")
            .select("stock_order_item_id,quantity,purchase_unit_price_cny")
            .in("stock_order_item_id", stockItemIds.slice(index, index + 50))
            .range(offset, offset + 999);
          if (error && ["42P01", "PGRST205"].includes(error.code || "")) {
            receiptLedgerAvailable = false;
            break;
          }
          if (error) throw error;
          allocations.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        if (!receiptLedgerAvailable) break;
      }
      if (receiptLedgerAvailable) {
        const receipts = actualReceiptCostByItem(allocations);
        const expensesByStock = new Map<string, { packaging_cny: number; shipping_cny: number; other_cny: number }>();
        for (let index = 0; index < stockIds.length; index += 100) {
          const { data, error } = await admin.from("stock_order_expenses")
            .select("stock_order_id,packaging_cost_cny,shipping_expenses_cny,procurement_expenses_cny")
            .in("stock_order_id", stockIds.slice(index, index + 100));
          if (error) throw error;
          for (const expense of data || []) expensesByStock.set(String(expense.stock_order_id), {
            packaging_cny: Number(expense.packaging_cost_cny), shipping_cny: Number(expense.shipping_expenses_cny),
            other_cny: Number(expense.procurement_expenses_cny),
          });
        }
        actualTotals = { complete_orders: 0, pending_orders: 0, shipped_orders: 0, product_sales_cny: 0,
          purchase_cost_cny: 0, actual_gross_profit_cny: 0, actual_gross_margin: null,
          actual_net_profit_cny: 0, actual_net_sales_cny: 0,
          actual_net_margin: null, pending_expense_orders: 0 };
        for (const order of summary.orders) {
          const stockId = stockByOrder.get(order.id);
          const allShipped = Boolean(stockId && order.items.length && order.items.every((item) =>
            stockItemByLine.get(stockId + ":" + String(item.line_number))?.shipped_quantity === item.quantity));
          if (allShipped) actualTotals.shipped_orders++;
          const actual = stockId ? actualOrderProfit(order.items.map((item) => ({
            stock_order_item_id: stockItemByLine.get(stockId + ":" + String(item.line_number))?.id || "",
            quantity: item.quantity, sales_cny: item.sales_cny,
          })), receipts, expensesByStock.get(stockId) || null,
          allShipped) : null;
          if (!actual) { actualTotals.pending_orders++; continue; }
          actualByOrder.set(order.id, actual);
          actualTotals.complete_orders++;
          actualTotals.product_sales_cny += actual.product_sales_cny;
          actualTotals.purchase_cost_cny += actual.purchase_cost_cny;
          actualTotals.actual_gross_profit_cny += actual.actual_gross_profit_cny;
          if (actual.actual_net_profit_cny === null) actualTotals.pending_expense_orders++;
          else {
            actualTotals.actual_net_profit_cny += actual.actual_net_profit_cny;
            actualTotals.actual_net_sales_cny += actual.product_sales_cny;
          }
        }
        actualTotals.actual_gross_margin = actualTotals.product_sales_cny > 0
          ? actualTotals.actual_gross_profit_cny / actualTotals.product_sales_cny * 100 : null;
        actualTotals.actual_net_margin = actualTotals.actual_net_sales_cny > 0
          ? actualTotals.actual_net_profit_cny / actualTotals.actual_net_sales_cny * 100 : null;
      }
    }
    let teamLeaderboard: Array<{ user_id: string; name: string; email: string; orders: number; customers: number; products: number; quantity: number; cny: number; usd: number; missing_cny: number; product_profit_cny: number; product_profit_usd: number; product_margin: number | null; missing_profit_orders: number; actual_profit?: ReturnType<typeof summarizeActualOrders> }> = [];
    if (includeTeamLeaderboard) {
      let ownerIds = [...new Set(scopedOrders.map((order) => order.sales_user_id))];
      if (teamOwnerIds) ownerIds = [...new Set([...ownerIds, ...teamOwnerIds])];
      if (account.role === "ADMIN" && selectedOwner === null) {
        const { data: activeSales, error } = await admin.from("users").select("id")
          .in("role", ["SALES", "SUPERVISOR"]).eq("status", "ACTIVE");
        if (error) throw error;
        ownerIds = [...new Set([...ownerIds, ...(activeSales || []).map((row) => String(row.id))])];
      }
      const ownerNames = new Map<string, { name: string; email: string; role: string }>();
      for (let index = 0; index < ownerIds.length; index += 100) {
        const { data, error } = await admin.from("users").select("id,name,email,role").in("id", ownerIds.slice(index, index + 100));
        if (error) throw error;
        for (const owner of data || []) ownerNames.set(String(owner.id), { name: String(owner.name || ""), email: String(owner.email || ""), role: String(owner.role || "") });
      }
      ownerIds = ownerIds.filter((ownerId) => {
        const owner = ownerNames.get(ownerId);
        return owner?.role === "SALES" || owner?.role === "SUPERVISOR";
      });
      teamLeaderboard = ownerIds.map((ownerId) => {
        const ownerRows = scopedOrders.filter((order) => order.sales_user_id === ownerId);
        const ownerOrders = orders.filter((order) => order.sales_user_id === ownerId);
        const ownerSummary = summarizePiPerformance(ownerOrders, ownerRows, ownerId);
        const owner = ownerNames.get(ownerId) || { name: "", email: "", role: "" };
        const actualProfit = actualTotals
          ? summarizeActualOrders(ownerSummary.orders.map((order) => order.id), actualByOrder)
          : undefined;
        return {
          user_id: ownerId, name: owner.name || owner.email || "未命名销售员", email: owner.email,
          orders: ownerSummary.totals.orders, customers: ownerSummary.customers.length, products: ownerSummary.products.length,
          quantity: ownerSummary.orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
          cny: ownerSummary.totals.cny, usd: ownerSummary.totals.usd, missing_cny: ownerSummary.totals.missing_cny,
          product_profit_cny: ownerSummary.totals.product_profit_cny, product_profit_usd: ownerSummary.totals.product_profit_usd,
          product_margin: ownerSummary.totals.product_margin,
          missing_profit_orders: ownerSummary.totals.missing_profit_orders,
          ...(actualProfit ? { actual_profit: actualProfit } : {}),
        };
      });
    }
    const { granularity: trendGranularity, periods: trendPeriods, bucketFor } = performanceTrendPeriods(from, to);
    const periodIndex = new Map(trendPeriods.map((period, index) => [period, index]));
    const buildTrend = (id: string, label: string, matches: (order: (typeof summary.orders)[number]) => boolean) => {
      const points = trendPeriods.map((period) => ({ period, orders: 0, cny: 0, usd: 0 }));
      for (const order of summary.orders) {
        if (!matches(order)) continue;
        const index = periodIndex.get(bucketFor(order.confirmed_at));
        if (index == null) continue;
        points[index].orders++;
        points[index].cny += order.total_cny || 0;
        points[index].usd += order.total_usd || 0;
      }
      return { id, label, points };
    };
    const sellerIds = [...new Set(summary.orders.map((order) => order.sales_user_id))];
    const sellerLabels = new Map<string, string>();
    if (includeTeamLeaderboard) {
      for (const row of teamLeaderboard) sellerLabels.set(row.user_id, row.name);
    }
    for (let index = 0; index < sellerIds.length; index += 100) {
      const missingNames = sellerIds.slice(index, index + 100).filter((id) => !sellerLabels.has(id));
      if (!missingNames.length) continue;
      const { data, error } = await admin.from("users").select("id,name,email").in("id", missingNames);
      if (error) throw error;
      for (const owner of data || []) sellerLabels.set(String(owner.id), String(owner.name || owner.email || "销售员"));
    }
    const sellerTotals = new Map<string, number>();
    for (const order of summary.orders) sellerTotals.set(order.sales_user_id, (sellerTotals.get(order.sales_user_id) || 0) + (order.total_cny || 0));
    const sellerRows = includeTeamLeaderboard
      ? teamLeaderboard
      : [...sellerTotals].map(([user_id, cny]) => ({ user_id, cny }));
    const sellerTrends = [...sellerRows].sort((a, b) => b.cny - a.cny || a.user_id.localeCompare(b.user_id))
      .slice(0, 5).map((seller) => buildTrend(seller.user_id, sellerLabels.get(seller.user_id) || "销售员", (order) => order.sales_user_id === seller.user_id));
    const customerTrends = summary.customers.slice(0, 5).map((customer) => {
      const customerKey = customer.id || customer.label;
      return buildTrend(customerKey, customer.label, (order) => (order.customer_id || order.customer_name) === customerKey);
    });
    const productTrends = summary.products.slice(0, 5).map((product) => {
      return { id: product.key, label: product.label,
        points: productTrendPoints(summary.orders, product.key, trendPeriods, bucketFor) };
    });
    return NextResponse.json({
      filters: { countries: countryOptions, customers: customerOptions },
      ...(actualTotals ? { actual_totals: actualTotals } : {}),
      trends: { granularity: trendGranularity, periods: trendPeriods, sellers: sellerTrends, top_customers: customerTrends, top_products: productTrends },
      team_leaderboard: { available: account.role === "SUPERVISOR" && account.supervisor_can_view_subordinates && hasPermission(account, "sales.performance.data_all"), selected: includeTeamLeaderboard, rows: teamLeaderboard },
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
        id: row.id, order_number: row.order_number, customer_order_number: customerOrderNumbers.get(row.id) || null, sales_user_id: row.sales_user_id, sales_user_name: sellerLabels.get(row.sales_user_id) || "销售员", customer_id: row.customer_id, customer_name: row.customer_name,
        currency: row.currency, total_amount: row.total_amount, total_cny: row.total_cny, total_usd: row.total_usd,
        product_sales_cny: row.product_sales_cny, product_profit_cny: row.product_profit_cny, product_profit_usd: row.product_profit_usd,
        product_margin: row.product_margin, missing_cost_lines: row.missing_cost_lines, actual_cost_lines: row.actual_cost_lines,
        ...(actualTotals ? { actual_profit: actualByOrder.has(row.id) ? {
          actual_net_profit_cny: actualByOrder.get(row.id)!.actual_net_profit_cny,
          actual_net_margin: actualByOrder.get(row.id)!.actual_net_margin,
        } : null } : {}),
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
