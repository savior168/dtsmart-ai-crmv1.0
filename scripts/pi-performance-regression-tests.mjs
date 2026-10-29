import assert from "node:assert/strict";
import { performanceOwnerFilter, summarizePiPerformance } from "../lib/reports/pi-performance.ts";

const usdRate = 6.6619;
const rows = [
  {
    id: "usd-native", order_number: "PI-USD", customer_id: "customer-a", customer_name: "Alpha",
    sales_user_id: "seller-a", currency: "USD", total_amount: 100, confirmed_at: "2026-10-27T10:00:00Z",
    items: [{ item_name: "Phone", brand: "A", model: "M1", quantity: 2, amount: 80, unit_price_cny: 532.952, estimated_unit_cost_cny: 200, procurement_unit_cost_cny: 999 }],
  },
  {
    id: "eur-snapshot", order_number: "PI-EUR", customer_id: "customer-a", customer_name: "Alpha",
    sales_user_id: "seller-a", currency: "EUR", total_amount: 200, confirmed_at: "2026-10-28T10:00:00Z",
    items: [{ item_name: "Phone", brand: "A", model: "M1", quantity: 3, amount: 200, unit_price_cny: 400, estimated_unit_cost_cny: 250 }],
  },
  {
    id: "eur-no-snapshot", order_number: "PI-OLD", customer_id: "customer-b", customer_name: "Beta",
    sales_user_id: "seller-a", currency: "EUR", total_amount: 50, confirmed_at: "2026-10-29T10:00:00Z",
    items: [{ item_name: "Phone", brand: "A", model: "M1", quantity: 1, amount: 50, unit_price_cny: null, estimated_unit_cost_cny: 100 }],
  },
  {
    id: "missing-cost", order_number: "PI-COST", customer_id: "customer-b", customer_name: "Beta",
    sales_user_id: "seller-a", currency: "CNY", total_amount: 90, confirmed_at: "2026-10-29T11:00:00Z",
    items: [{ item_name: "Case", brand: "B", model: "C1", quantity: 1, amount: 90, unit_price_cny: 90, estimated_unit_cost_cny: null }],
  },
];
const metadata = rows.map((row) => ({
  id: row.id, total_cny: row.currency === "CNY" ? row.total_amount : row.id === "eur-no-snapshot" ? 333.095 : row.total_amount * (row.currency === "USD" ? usdRate : 7.8),
  fx_rate_cny_to_payment: 1, usd_cny_rate_snapshot: row.id === "eur-no-snapshot" ? null : usdRate,
  usd_rate_source_snapshot: row.id === "eur-no-snapshot" ? null : "BAIDU_FINSCOPE",
  usd_rate_reference_date_snapshot: row.id === "eur-no-snapshot" ? null : "2026-10-29",
  usd_rate_synced_at_snapshot: row.id === "eur-no-snapshot" ? null : "2026-10-29T03:00:00Z",
  archived_at: null, status: "WAITING_STOCK",
}));
const result = summarizePiPerformance(rows, metadata, null);
assert.equal(result.totals.orders, 4);
assert.equal(result.orders.find((order) => order.id === "usd-native").total_usd, 100, "USD-native PI revenue remains its native USD amount");
assert.equal(result.orders.find((order) => order.id === "eur-no-snapshot").total_usd, null, "missing historical FX must not use today's rate");
assert.equal(result.orders.find((order) => order.id === "eur-snapshot").total_usd, 1560 / usdRate);
assert.equal(result.orders.find((order) => order.id === "missing-cost").product_profit_cny, null);
assert.equal(result.totals.missing_profit_orders, 2);
assert.equal(result.totals.missing_usd, 1);
assert.equal(result.totals.product_margin, null, "overall margin must not disguise incomplete historical PI cost data as a complete rate");
const cnyPi = summarizePiPerformance([{
  id: "cny-pi-cost", order_number: "PI-CNY", customer_id: "customer-c", customer_name: "Gamma",
  sales_user_id: "seller-a", currency: "CNY", total_amount: 27000, confirmed_at: "2026-10-29T12:00:00Z",
  items: [{ item_name: "Screen", brand: "C", model: "S1", quantity: 20, amount: 27000, unit_price_cny: 1350, estimated_unit_cost_cny: 1130, procurement_unit_cost_cny: 1500 }],
}], [{
  id: "cny-pi-cost", total_cny: 27000, fx_rate_cny_to_payment: 1, usd_cny_rate_snapshot: null,
  usd_rate_source_snapshot: null, usd_rate_reference_date_snapshot: null, usd_rate_synced_at_snapshot: null,
  archived_at: null, status: "WAITING_STOCK",
}], null);
assert.equal(cnyPi.orders[0].cost_cny, 22600, "PI cost total is entered unit cost × quantity");
assert.equal(cnyPi.orders[0].product_profit_cny, 4400, "PI gross profit is product revenue minus PI cost total");
assert.equal(cnyPi.orders[0].product_margin, 4400 / 27000 * 100, "PI margin is gross profit divided by product revenue");
assert.equal(cnyPi.orders[0].product_profit_usd, null, "unknown historical USD rate must not produce a zero USD gross profit");
assert.equal(cnyPi.totals.product_margin, 4400 / 27000 * 100);
assert.equal(result.orders.find((order) => order.id === "usd-native").cost_cny, 400, "sales margin uses PI-entered unit cost × quantity, not later warehouse procurement cost");
assert.equal(result.orders.find((order) => order.id === "usd-native").product_profit_usd, 80 - (400 / usdRate));
assert.equal(result.customers.find((customer) => customer.id === "customer-a").order_count, 2);
assert.equal(result.customers.find((customer) => customer.id === "customer-b").missing_profit_usd_orders, 2,
  "customer-level USD profit completeness includes missing historical FX and missing cost");
assert.equal(result.products.find((product) => product.key === ["Phone", "A", "M1"].join("\u0000")).quantity, 6);
assert.deepEqual(performanceOwnerFilter("SALES", "seller-a", null), ["seller-a"]);
assert.equal(performanceOwnerFilter("ADMIN", "admin", null), null);
assert.deepEqual(performanceOwnerFilter("SUPERVISOR", "manager", "seller-a"), ["seller-a"]);
assert.equal(summarizePiPerformance(rows, metadata, "seller-missing").totals.orders, 0);
console.log("PI performance regression tests passed");
