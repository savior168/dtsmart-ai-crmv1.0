import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { physicalStockBuckets } from "../lib/stock-progress-math.ts";

const { STOCK_BUCKETS, STOCK_EXECUTING_STATUSES, PI_EXECUTING_STATUSES, stockProgressLabel, stockItemProgressKey, summarizeStockProgress } = createJiti(import.meta.url, { alias: { "@": process.cwd() } })("../lib/stock-progress.ts");
assert.deepEqual(STOCK_BUCKETS.map(({ key, color }) => [key, color]), [
  ["pending", "bg-slate-400"], ["purchasing", "bg-amber-500"], ["received", "bg-cyan-500"],
  ["prepared", "bg-violet-500"], ["shipped", "bg-emerald-500"],
]);
assert.equal(new Set(STOCK_BUCKETS.map(({ color }) => color)).size, 5, "五个互斥阶段应有五种不同颜色");
assert.ok(STOCK_BUCKETS.every(({ shortLabel }) => shortLabel.length <= 5), "紧凑图例名称须适合五项同排");
assert.deepEqual([...PI_EXECUTING_STATUSES], ["WAITING_STOCK", ...STOCK_EXECUTING_STATUSES], "PI执行中与备货执行中筛选只应相差待仓库接单阶段");
assert.equal(STOCK_BUCKETS[3].label, "已理货未交货代", "已理货部分不应被描述为完整产品行已经可以交货代");
const state = (status, received, prepared = 0, shipped = 0, preparation_status = status) =>
  summarizeStockProgress(status, [{ quantity: 10, received_quantity: received, prepared_quantity: prepared,
    shipped_quantity: shipped, preparation_status }]);
assert.equal(stockProgressLabel(state("WAITING", 0)), "待仓库接单");
assert.equal(stockProgressLabel(state("PREPARING", 0)), "采购中");
assert.equal(stockProgressLabel(state("PREPARING", 5)), "部分回货");
assert.equal(stockProgressLabel(state("PREPARING", 5, 2)), "部分回货，理货中");
const mixedSorting = summarizeStockProgress("SORTING", [
  { quantity: 20, received_quantity: 20, prepared_quantity: 5, preparation_status: "SORTING" },
  { quantity: 30, received_quantity: 10, prepared_quantity: 0, preparation_status: "PREPARING" },
]);
assert.equal(stockProgressLabel(mixedSorting), "部分回货，理货中", "整单既有部分回货又有正在理货的产品时，状态不应掩盖理货工作");
assert.deepEqual([mixedSorting.sorting_items, mixedSorting.sorting_prepared_units, mixedSorting.sorting_ordered_units], [1, 5, 20]);
assert.deepEqual(STOCK_BUCKETS.map(({ key }) => mixedSorting.buckets[key].units), [0, 20, 25, 5, 0], "理货中 5/20 件分别进入已理货和待理货的互斥实物阶段");
assert.equal(stockProgressLabel(state("RECEIVED", 10)), "已回齐待理货");
assert.equal(stockProgressLabel(state("SORTING", 10, 3)), "理货中");
assert.deepEqual([state("SORTING", 10, 3).sorting_items, state("SORTING", 10, 3).sorting_prepared_units,
  state("SORTING", 10, 3).sorting_ordered_units], [1, 3, 10], "理货中须单独显示项数及实际理货数量，但不重复计算第六个实物阶段");
assert.equal(stockProgressLabel(state("READY_TO_SHIP", 10, 10)), "已理货待交货代");
assert.equal(stockProgressLabel(state("READY_TO_SHIP", 10, 10, 3)), "部分已交货代");
assert.equal(stockProgressLabel(state("SHIPPED", 10, 10, 10)), "已交货代");
assert.equal(stockProgressLabel(state("SHORTAGE", 5)), "缺货异常");
assert.equal(stockProgressLabel(state("CANCELLED", 5)), "已取消");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 0, preparation_status: "WAITING" }), "WAITING");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 0, preparation_status: "PREPARING" }), "PURCHASING");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 4, preparation_status: "PREPARING" }), "PARTIAL_RECEIPT");
assert.equal(stockItemProgressKey({ quantity: 10, received_quantity: 4, prepared_quantity: 2, preparation_status: "SORTING" }), "PARTIAL_RECEIPT_SORTING");
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
const pendingAndPurchasing = physicalStockBuckets([
  { quantity: 120, received_quantity: 0, preparation_status: "WAITING" },
  { quantity: 175, received_quantity: 0, preparation_status: "PREPARING" },
]);
assert.deepEqual(pendingAndPurchasing.counts, [120, 175, 0, 0, 0]);
assert.deepEqual(pendingAndPurchasing.percents, [41, 59, 0, 0, 0]);
assert.equal(scenario.percents.reduce((sum, value) => sum + value, 0), 100);
assert.deepEqual(physicalStockBuckets([{ quantity: 1, received_quantity: 0 }, { quantity: 1, received_quantity: 1 },
  { quantity: 1, received_quantity: 1, prepared_quantity: 1 }]).percents, [34, 0, 33, 33, 0]);
assert.deepEqual(physicalStockBuckets([]).percents, [0, 0, 0, 0, 0]);
const mixedStatuses = [
  { quantity: 3, received_quantity: 0, prepared_quantity: 0, shipped_quantity: 0, preparation_status: "WAITING" },
  { quantity: 3, received_quantity: 0, prepared_quantity: 0, shipped_quantity: 0, preparation_status: "PREPARING" },
  { quantity: 3, received_quantity: 1, prepared_quantity: 0, shipped_quantity: 0, preparation_status: "PREPARING" },
  { quantity: 3, received_quantity: 2, prepared_quantity: 1, shipped_quantity: 0, preparation_status: "SORTING" },
  { quantity: 3, received_quantity: 3, prepared_quantity: 0, shipped_quantity: 0, preparation_status: "RECEIVED" },
  { quantity: 3, received_quantity: 3, prepared_quantity: 1, shipped_quantity: 0, preparation_status: "SORTING" },
  { quantity: 3, received_quantity: 3, prepared_quantity: 3, shipped_quantity: 0, preparation_status: "READY_TO_SHIP" },
  { quantity: 3, received_quantity: 3, prepared_quantity: 3, shipped_quantity: 3, preparation_status: "SHIPPED" },
];
for (const first of mixedStatuses) for (const second of mixedStatuses) for (const third of mixedStatuses) {
  const items = [first, second, third];
  const summary = summarizeStockProgress("PREPARING", items);
  const expected = items.reduce((counts, item) => {
    counts[item.preparation_status === "WAITING" ? 0 : 1] += item.quantity - item.received_quantity;
    counts[2] += item.received_quantity - item.prepared_quantity;
    counts[3] += item.prepared_quantity - item.shipped_quantity;
    counts[4] += item.shipped_quantity;
    return counts;
  }, [0, 0, 0, 0, 0]);
  assert.deepEqual(STOCK_BUCKETS.map(({ key }) => summary.buckets[key].units), expected);
  assert.equal(expected.reduce((sum, value) => sum + value, 0), summary.ordered_units);
  assert.equal(STOCK_BUCKETS.reduce((sum, { key }) => sum + summary.buckets[key].percent, 0), 100);
}
assert.throws(() => physicalStockBuckets([{ quantity: 5, received_quantity: 6 }]), /数量异常/);
assert.throws(() => physicalStockBuckets([{ quantity: 5, received_quantity: 3, prepared_quantity: 4 }]), /数量异常/);
console.log("stock quantity progress tests passed");
