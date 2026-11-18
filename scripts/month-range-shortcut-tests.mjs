import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { monthRange } from "../lib/reports/month-range.ts";

assert.deepEqual(monthRange(2026, 2, 2), { from: "2026-02-01", to: "2026-02-28" });
assert.deepEqual(monthRange(2024, 2, 2), { from: "2024-02-01", to: "2024-02-29" });
assert.deepEqual(monthRange(2026, 11, 12), { from: "2026-11-01", to: "2026-12-31" });
assert.throws(() => monthRange(2026, 12, 11));
assert.throws(() => monthRange(2026, 0, 1));

for (const component of ["orders-view", "sales-reports-view", "stock-orders-view", "supplier-reconciliation-view"]) {
  const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8");
  assert.match(source, /<CompactDateRange[^\r\n]*onMonthRangeApply=/, `${component} must integrate month selection in the date range`);
  assert.doesNotMatch(source, /<MonthRangeShortcut from=/, `${component} must not show a separate month control`);
}
const compactRange = readFileSync(new URL("../components/ui/compact-date-range.tsx", import.meta.url), "utf8");
assert.match(compactRange, /<MonthRangeShortcut from=\{from\} to=\{to\} onApply=\{onMonthRangeApply\} embedded\/>/);
const reconciliation = readFileSync(new URL("../components/supplier-reconciliation-view.tsx", import.meta.url), "utf8");
assert.match(reconciliation, /onMonthRangeApply=\{\(range\) => \{[\s\S]*?setFilters\(\{ \.\.\.range, supplierId, search: searchText\.trim\(\) \}\)/,
  "supplier reconciliation month selection must update the applied server-side filters");
console.log("Month range shortcut checks passed");
