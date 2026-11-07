import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sellerCostReviewLineNumbers } from "../lib/orders/seller-cost-review.ts";

const stock = [{ id: "stock-a", line_number: 1, quantity: 3 }, { id: "stock-b", line_number: 2, quantity: 2 }];
const sales = [{ id: "sales-a", line_number: 1, estimated_unit_cost_cny: 100 }, { id: "sales-b", line_number: 2, estimated_unit_cost_cny: 100 }];

assert.deepEqual(sellerCostReviewLineNumbers(stock, sales, [
  { stock_order_item_id: "stock-a", quantity: 1, purchase_unit_price_cny: 110 },
  { stock_order_item_id: "stock-a", quantity: 2, purchase_unit_price_cny: 100 },
]), [1], "weighted full receipt above estimate is eligible");
assert.deepEqual(sellerCostReviewLineNumbers(stock, sales, [
  { stock_order_item_id: "stock-a", quantity: 1, purchase_unit_price_cny: 110 },
  { stock_order_item_id: "stock-a", quantity: 2, purchase_unit_price_cny: 95 },
]), [], "one high supplier price does not trigger when weighted average is equal");
assert.deepEqual(sellerCostReviewLineNumbers(stock, sales, [
  { stock_order_item_id: "stock-a", quantity: 1, purchase_unit_price_cny: 140 },
  { stock_order_item_id: "stock-a", quantity: 2, purchase_unit_price_cny: 80 },
  { stock_order_item_id: "stock-b", quantity: 2, purchase_unit_price_cny: 100 },
]), [], "equal or lower weighted purchase prices are not eligible");
assert.deepEqual(sellerCostReviewLineNumbers(stock, sales, [
  { stock_order_item_id: "stock-a", quantity: 2, purchase_unit_price_cny: 130 },
]), [], "partial receipts are not eligible");
assert.deepEqual(sellerCostReviewLineNumbers(stock, sales, [
  { stock_order_item_id: "stock-a", quantity: 3, purchase_unit_price_cny: 120 },
  { stock_order_item_id: "stock-a", quantity: -1, purchase_unit_price_cny: 120 },
  { stock_order_item_id: "stock-a", quantity: 1, purchase_unit_price_cny: 60 },
]), [], "signed corrections must net to the full ordered quantity");
assert.deepEqual(sellerCostReviewLineNumbers(
  [{ ...stock[0], pi_amendment_cancelled_at: "2026-11-07T00:00:00Z" }], sales,
  [{ stock_order_item_id: "stock-a", quantity: 3, purchase_unit_price_cny: 120 }],
), [], "cancelled amendment lines are excluded");

const migration = readFileSync("supabase/migrations/20261107084928_gate_seller_cost_review_by_actual_purchase.sql", "utf8");
assert.match(migration, /target\.warehouse_reference_number/, "notification uses the user-entered D reference");
assert.match(migration, /string_agg\(s\.line_number::text/, "notification identifies affected product lines");
assert.match(migration, /target\.prepared_by,target\.sales_user_id/, "notifications target preparer and owner");
assert.match(migration, /round\(actual\.purchase_amount\/actual\.received_quantity,2\)>p\.estimated_unit_cost_cny/, "only a higher line-level weighted purchase average triggers notification");
assert.match(migration, /仅当产品完整回货后的数量加权采购单价高于销售成本时/, "server-side review endpoint enforces weighted-price eligibility");
assert.match(migration, /supplier_receipt_allocations/, "comparison is based on supplier purchase-price ledger only");

const detailRoute = readFileSync("app/api/orders/[id]/route.ts", "utf8");
assert.match(detailRoute, /sellerCostReviewLineNumbers\(/, "detail API computes reviewable line numbers");
const component = readFileSync("components/order-detail-view.tsx", "utf8");
assert.match(component, /seller_cost_review_line_numbers\.includes\(i\.line_number\)/, "review action is only shown for eligible lines");

console.log("Seller cost review eligibility checks passed.");
