import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { physicalStockBuckets } from "../lib/stock-progress-math.ts";

const { stockProgressLabel, stockItemProgressKey, summarizeStockProgress } = createJiti(import.meta.url, { alias: { "@": process.cwd() } })("../lib/stock-progress.ts");
const state = (status, received, prepared = 0, shipped = 0, preparation_status = status) =>
  summarizeStockProgress(status, [{ quantity: 10, received_quantity: received, prepared_quantity: prepared,
    shipped_quantity: shipped, preparation_status }]);
assert.equal(stockProgressLabel(state("WAITING", 0)), "待仓库接单");
assert.equal(stockProgressLabel(state("PREPARING", 0)), "采购中");
assert.equal(stockProgressLabel(state("PREPARING", 5)), "部分回货");
assert.equal(stockProgressLabel(state("PREPARING", 5, 2)), "部分回货");
assert.equal(stockProgressLabel(state("RECEIVED", 10)), "已回齐待理货");
assert.equal(stockProgressLabel(state("SORTING", 10, 3)), "理货中");
assert.equal(stockProgressLabel(state("READY_TO_SHIP", 10, 10)), "已理货待交货代");
assert.equal(stockProgressLabel(state("READY_TO_SHIP", 10, 10, 3)), "部分已交货代");
assert.equal(stockProgressLabel(state("SHIPPED", 10, 10, 10)), "已交货代");
assert.equal(stockProgressLabel(state("SHORTAGE", 5)), "缺货异常");
assert.equal(stockProgressLabel(state("CANCELLED", 5)), "已取消");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 0, preparation_status: "WAITING" }), "WAITING");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 0, preparation_status: "PREPARING" }), "PURCHASING");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 4, preparation_status: "PREPARING" }), "PARTIAL_RECEIPT");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 10, prepared_quantity: 0 }), "RECEIVED");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 10, prepared_quantity: 4 }), "SORTING");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 10, prepared_quantity: 10 }), "READY_TO_SHIP");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 10, prepared_quantity: 10, shipped_quantity: 10 }), "SHIPPED");

const scenario = physicalStockBuckets([
  { quantity: 30, received_quantity: 0, prepared_quantity: 0, shipped_quantity: 0, preparation_status: "WAITING" },
  { quantity: 20, received_quantity: 10, prepared_quantity: 0, shipped_quantity: 0, preparation_status: "PREPARING" },
  { quantity: 20, received_quantity: 20, prepared_quantity: 10, shipped_quantity: 0, preparation_status: "SORTING" },
  { quantity: 100, received_quantity: 100, prepared_quantity: 100, shipped_quantity: 0, preparation_status: "READY_TO_SHIP" },
  { quantity: 50, received_quantity: 50, prepared_quantity: 50, shipped_quantity: 50, preparation_status: "SHIPPED" },
  { quantity: 80, received_quantity: 40, prepared_quantity: 20, shipped_quantity: 0, preparation_status: "PREPARING" },
]);
assert.equal(scenario.ordered, 300);
assert.deepEqual(scenario.counts, [30, 50, 40, 130, 50]);
assert.equal(scenario.percents.reduce((sum, value) => sum + value, 0), 100);
assert.deepEqual(physicalStockBuckets([{ quantity: 1, received_quantity: 0 }, { quantity: 1, received_quantity: 1 },
  { quantity: 1, received_quantity: 1, prepared_quantity: 1 }]).percents, [34, 0, 33, 33, 0]);
assert.deepEqual(physicalStockBuckets([]).percents, [0, 0, 0, 0, 0]);
assert.throws(() => physicalStockBuckets([{ quantity: 5, received_quantity: 6 }]), /数量异常/);
assert.throws(() => physicalStockBuckets([{ quantity: 5, received_quantity: 3, prepared_quantity: 4 }]), /数量异常/);
console.log("stock quantity progress tests passed");
