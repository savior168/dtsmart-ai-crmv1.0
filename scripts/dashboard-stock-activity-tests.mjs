import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardStockActivityText } from "../lib/dashboard-stock-activity.ts";

assert.equal(dashboardStockActivityText({ orderNumber: "D60151101", customerName: "Ifan Aditya",
  actorName: "Eva", actionDetail: "将备货状态从采购中更新为部分回货",
  statusLabel: "部分回货", orderedUnits: 10, receivedUnits: 4,
  preparedUnits: 2, shippedUnits: 0 }),
"Eva · 将备货状态从采购中更新为部分回货 · PI D60151101 · Ifan Aditya");
assert.match(dashboardStockActivityText({ orderNumber: "", customerName: "", actorName: "", actionDetail: "", statusLabel: "",
  orderedUnits: 0, receivedUnits: 0, preparedUnits: 0, shippedUnits: 0 }), /订单号未记录.*未命名客户.*待更新/);
const route = readFileSync(new URL("../app/api/dashboard/stats/route.ts", import.meta.url), "utf8");
assert.match(route, /text: dashboardStockActivityText\(/, "备货动态必须提供可见文字摘要");
assert.match(route, /\.gte\("updated_at".*\.lt\("updated_at"/, "动态时间必须是备货更新时间，不能使用 PI 修改时间");
assert.doesNotMatch(route, /text: ""/, "不得向工作台发送空白动态");
assert.match(route, /stock_order_events/, "备货动态应从状态事件读取实际操作");
assert.doesNotMatch(route, /stock_order_events\)\.select\([^\n]*note/, "工作台动态摘要不得拉取并展示长篇逐项操作备注");
assert.match(route, /warehouse_reference_number/, "动态应显示用户填写的订单号");
assert.doesNotMatch(route, /orderNumber: row\.order_number/, "动态不得把系统生成编号当作客户订单号");
console.log("dashboard stock activity text tests passed");
