import assert from "node:assert/strict";
import { actualOrderProfit, actualReceiptCostByItem, completeActualCost, summarizeActualOrders } from "../lib/reports/actual-receipt-cost.ts";

const totals = actualReceiptCostByItem([
  { stock_order_item_id: "line-1", quantity: 3, purchase_unit_price_cny: 10 },
  { stock_order_item_id: "line-1", quantity: 2, purchase_unit_price_cny: 12 },
  { stock_order_item_id: "line-2", quantity: 1, purchase_unit_price_cny: 4 },
]);
assert.deepEqual(totals.get("line-1"), { quantity: 5, amount_cny: 54 });
assert.equal(completeActualCost(5, totals.get("line-1")), 54);
assert.equal(completeActualCost(6, totals.get("line-1")), null, "partial receipts cannot be called complete actual cost");
assert.equal(completeActualCost(5, undefined), null, "missing receipt ledger cannot be estimated as actual cost");
assert.deepEqual(actualReceiptCostByItem([
  { stock_order_item_id: "line-1", quantity: 5, purchase_unit_price_cny: 10 },
  { stock_order_item_id: "line-1", quantity: -2, purchase_unit_price_cny: 10 },
]).get("line-1"), { quantity: 3, amount_cny: 30 }, "reversal allocations reduce actual cost");
assert.throws(() => actualReceiptCostByItem([{ stock_order_item_id: "line-1", quantity: 1.5, purchase_unit_price_cny: 10 }]));
assert.throws(() => actualReceiptCostByItem([{ stock_order_item_id: "line-1", quantity: 1, purchase_unit_price_cny: 10.001 }]));
assert.deepEqual(actualReceiptCostByItem([
  { stock_order_item_id: "line-1", quantity: 3, purchase_unit_price_cny: 0.1 },
  { stock_order_item_id: "line-1", quantity: 2, purchase_unit_price_cny: 0.2 },
]).get("line-1"), { quantity: 5, amount_cny: 0.7 });
const profit = actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 100 }], totals,
  { packaging_cny: 2, shipping_cny: 3, other_cny: 1 }, true);
assert.equal(profit?.actual_gross_profit_cny, 46);
assert.equal(profit?.actual_net_profit_cny, 40);
assert.equal(profit?.actual_net_margin, 40, "net margin deducts all three fees exactly once");
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 0 }], totals,
  { packaging_cny: 0, shipping_cny: 0, other_cny: 0 }, true)?.actual_net_margin, null,
"zero sales must not produce a misleading net margin");
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 100 }], totals,
  { packaging_cny: 2, shipping_cny: 3, other_cny: 1 }, false)?.actual_net_profit_cny, null,
"partial handoff fees cannot be called final actual net profit");
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 6, sales_cny: 100 }], totals, null, true), null);
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: null }], totals, null, true), null);
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 100 }], totals, null, true)
  ?.actual_net_profit_cny, null, "missing warehouse expenses cannot be reported as actual net profit");
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 100 }], totals, null, true)
  ?.actual_net_margin, null, "missing expenses cannot produce a verified net margin");
assert.equal(actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 100 }], totals,
  { packaging_cny: -1, shipping_cny: 2, other_cny: 0 }, true), null);
const actualByOrder = new Map([
  ["order-1", profit],
  ["order-2", actualOrderProfit([{ stock_order_item_id: "line-1", quantity: 5, sales_cny: 100 }], totals, null, true)],
]);
assert.deepEqual(summarizeActualOrders(["order-1", "order-2", "order-3", "order-1"], actualByOrder), {
  complete_orders: 2,
  pending_orders: 1,
  gross_cny: 92,
  net_cny: 40,
  net_sales_cny: 100,
  net_margin: 40,
  complete_net_orders: 1,
  pending_expense_orders: 1,
});
console.log("Actual receipt cost tests passed.");
