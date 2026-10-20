import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quickCostDateRange } from "../lib/cost-center.ts";

const monday = new Date("2026-09-14T04:00:00.000Z");
assert.deepEqual(quickCostDateRange("TODAY", monday), { from: "2026-09-14", to: "2026-09-14" });
assert.deepEqual(quickCostDateRange("WEEK", monday), { from: "2026-09-14", to: "2026-09-14" });
assert.deepEqual(quickCostDateRange("MONTH", monday), { from: "2026-09-01", to: "2026-09-14" });

const sunday = new Date("2026-09-20T04:00:00.000Z");
assert.deepEqual(quickCostDateRange("WEEK", sunday), { from: "2026-09-14", to: "2026-09-20" }, "本周必须从周一开始，到当前上海日期结束");
const costView = readFileSync("components/cost-center-view.tsx", "utf8");
const reportsView = readFileSync("components/sales-reports-view.tsx", "utf8");
assert.match(costView, /<CompactDateRange label="费用日期"[\s\S]*presets=\{/);
assert.doesNotMatch(costView, /role="group" aria-label="费用日期快捷范围"/);
assert.match(reportsView, /<CompactDateRange label="业务日期"[\s\S]*presets=\{/);
assert.doesNotMatch(reportsView, /\[\["今天", "today"\], \["本周", "week"\], \["本月", "month"\]\]\.map/, "报表中心不应保留独立的快捷按钮排");
console.log("费用快捷日期范围回归测试通过。");
