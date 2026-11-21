import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(name, "utf8");
const migration = read("supabase/migrations/20261121120000_split_legacy_supplier_receipt_sources.sql");
const route = read("app/api/stock-orders/legacy-receipt-sources/route.ts");
const view = read("components/legacy-supplier-sources-view.tsx");
const receiptView = read("components/stock-order-detail-view.tsx");

assert.match(migration, /jsonb_array_length\(p_lines\) not between 1 and 50/);
assert.match(migration, /current_order_id <> order_id|order_id <> current_order_id/);
assert.match(migration, /public\.link_legacy_supplier_receipt_source\([\s\S]*version_at_call/);
assert.match(migration, /select updated_at into version_at_call/);
assert.match(route, /if \(body\.split_lines\)[\s\S]*link_legacy_supplier_receipt_sources_split/);
assert.match(view, /function addSplitSource\(id: string\)[\s\S]*source\.row\.quantity/);
assert.match(view, /const overflow = splitDraft\.some\([\s\S]*> source\.row\.quantity/);
assert.match(view, /row\.quantity > 1 \? <button[^>]*[\s\S]*拆分来源/);
assert.match(view, /sourceRows\.length < source\.row\.quantity[\s\S]*拆分来源/);
assert.match(receiptView, /itemSourceRows\.length < item\.quantity - item\.received_quantity[\s\S]*拆分来源/);

console.log("legacy source split tests passed");
