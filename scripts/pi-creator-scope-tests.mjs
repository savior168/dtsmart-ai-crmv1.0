import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261102060003_pi_recall_stock_start_guard.sql");
const detailApi = read("app/api/orders/[id]/route.ts");
const listApi = read("app/api/orders/route.ts");
const reviewApi = read("app/api/orders/[id]/cost-review/route.ts");
const currentUser = read("lib/auth/current-user.ts");

for (const rpc of ["update_direct_pi_draft", "set_direct_pi_change_note",
  "delete_never_submitted_pi_draft", "cancel_sales_order"]) {
  assert.match(migration, new RegExp(`pg_get_functiondef\\('public\\.${rpc}\\(`),
    `${rpc} must retain the database-side creator guard`);
}
assert.match(migration, /coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "PI writes must check the preparer, not the sales owner or role alone");
assert.match(migration, /create or replace function public\.recall_direct_pi_order[\s\S]*coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "PI recall must be creator-only");
assert.match(migration, /create function public\.review_shipped_pi_seller_cost[\s\S]*coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "post-shipment seller cost review must be creator-only");
assert.match(detailApi, /confirmation_method === "DIRECT_PI"[\s\S]*\(order\.data\.prepared_by \|\| order\.data\.sales_user_id\) === account\.id/,
  "PI detail actions must use creator scope");
assert.match(detailApi, /can_review_seller_cost: \(order\.data\.prepared_by \|\| order\.data\.sales_user_id\) === account\.id/,
  "seller cost review button must not be offered to another user");
assert.match(detailApi, /can_cancel:\s*writable &&\s*hasPermission\(account, "orders\.cancel"\)/,
  "the cancel button must obey the configured grant and creator scope rather than a role ban");
assert.match(migration, /PI cancel clerk guard changed; manual review required/,
  "the SQL cancellation guard must not keep a blanket clerk veto after authorization is configurable");
assert.match(listApi, /\(item\.prepared_by \|\| item\.sales_user_id\) === account\.id/,
  "PI list destructive actions must use creator scope");
assert.match(reviewApi, /requirePermission\("orders\.cost_review"\)/,
  "cost review API must check the configured operation permission");
const creatorScope = currentUser.match(/export async function requestedPiCreatorId[\s\S]*?\r?\n}\r?\n/)?.[0] || "";
assert.match(creatorScope, /hasPermission\(account, dataPermission\)/,
  "PI creator filter must require the configured data grant");
assert.doesNotMatch(creatorScope, /ORDER_CLERK|account\.role/,
  "PI creator filter must not hard-code a role after the data grant is configured");
console.log("PI creator-only scope contracts passed.");
