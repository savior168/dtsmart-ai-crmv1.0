import assert from "node:assert/strict";
import { physicalStockBuckets } from "../lib/stock-progress-math.ts";

const scenario = physicalStockBuckets([
  { quantity: 30, received_quantity: 0, prepared_quantity: 0, shipped_quantity: 0 },
  { quantity: 20, received_quantity: 10, prepared_quantity: 0, shipped_quantity: 0 },
  { quantity: 20, received_quantity: 20, prepared_quantity: 10, shipped_quantity: 0 },
  { quantity: 100, received_quantity: 100, prepared_quantity: 100, shipped_quantity: 0 },
  { quantity: 50, received_quantity: 50, prepared_quantity: 50, shipped_quantity: 50 },
  { quantity: 80, received_quantity: 40, prepared_quantity: 20, shipped_quantity: 0 },
]);
assert.equal(scenario.ordered, 300);
assert.deepEqual(scenario.counts, [80, 40, 130, 50]);
assert.equal(scenario.percents.reduce((sum, value) => sum + value, 0), 100);
assert.deepEqual(physicalStockBuckets([{ quantity: 1, received_quantity: 0 }, { quantity: 1, received_quantity: 1 },
  { quantity: 1, received_quantity: 1, prepared_quantity: 1 }]).percents, [34, 33, 33, 0]);
assert.deepEqual(physicalStockBuckets([]).percents, [0, 0, 0, 0]);
assert.throws(() => physicalStockBuckets([{ quantity: 5, received_quantity: 6 }]), /数量异常/);
assert.throws(() => physicalStockBuckets([{ quantity: 5, received_quantity: 3, prepared_quantity: 4 }]), /数量异常/);
console.log("stock quantity progress tests passed");
