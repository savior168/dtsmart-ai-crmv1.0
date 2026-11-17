import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { warehousePiAmendment } from "../lib/orders/pi-amendment-view.ts";
import { latestAppliedPiAmendmentHighlights } from "../lib/orders/pi-amendment-highlights.ts";

const amendmentUi = readFileSync(new URL("../components/pi-amendment-panels.tsx", import.meta.url), "utf8");
const orderFormUi = readFileSync(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
for (const [name, source] of [["PI变更", amendmentUi], ["PI创建", orderFormUi]]) {
  assert.ok(source.includes('...(currency !== "CNY" ? [`销售单价（'), `${name}应仅在外币单据显示外币单价列`);
  assert.ok(source.includes('...(currency !== "CNY" ? [`销售金额（'), `${name}应仅在外币单据显示外币金额列`);
}
assert.match(amendmentUi, /\{currency !== "CNY" \? <td className="whitespace-nowrap px-2 py-1\.5">\{currency\}/, "CNY单据不得重复显示付款币种单价");
assert.match(amendmentUi, /\{currency !== "CNY" \? <td className="whitespace-nowrap px-2 py-1\.5 font-medium text-blue-700">/, "CNY单据不得重复显示付款币种金额");
for (const field of ["成本单价", "销售单价"]) {
  assert.ok(amendmentUi.includes(`disabled={isLocked} aria-label={\`第\${index + 1}行${field}`), `${field}应允许未交货代的已有PI行申请更正，同时锁定已交货代行`);
}
assert.match(amendmentUi, /parsePiProductRows\(parsePiClipboardTsv\(text\), fxRate, currency\)/, "PI变更粘贴须复用创建PI的表格解析与币种规则");
assert.match(amendmentUi, /setDraft\(\(current\) => current \? \[\.\.\.current, \.\.\.additions\] : current\)/, "粘贴只追加新产品，不得覆盖已有或已交货代产品");
assert.match(amendmentUi, /if \(draft\.length \+ parsed\.length > 500\)/, "粘贴须遵守PI产品行数上限");
assert.ok(amendmentUi.includes('title="粘贴产品明细"'), "剪贴板权限不可用时须提供手动粘贴入口");
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
const applied = { id: "applied", status: "APPLIED", base_revision: 1, applied_revision: 2,
  reason: "调整产品", decision_note: null, created_at: "2026-11-03T00:00:00Z", decided_at: "2026-11-03T01:00:00Z",
  before_items: [{ id: "changed", quantity: 2, unit_price_cny: 100 }, { id: "removed", quantity: 1 }],
  proposed_items: [{ id: "changed", quantity: 3, unit_price_cny: 100 }, { id: "added", quantity: 1 }] };
assert.deepEqual([...latestAppliedPiAmendmentHighlights([applied, { ...applied, id: "pending", status: "PENDING", applied_revision: null,
  proposed_items: [{ id: "unapproved", quantity: 1 }] }])],
  [["changed", "CHANGED"], ["removed", "REMOVED"], ["added", "ADDED"]],
  "仅最近一次已生效变更可影响PI及仓库产品行颜色");
console.log("Warehouse PI amendment display redaction passed.");
