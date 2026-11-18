import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261118122000_supplier_code_server_only.sql");
const detail = read("app/api/stock-orders/[id]/route.ts");
const exportRoute = read("app/api/stock-orders/[id]/export/route.ts");
const list = read("app/api/stock-orders/route.ts");
const view = read("components/stock-order-detail-view.tsx");
assert.match(migration, /revoke select \(warehouse_supplier_code\)[\s\S]*from authenticated/);
assert.match(detail, /const hideSupplierCode = account\.role === "SALES" \|\| account\.role === "ORDER_CLERK"/);
assert.match(detail, /if \(!hideSupplierCode\) \{[\s\S]*createAdminClient\(\)\.from\("stock_order_items"\)[\s\S]*warehouse_supplier_code/);
assert.match(detail, /can_view_supplier_code: !hideSupplierCode/);
assert.doesNotMatch(exportRoute, /\.select\("[^"\n]*warehouse_supplier_code/);
assert.doesNotMatch(list, /"stock_order_id,line_number[^"\n]*warehouse_supplier_code/);
assert.match(view, /data\.can_view_supplier_code \? "供应商编码" : "回货进度"/);
console.log("Supplier code API, export, UI and column-grant boundaries passed.");
