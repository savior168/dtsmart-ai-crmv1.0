import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSupplierReconciliationCsv } from "../lib/suppliers/reconciliation-csv.ts";

const csv = renderSupplierReconciliationCsv([{
  document_date: "2026-11-03", supplier_code: "1011", supplier_name: '供货商"A',
  note_number: "DN-1", paper_total_cny: 30, allocated_cny: 30, cash_paid_reported_cny: 5,
  paid_cny: 10, unpaid_cny: 20, payments: [{ paid_on: "2026-11-03", method: "BANK", reference: "V-1", amount_cny: 10 }], allocations: [
    { pi_number: "D1", system_pi_number: "PI-1", product: "LCD", quantity: 1, unit_price_cny: 10, amount_cny: 10 },
    { pi_number: "D2", system_pi_number: "PI-2", product: "=HYPERLINK(\"bad\")", quantity: 2, unit_price_cny: 10, amount_cny: 20 },
  ],
}]);
assert.ok(csv.startsWith("\uFEFF"), "Excel UTF-8 export must include BOM");
const lines = csv.slice(1).split("\r\n");
assert.equal(lines.length, 3, "one delivery note with two PI allocations must export two detail rows");
assert.match(lines[1], /"D1","PI-1","LCD","1","10","10"/);
assert.match(lines[2], /"D2","PI-2","'=HYPERLINK\(""bad""\)"/,
  "spreadsheet formula-looking product text must be escaped");
assert.match(lines[1], /"供货商""A"/, "embedded CSV quotes must be doubled");
assert.match(lines[1], /"30","30","5","10","20","2026-11-03 BANK V-1 ¥10"$/,
  "note amounts and payment voucher must appear on the first allocation");
assert.match(lines[2], /"D2","PI-2".*"2","10","20","","","","","",""$/,
  "one paper note allocated to multiple PI lines must not double-count note-level totals");

const emptyAllocation = renderSupplierReconciliationCsv([{
  document_date: "2026-11-03", supplier_code: "CASH-1", note_number: "DN-2",
  allocated_cny: 0, paid_cny: 0, unpaid_cny: 0, allocations: [],
}]);
assert.equal(emptyAllocation.slice(1).split("\r\n").length, 2,
  "a note without allocation must remain visible in the reconciliation export");
assert.match(renderSupplierReconciliationCsv([{
  document_date: "2026-11-03", supplier_code: "1011", note_number: "DN-3",
  allocated_cny: -20, paid_cny: 0, unpaid_cny: -20,
  allocations: [{ pi_number: "D3", quantity: -2, unit_price_cny: 10, amount_cny: -20 }],
}]), /"-2","10","-20"/, "reversal quantities and amounts must remain numeric in Excel");
const reconciliationView = readFileSync(new URL("../components/supplier-reconciliation-view.tsx", import.meta.url), "utf8");
assert.match(reconciliationView, /for \(let page = 1; page <= 10000; page\+\+\)[\s\S]*?\/api\/suppliers\?page=\$\{page\}[\s\S]*?all\.length >= body\.count/,
  "the finance supplier filter must load every supplier page, not only the first 200 records");
assert.match(reconciliationView, /全历史另有[\s\S]*?此数不受上方日期筛选影响/,
  "historical receipts without delivery-note sources must not be presented as date-filtered balances");
assert.match(reconciliationView, /CompactDateRange label="送货日期"[\s\S]*?presets=\{BUSINESS_DATE_PRESETS\}/,
  "supplier reconciliation must share the dashboard date control and presets");
assert.match(reconciliationView, /onClick=\{\(\) => showSupplierNotes\(supplier\.supplier_id\)\}/,
  "supplier summary must drill into that supplier's actual purchase details");
assert.match(reconciliationView, /<h2 className="font-semibold">采购明细<\/h2>/,
  "delivery-note-level rows must be clearly identified as purchase details");
assert.match(reconciliationView, /setFilters\(\(current\) => \(\{ \.\.\.current, supplierId: id \}\)\)/,
  "supplier drill-down must apply the server-side supplier filter, not only filter one loaded page");
assert.match(reconciliationView, /缺纸单图片[\s\S]*?待录纸单金额[\s\S]*?金额有差异/,
  "purchase details must flag missing paper evidence and amount discrepancies separately");
assert.match(reconciliationView, /groups\.map\(\(group\)[\s\S]*?group\.items\.map/,
  "one physical delivery note must group multiple product allocations by PI without merging separate notes");
console.log("Supplier reconciliation CSV tests passed");
