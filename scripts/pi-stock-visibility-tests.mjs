import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const labels = {
  WAITING: "待仓库接单", PREPARING: "采购中", RECEIVED: "已回齐待理货",
  SORTING: "理货中", READY_TO_SHIP: "已理货待交货代",
  SHIPPED: "已交货代", SHORTAGE: "缺货异常", CANCELLED: "已取消",
};
const source = read("lib/orders/pi-stock-event-summary.ts");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports,
  require: (path) => path === "@/lib/types" ? { STOCK_STATUS_LABELS: labels } : assert.fail(`Unexpected import ${path}`) });
const summarize = module.exports.summarizePiStockEvents;
const events = [
  { id: "1", from_status: "WAITING", to_status: "PREPARING", note: "供应商代码 SECRET-1", created_by: "actor", created_at: "2026-11-18T00:00:00Z" },
  { id: "2", from_status: "PREPARING", to_status: "PREPARING", note: "仓库内部修改 SECRET-2", created_by: "actor", created_at: "2026-11-18T00:01:00Z" },
  { id: "3", from_status: "PREPARING", to_status: "READY_TO_SHIP", note: "交货代：部分产品；供应商 SECRET-3", created_by: "actor", created_at: "2026-11-18T00:02:00Z" },
  { id: "4", from_status: "READY_TO_SHIP", to_status: "SHIPPED", note: "交货代：全部产品；供应商 SECRET-4", created_by: "actor", created_at: "2026-11-18T00:03:00Z" },
];
const result = summarize(events);
assert.deepEqual(Array.from(result, (item) => item.label), ["采购中", "部分产品已交货代", "已交货代"]);
assert.equal(JSON.stringify(result).includes("SECRET"), false, "PI 进度摘要不得携带原始仓库备注");
assert.match(read("app/api/orders/[id]/route.ts"), /stock_events: stockEvents\.map/);
assert.match(read("app/api/stock-orders/[id]/route.ts"), /status_note: privateOrderNote\?\.data\?\.status_note \|\| null/);
assert.match(read("supabase/migrations/20261118133000_stock_internal_notes_server_only.sql"), /revoke select on public\.stock_orders, public\.stock_order_events/);
assert.match(read("supabase/migrations/20261118133000_stock_internal_notes_server_only.sql"), /null::text as status_note/g);
console.log("PI stock visibility tests passed");
