import assert from "node:assert/strict";
import { teamContribution } from "../lib/reports/team-contribution.ts";
import { businessDatePreset } from "../lib/reports/date-presets.ts";
import { productTrendPoints } from "../lib/reports/product-trend.ts";
import { performanceTrendPeriods } from "../lib/reports/performance-trend-periods.ts";

const rows = [
  { cny: 27000, missing_cny: 0, product_profit_cny: 4400, missing_profit_orders: 0 },
  { cny: 73000, missing_cny: 0, product_profit_cny: 5600, missing_profit_orders: 0 },
];
assert.deepEqual(teamContribution(rows), [
  { salesShare: 27, profitShare: 44 },
  { salesShare: 73, profitShare: 56 },
]);
assert.equal(teamContribution([{ cny: 0, missing_cny: 0, product_profit_cny: -100, missing_profit_orders: 0 }])[0].profitShare, null);
assert.equal(teamContribution([{ cny: 100, missing_cny: 0, product_profit_cny: 0, missing_profit_orders: 1 }])[0].profitShare, null);
assert.equal(teamContribution([{ cny: 100, missing_cny: 1, product_profit_cny: 20, missing_profit_orders: 0 }])[0].salesShare, null);
const monday = new Date(2026, 10, 2, 12);
assert.deepEqual(businessDatePreset("week", monday), { from: "2026-11-02", to: "2026-11-02" });
assert.deepEqual(businessDatePreset("quarter", monday), { from: "2026-10-01", to: "2026-11-02" });
assert.deepEqual(businessDatePreset("today", new Date("2026-11-01T17:00:00Z")), { from: "2026-11-02", to: "2026-11-02" });
const productA = ["LCD", "FOR IPH", "17 PM"].join("\u0000");
const lines = productTrendPoints([{ confirmed_at: "2026-11-02T05:00:00Z", items: [
  { item_name: "LCD", brand: "FOR IPH", model: "17 PM", sales_cny: 1200, sales_usd: 180 },
  { item_name: "Battery", brand: "FOR IPH", model: "17 PM", sales_cny: 800, sales_usd: 120 },
] }], productA, ["2026-11-02"], (value) => value.slice(0, 10));
assert.deepEqual(lines, [{ period: "2026-11-02", orders: 1, cny: 1200, usd: 180 }]);
const daily = performanceTrendPeriods("2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z");
assert.deepEqual(daily.periods, ["2026-11-02"]);
assert.equal(daily.bucketFor("2026-11-01T16:30:00.000Z"), "2026-11-02");
assert.equal(daily.bucketFor("2026-11-02T15:59:59.999Z"), "2026-11-02");
const monthBoundary = performanceTrendPeriods("2026-10-30T16:00:00.000Z", "2026-11-02T16:00:00.000Z");
assert.deepEqual(monthBoundary.periods, ["2026-10-31", "2026-11-01", "2026-11-02"]);
console.log("Team contribution tests passed");
