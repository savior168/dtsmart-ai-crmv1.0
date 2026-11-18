import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvCell } from "../lib/suppliers/reconciliation-csv.ts";

assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
assert.equal(csvCell('供货商"A'), '"供货商""A"');
assert.equal(csvCell(10), '"10"');
const reconciliationView = readFileSync(new URL("../components/supplier-reconciliation-view.tsx", import.meta.url), "utf8");
const reconciliationApi = readFileSync(new URL("../app/api/supplier-reconciliation/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(reconciliationView, /exportCsv|导出当前筛选 CSV/,
  "the incomplete finance reconciliation CSV export must not be offered");
assert.doesNotMatch(reconciliationApi, /format === "csv"|renderSupplierReconciliationCsv/,
  "the incomplete finance reconciliation CSV API must be disabled");
assert.match(reconciliationView, /for \(let page = 1; page <= 10000; page\+\+\)[\s\S]*?\/api\/suppliers\?page=\$\{page\}[\s\S]*?all\.length >= body\.count/,
  "the finance supplier filter must load every supplier page, not only the first 200 records");
assert.doesNotMatch(reconciliationView, /legacyUnlinked|全历史另有/,
  "historical supplier-source remediation must not appear on the finance reconciliation page");
const warehouseQueue = readFileSync(new URL("../components/missing-stock-documents-view.tsx", import.meta.url), "utf8");
assert.match(warehouseQueue, /LegacySupplierSourcesView/,
  "the warehouse missing-document queue must expose historical supplier-source remediation");
const warehousePage = readFileSync(new URL("../app/stock-orders/missing-documents/page.tsx", import.meta.url), "utf8");
const legacyApi = readFileSync(new URL("../app/api/stock-orders/legacy-receipt-sources/route.ts", import.meta.url), "utf8");
const legacyMigration = readFileSync(new URL("../supabase/migrations/20261118044017_link_legacy_supplier_receipt_source.sql", import.meta.url), "utf8");
assert.match(warehousePage, /showLegacySources=\{account\.role === "WAREHOUSE"\}/);
assert.match(legacyApi, /context\.account\.role !== "WAREHOUSE"/);
assert.match(legacyMigration, /actor\.role <> 'WAREHOUSE'/);
assert.match(legacyMigration, /remaining := baseline\.quantity-p_quantity;[\s\S]*?delete from public\.supplier_receipt_legacy_baselines[\s\S]*?update public\.supplier_receipt_legacy_baselines/,
  "legacy source attribution must consume existing baseline rather than increase physical receipts");
assert.doesNotMatch(legacyMigration, /update public\.stock_order_items set received_quantity/,
  "attributing existing receipts must not increment received stock");
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
assert.match(reconciliationView, /page_size: String\(pageSize\)/,
  "purchase detail page size must be sent to the reconciliation API");
assert.match(reconciliationView, /sequence !== loadSequence\.current/,
  "stale reconciliation responses must not overwrite newer date, supplier or page selections");
assert.match(reconciliationView, /<AppPagination[^>]*pageSize=\{pageSize\}[^>]*itemLabel="张送货单"/,
  "purchase details must use the shared pagination component");
const reconciliationRoute = readFileSync(new URL("../app/api/supplier-reconciliation/route.ts", import.meta.url), "utf8");
assert.match(reconciliationRoute, /\[10, 20, 50, 100\]\.includes\(pageSize\)/,
  "the API must validate supported page sizes");
assert.match(reconciliationRoute, /p_limit: pageSize, p_offset: \(page - 1\) \* pageSize/,
  "the API must page by the selected size without affecting summary totals");
console.log("Supplier reconciliation CSV tests passed");
