import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ui = read("components/supplier-reconciliation-view.tsx");
const api = read("app/api/supplier-reconciliation/payments/batch/route.ts");
const migration = read("supabase/migrations/20261119060000_supplier_payments_batch.sql");
const optional = read("supabase/migrations/20261119050000_admin_legacy_remediation_optional_reconciliation_fields.sql");

assert.match(ui, /选择送货单 .* 批量付款/);
assert.match(ui, /same|同一供应商/);
assert.match(ui, /expected_unpaid_cny: line\.unpaid\.toFixed\(2\)/);
assert.match(ui, /付款凭证号（选填，同一凭证号关联所选送货单）/);
assert.match(api, /requirePermission\("supplier\.reconciliation\.manage"\)/);
assert.match(api, /assertSupplierRoleAllowed/);
assert.match(api, /lines\.length < 2 \|\| lines\.length > 50/);
assert.match(api, /record_supplier_payments_batch/);
assert.match(migration, /security definer/);
assert.match(migration, /actor\.role in \('SALES','ORDER_CLERK'\)/);
assert.match(migration, /order by value->>'delivery_note_id'/);
assert.match(migration, /expected_unpaid <> actual_unpaid or amount > actual_unpaid/);
assert.match(migration, /record_supplier_payment\(note\.id, amount/);
assert.match(optional, /where btrim\(payment_reference\) <> ''/);
assert.match(optional, /actor\.role not in \(''WAREHOUSE'',''ADMIN''\)/);
console.log("Supplier batch payment contracts passed.");
