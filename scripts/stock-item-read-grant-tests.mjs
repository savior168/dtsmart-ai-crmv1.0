import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105094017_stock_item_amendment_read_grant.sql", import.meta.url), "utf8");
assert.match(migration, /grant select\s*\(pi_amendment_cancelled_at\)\s*on public\.stock_order_items to authenticated/i);
assert.doesNotMatch(migration, /grant select\s+on public\.stock_order_items to authenticated/i,
  "Do not grant access to procurement-cost columns");

for (const path of [
  "../lib/stock-progress-query.ts",
  "../app/api/orders/[id]/route.ts",
  "../app/api/stock-orders/[id]/export/route.ts",
  "../app/api/stock-orders/[id]/route.ts",
  "../app/api/stock-orders/route.ts",
]) {
  const route = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(route, /pi_amendment_cancelled_at/, `${path} must use the granted filter column`);
}
console.log("Stock item amendment read grant contract passed.");
