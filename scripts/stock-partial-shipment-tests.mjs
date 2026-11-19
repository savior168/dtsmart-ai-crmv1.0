import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("app/api/stock-orders/[id]/ship/route.ts");
const view = read("components/stock-order-detail-view.tsx");
const migration = read("supabase/migrations/20261119070000_partial_stock_shipments.sql");
const detailRoute = read("app/api/stock-orders/[id]/route.ts");

assert.match(route, /Number\.isSafeInteger\(line\.quantity\)/);
assert.match(route, /new Set\(lines\.map\(\(line\) => line\.item_id\)\)/);
assert.match(route, /record_stock_shipment_quantities/);
assert.match(view, /第 \$\{item\.line_number\} 项本次交货代数量/);
assert.match(view, /quantity > item\.prepared_quantity - item\.shipped_quantity/);
assert.match(view, /lines: shipmentDraft\.lines\.map/);
assert.match(view, /item\.received_quantity < item\.quantity/);
assert.match(detailRoute, /select\("id,item_ids,shipment_lines,/);
assert.match(migration, /handoff_quantity > line\.prepared_quantity-line\.shipped_quantity/);
assert.match(migration, /normalized_lines := normalized_lines \|\| jsonb_build_array/);
assert.match(migration, /where id=p_stock_order_id for update/);
assert.match(migration, /item\.shipped_quantity >= item\.quantity/);
assert.match(migration, /actor\.role not in \('WAREHOUSE','ADMIN'\)/);
assert.match(migration, /revoke all on function public\.record_stock_shipment_quantities/);
console.log("Stock partial shipment contracts passed.");
