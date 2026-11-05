import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardStockActivityText } from "../lib/dashboard-stock-activity.ts";

assert.equal(dashboardStockActivityText({ piNumber: "D60151101", customerName: "Ifan Aditya",
  statusLabel: "部分回货", orderedUnits: 10, receivedUnits: 4,
  preparedUnits: 2, shippedUnits: 0 }),
"PI D60151101 · Ifan Aditya：备货最新状态为部分回货，回货 4/10、理货 2/10、交货代 0/10 件");
assert.match(dashboardStockActivityText({ piNumber: "", customerName: "", statusLabel: "",
  orderedUnits: 0, receivedUnits: 0, preparedUnits: 0, shippedUnits: 0 }), /未编号.*未命名客户.*待更新/);
const route = readFileSync(new URL("../app/api/dashboard/stats/route.ts", import.meta.url), "utf8");
assert.match(route, /text: dashboardStockActivityText\(/, "备货动态必须提供可见文字摘要");
assert.match(route, /\.gte\("updated_at".*\.lt\("updated_at"/, "动态时间必须是备货更新时间，不能使用 PI 修改时间");
assert.doesNotMatch(route, /text: ""/, "不得向工作台发送空白动态");
console.log("dashboard stock activity text tests passed");
