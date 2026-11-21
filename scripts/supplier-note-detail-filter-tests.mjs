import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("../components/supplier-reconciliation-view.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/supplier-reconciliation/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261121150000_supplier_note_detail_filters.sql", import.meta.url), "utf8");
const statuses = readFileSync(new URL("../lib/suppliers/note-check-status.ts", import.meta.url), "utf8");
const paperMigration = readFileSync(new URL("../supabase/migrations/20261121173000_supplier_paper_total_includes_packaging.sql", import.meta.url), "utf8");
const verificationMigration = readFileSync(new URL("../supabase/migrations/20261121190000_supplier_paper_verification.sql", import.meta.url), "utf8");
const sortMigration = readFileSync(new URL("../supabase/migrations/20261121200000_supplier_reconciliation_detail_sort.sql", import.meta.url), "utf8");
const verifyRoute = readFileSync(new URL("../app/api/supplier-reconciliation/notes/[id]/verify/route.ts", import.meta.url), "utf8");
const ledger = readFileSync(new URL("../components/supplier-account-ledger.tsx", import.meta.url), "utf8");

for (const status of ["NUMBER_PENDING", "PHOTO_MISSING", "AMOUNT_PENDING", "AMOUNT_MISMATCH", "MATCHED", "NEEDS_ATTENTION"]) {
  assert.match(statuses, new RegExp(status));
  assert.match(migration, new RegExp(status));
}
assert.match(view, /按采购明细核对状态筛选/);
assert.match(view, /params\.set\("check_status", filters\.checkStatus\)/);
assert.match(view, /params\.set\("amount_focus", filters\.amountFocus\)/);
assert.match(view, /total=\{detailCount\}/);
assert.match(view, /focusDetail\("PAID"\)/);
assert.match(view, /focusDetail\("UNPAID"\)/);
assert.match(api, /p_check_status: checkStatus \|\| null/);
assert.match(api, /p_amount_focus: amountFocus \|\| null/);
assert.match(api, /checkStatusRequiresDocuments\(checkStatus\)/);
assert.match(migration, /from \(select \* from matching_notes order by document_date desc,id desc/);
assert.match(migration, /''detail_count'', \(select count\(\*\) from matching_notes\)/);
assert.match(migration, /definition := pg_get_functiondef\(source_signature::regprocedure\)/);
assert.match(migration, /definition := replace\(definition,\s*'from \(select \* from report_notes order by document_date desc,id desc'/);
assert.match(view, /basis === "total" \? "系统比对：含包装费与应付一致"/);
assert.match(view, /visibleNotes\.map\(\(note\)/);
assert.match(view, /清空选择可恢复其他供应商/);
assert.match(view, /onSupplierOptions=\{setAccountSupplierOptions\}/);
assert.match(view, /accountSupplierOptions\.filter\(\(item\)/);
assert.match(view, /sortedSupplierSummary\.map/);
assert.match(view, /sort: detailSort, direction: detailDirection/);
assert.match(view, /onClick=\{\(\) => sortDetails\("due"\)\}/);
assert.match(view, /supplierId: id, search: filters\.search, checkStatus: "" as const, amountFocus: "" as const/);
assert.match(view, /setSupplierId\(id\); setCheckStatus\(""\); setSelectedPreset\(""\)/);
assert.match(view, /supplierId: id, checkStatus: "", amountFocus: ""/);
assert.match(view, /amountFocus, checkStatus: ""/);
assert.match(ledger, /aria-expanded=\{expanded\}/);
assert.match(ledger, /hidden=\{!expanded\}/);
assert.match(ledger, /期初未确认，不能代表实际总欠款/);
assert.match(api, /supplier_reconciliation_report_checked_sorted/);
assert.match(api, /p_sort: sort, p_direction: direction/);
assert.match(sortMigration, /from \(select \* from matching_notes order by/);
assert.match(sortMigration, /definition:=replace\(definition,old_order,new_order\)/);
assert.match(view, /确认纸单核对/);
assert.match(view, /paperQuantity: ""/);
assert.match(statuses, /REVIEW_PENDING: "金额已录 · 待财务确认"/);
assert.match(verificationMigration, /supplier_note_paper_is_current\(n\.id\)/);
assert.match(verificationMigration, /paper_quantity<>received_quantity/);
assert.match(verificationMigration, /confirmed_by uuid not null/);
assert.match(verifyRoute, /\["FINANCE", "ADMIN"\]/);
assert.match(verifyRoute, /supplier\.documents\.view/);
assert.match(view, /产品货款合计（不含包装费）<\/th><td>\{note\.allocated_quantity\}/);
assert.match(view, /money\(Number\(note\.goods_allocated_cny \?\? note\.allocated_cny\)\)/);
assert.match(view, /paperMatchBasis\(note\) === "mismatch"/);
assert.match(paperMigration, /abs\(n\.paper_total_cny - n\.goods_allocated_cny\) > 0\.005 and abs\(n\.paper_total_cny - n\.allocated_cny\) > 0\.005/);
assert.match(paperMigration, /abs\(n\.paper_total_cny - n\.goods_allocated_cny\) <= 0\.005 or abs\(n\.paper_total_cny - n\.allocated_cny\) <= 0\.005/);
for (const [goods, packaging, paper, match] of [[6515, 175, 6690, true], [6515, 175, 6515, true], [6515, 175, 6600, false]]) {
  assert.equal(Math.abs(paper - goods) <= 0.005 || Math.abs(paper - (goods + packaging)) <= 0.005, match);
}
console.log("supplier note status and amount focus contracts passed");
