import assert from "node:assert/strict";
import { quickCostDateRange } from "../lib/cost-center.ts";

const monday = new Date("2026-09-14T04:00:00.000Z");
assert.deepEqual(quickCostDateRange("TODAY", monday), { from: "2026-09-14", to: "2026-09-14" });
assert.deepEqual(quickCostDateRange("WEEK", monday), { from: "2026-09-14", to: "2026-09-14" });
assert.deepEqual(quickCostDateRange("MONTH", monday), { from: "2026-09-01", to: "2026-09-14" });

const sunday = new Date("2026-09-20T04:00:00.000Z");
assert.deepEqual(quickCostDateRange("WEEK", sunday), { from: "2026-09-14", to: "2026-09-20" }, "本周必须从周一开始，到当前上海日期结束");
console.log("费用快捷日期范围回归测试通过。");
