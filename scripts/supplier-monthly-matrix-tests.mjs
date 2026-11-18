import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReconciliationMatrix, renderSupplierMonthlyCsv } from "../lib/suppliers/reconciliation-matrix.ts";

const suppliers = [
  { supplier_id: "a", allocated_cny: 120.1, paid_cny: 20, unpaid_cny: 100.1 },
  { supplier_id: "b", allocated_cny: -5, paid_cny: 0, unpaid_cny: -5 },
];
const monthly = [
  { supplier_id: "a", month: "2026-03-01", allocated_cny: 100.1, paid_cny: 20, unpaid_cny: 80.1 },
  { supplier_id: "a", month: "2026-04-01", allocated_cny: 20, paid_cny: 0, unpaid_cny: 20 },
  { supplier_id: "b", month: "2026-04-01", allocated_cny: -5, paid_cny: 0, unpaid_cny: -5 },
];

const allocated = buildReconciliationMatrix(suppliers, monthly, "allocated_cny");
assert.deepEqual(allocated.months, ["2026-03", "2026-04"]);
assert.equal(allocated.cellCents.get("a:2026-03"), 10010);
assert.equal(allocated.cellCents.get("b:2026-03"), undefined, "缺少记录不能误显示为零金额");
assert.equal(allocated.cellCents.get("b:2026-04"), -500, "冲正负数必须保留");
assert.equal(allocated.monthCents.get("2026-04"), 1500);
assert.equal(allocated.periodCents, 11510);
assert.equal(allocated.consistent, true);
assert.equal(buildReconciliationMatrix(suppliers, monthly, "paid_cny").periodCents, 2000);
assert.equal(buildReconciliationMatrix(suppliers, monthly, "unpaid_cny").periodCents, 9510);
assert.equal(buildReconciliationMatrix(suppliers, monthly.slice(1), "allocated_cny").consistent, false,
  "缺失月份时不能悄悄报告平衡");
const csv = renderSupplierMonthlyCsv([
  { ...suppliers[0], system_code: "a", supplier_name: "=DANGEROUS" },
  { ...suppliers[1], system_code: "b", supplier_name: "供应商B" },
], monthly, "allocated_cny");
assert.match(csv, /^\uFEFF/);
assert.match(csv, /"'=DANGEROUS"/, "导出不得让供应商名称执行电子表格公式");
assert.match(csv, /"-5"/, "负数冲正应作为数值导出");
assert.throws(() => renderSupplierMonthlyCsv([{ ...suppliers[0], system_code: "a", supplier_name: null }], monthly, "allocated_cny"), /不一致/);
const view = readFileSync(new URL("../components/supplier-reconciliation-view.tsx", import.meta.url), "utf8");
const matrixView = readFileSync(new URL("../components/supplier-monthly-matrix.tsx", import.meta.url), "utf8");
assert.match(matrixView, /onClick=\{\(\) => onDrill\(supplierId, month\)\}/,
  "month totals must drill into the current supplier scope for that month");
assert.match(matrixView, /不代表该月实际付款额/,
  "paid amounts grouped by delivery-note month must not be mistaken for payment-date cash flow");
assert.match(view, /function drillToMonth[\s\S]*setFilters\(next\)/, "点击月份须更新真正的后端筛选条件");
assert.match(view, /function returnToMatrix[\s\S]*setFilters\(matrixOrigin\)/, "下钻后须能恢复原统计范围");
assert.match(view, /<SupplierMonthlyMatrix[\s\S]*onDrill=\{drillToMonth\}/, "供应商月度矩阵须接入对账页面");
assert.match(view, /canViewDocuments && !note\.attachments\?\.length/, "无纸单查看权限不能误报缺少纸单");

console.log("Supplier monthly matrix checks passed");
