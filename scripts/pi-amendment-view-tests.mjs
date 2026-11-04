import assert from "node:assert/strict";
import { warehousePiAmendment } from "../lib/orders/pi-amendment-view.ts";

const change = warehousePiAmendment({ id: "request", status: "PENDING", base_revision: 2,
  applied_revision: null, reason: "customer added goods", decision_note: null,
  created_at: "2026-11-03T00:00:00Z", decided_at: null,
  before_items: [{ id: "line-1", line_number: 1, item_name: "LCD", brand: "MAC",
    model: "A1", quality: "Original", quantity: 10, unit_price_cny: 100,
    estimated_unit_cost_cny: 60 }],
  proposed_items: [{ id: "line-1", item_name: "LCD", brand: "MAC", model: "A1",
    quality: "Original", quantity: 12, unit_price_cny: 120,
    estimated_unit_cost_cny: 70 },
  { id: "line-2", item_name: "Cable", brand: "MAC", model: "C1",
    quality: "Original", quantity: 2, unit_price_cny: 30,
    estimated_unit_cost_cny: 12 }],
});
assert.deepEqual(change.changes.map((item) => item.kind), ["修改", "新增"]);
assert.equal(change.changes[0].before?.quantity, 10);
assert.equal(change.changes[0].after?.quantity, 12);
assert.equal(change.changes[0].sales_price_changed, true);
assert.equal(change.changes[0].seller_cost_changed, true);
assert.equal(JSON.stringify(change).includes("unit_price_cny"), false);
assert.equal(JSON.stringify(change).includes("estimated_unit_cost_cny"), false);
console.log("Warehouse PI amendment display redaction passed.");
