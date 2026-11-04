import assert from "node:assert/strict";
import { diffPiAmendment } from "../lib/orders/pi-amendment-diff.ts";

const original = { id: "line-1", item_name: "LCD", brand: "MAC", model: "A2338",
  quality: "Original", quantity: 10, unit_price_cny: 120, estimated_unit_cost_cny: 100 };
const unchanged = diffPiAmendment([original], [{ ...original }], new Map());
assert.deepEqual(unchanged, []);
assert.deepEqual(diffPiAmendment([original], [], new Map()).map((change) => change.kind), ["REMOVED"]);
assert.deepEqual(diffPiAmendment([], [original], new Map()).map((change) => change.kind), ["ADDED"]);
const received = new Map([[original.id, { received_quantity: 6, shipped_quantity: 0 }]]);
const reduced = diffPiAmendment([original], [{ ...original, quantity: 5 }], received);
assert.equal(reduced[0].physical_reconciliation_required, true);
assert.equal(diffPiAmendment([original], [{ ...original, quantity: 8 }], received)[0].physical_reconciliation_required, false);
const qualitySwap = diffPiAmendment([original], [{ ...original, quality: "OEM" }], received);
assert.deepEqual(qualitySwap.map((change) => change.kind), ["REPLACED"]);
assert.equal(qualitySwap[0].physical_reconciliation_required, true);
assert.deepEqual(diffPiAmendment([original], [{ ...original, estimated_unit_cost_cny: 102 }], received)
  .map((change) => change.kind), ["PRICE"]);
assert.deepEqual(diffPiAmendment([original], [{ ...original, description_zh: "改用黑色包装" }], received)
  .map((change) => change.kind), ["SPEC"]);
assert.equal(diffPiAmendment([original], [{ ...original, description_zh: "改用黑色包装" }], received)[0]
  .physical_reconciliation_required, true);
assert.deepEqual(diffPiAmendment([original], [{ ...original, quality_en: "Refurbished" }], received)
  .map((change) => change.kind), ["REPLACED"]);
assert.throws(() => diffPiAmendment([original], [], new Map([[original.id,
  { received_quantity: 6, shipped_quantity: 1 }]])), /已有交货代/);
assert.throws(() => diffPiAmendment([original, original], [], new Map()), /重复行/);
assert.throws(() => diffPiAmendment([original], [], new Map([[original.id,
  { received_quantity: 11, shipped_quantity: 0 }]])), /备货进度无效/);
console.log("PI amendment diff tests passed.");
