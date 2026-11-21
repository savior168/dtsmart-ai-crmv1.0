import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("../components/supplier-reconciliation-view.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/supplier-reconciliation/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261121150000_supplier_note_detail_filters.sql", import.meta.url), "utf8");
const statuses = readFileSync(new URL("../lib/suppliers/note-check-status.ts", import.meta.url), "utf8");

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
console.log("supplier note status and amount focus contracts passed");
