import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const upload = read("app/api/orders/[id]/requirement-attachments/route.ts");
const download = read("app/api/attachments/[id]/route.ts");
const form = read("components/pi-order-form.tsx");
const warehouse = read("app/api/stock-orders/[id]/route.ts");
const orderList = read("app/api/orders/route.ts");
const stockList = read("app/api/stock-orders/route.ts");

assert.match(upload, /order\.status !== "DRAFT"/);
assert.match(upload, /\(order\.prepared_by \|\| order\.sales_user_id\) !== account\.id/);
assert.match(upload, /isPiRequirementImage\(content, file\.type\)/);
assert.match(upload, /sales_order_item_id: lineResult\?\.data\?\.id/);
assert.match(upload, /if \(inserted\.error\) \{[\s\S]*remove\(\[storagePath\]\)/);
assert.match(form, /await uploadRequirementFiles\(orderId\);[\s\S]*if \(submitToWarehouse\)/);
assert.match(warehouse, /requirement_attachments: resolvePiRequirementAttachments\(requirementAttachments\.data \|\| \[\], activePiItems\.data \|\| \[\]\)/);
assert.match(download, /account\.role === "WAREHOUSE" && hasPermission\(account, "stock\.view"\)/);
assert.match(download, /stock\.data && stock\.data\.status !== "DRAFT"/);
assert.match(orderList, /hasPermission\(account, "customers\.view"\)[\s\S]*supabase\.from\("customers"\)\.select\("id"\)/);
assert.match(stockList, /hasPermission\(account, "customers\.view"\)[\s\S]*supabase\.from\("customers"\)\.select\("id"\)/);
console.log("PI requirement attachment and customer-link contracts passed");
