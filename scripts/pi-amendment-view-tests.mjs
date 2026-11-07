import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { warehousePiAmendment } from "../lib/orders/pi-amendment-view.ts";

const amendmentUi = readFileSync(new URL("../components/pi-amendment-panels.tsx", import.meta.url), "utf8");
const orderFormUi = readFileSync(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
for (const [name, source] of [["PI变更", amendmentUi], ["PI创建", orderFormUi]]) {
  assert.ok(source.includes('...(currency !== "CNY" ? [`销售单价（'), `${name}应仅在外币单据显示外币单价列`);
  assert.ok(source.includes('...(currency !== "CNY" ? [`销售金额（'), `${name}应仅在外币单据显示外币金额列`);
}
assert.match(amendmentUi, /\{currency !== "CNY" \? <td className="whitespace-nowrap px-2 py-1\.5">\{currency\}/, "CNY单据不得重复显示付款币种单价");
assert.match(amendmentUi, /\{currency !== "CNY" \? <td className="whitespace-nowrap px-2 py-1\.5 font-medium text-blue-700">/, "CNY单据不得重复显示付款币种金额");
assert.match(orderFormUi, /\{currency !== "CNY" \? <td className="px-1\.5 py-1\.5"><input aria-label=\{`第\$\{index \+ 1\}行\$\{currency\}单价`\}/, "CNY单据不得重复显示付款币种单价输入");
assert.match(orderFormUi, /\{currency !== "CNY" \? <td className="whitespace-nowrap px-2 py-1\.5 font-medium text-blue-700">/, "CNY单据不得重复显示付款币种金额");

const change = warehousePiAmendment({ id: "request", status: "PENDING", base_revision: 2,
  applied_revision: null, reason: "customer added goods", decision_note: null,
  created_at: "2026-11-03T00:00:00Z", decided_at: null,
  before_items: [{ id: "line-1", line_number: 1, item_name: "LCD", brand: "MAC",
    model: "A1", quality: "Original", quantity: 10, unit_price_cny: 100,
    estimated_unit_cost_cny: 60 }],
  proposed_items: [{ id: "line-1", item_name: "LCD", brand: "MAC", model: "A1",
    quality: "Original", quantity: 12, unit_price_cny: 120,
    estimated_unit_cost_cny: 70 },
  { id: "line-2", item_name: "Cable", brand: "MAC", model: "C1",
    quality: "Original", quantity: 2, unit_price_cny: 30,
    estimated_unit_cost_cny: 12 }],
});
assert.deepEqual(change.changes.map((item) => item.kind), ["修改", "新增"]);
assert.equal(change.changes[0].before?.quantity, 10);
assert.equal(change.changes[0].after?.quantity, 12);
assert.equal(change.changes[0].sales_price_changed, true);
assert.equal(change.changes[0].seller_cost_changed, true);
assert.equal(JSON.stringify(change).includes("unit_price_cny"), false);
assert.equal(JSON.stringify(change).includes("estimated_unit_cost_cny"), false);
console.log("Warehouse PI amendment display redaction passed.");
