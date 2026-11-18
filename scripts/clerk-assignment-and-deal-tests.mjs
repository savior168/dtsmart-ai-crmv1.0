import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scopeSql = read("supabase/migrations/20261118120000_order_clerk_sales_assignments.sql");
const dealSql = read("supabase/migrations/20261118121000_first_shipped_pi_stage_repair.sql");
const create = read("app/api/orders/create-pi/route.ts");
const choices = read("app/api/orders/pi-customers/route.ts");
const options = read("app/api/users/options/route.ts");
const currentUser = read("lib/auth/current-user.ts");
const admin = read("app/api/admin/users/[id]/clerk-scope/route.ts");
const editor = read("components/clerk-sales-scope-editor.tsx");

assert.match(scopeSql, /create table public\.order_clerk_sales_assignments/);
assert.match(scopeSql, /select clerk\.id, seller\.id[\s\S]*clerk\.role = 'ORDER_CLERK'/,
  "existing clerks must retain their prior scope until the administrator changes it");
for (const table of ["sales_orders", "sales_order_items", "stock_orders", "stock_order_items", "stock_order_events"]) {
  assert.match(scopeSql, new RegExp(`create policy ${table.replace("sales_order_items", "sales_items").replace("stock_order_items", "stock_items").replace("stock_order_events", "stock_events")}_clerk_assigned_boundary[\\s\\S]*?as restrictive`));
}
for (const functionName of ["create_direct_pi_order", "create_direct_pi_order_with_fees", "stock_order_dashboard", "correct_direct_pi_line_prices", "request_direct_pi_amendment", "review_shipped_pi_seller_cost"]) {
  assert.match(scopeSql, new RegExp(`pg_get_functiondef\\('public\\.${functionName}\\(`),
    `${functionName} must enforce the assigned seller even when RLS is bypassed`);
}
assert.match(scopeSql, /set_order_clerk_sales_assignments[\s\S]*role = 'ADMIN'[\s\S]*insert into public\.audit_logs/);
assert.match(create, /await requireAssignedSales\(account\.id, salesUserId\)/);
assert.match(choices, /allowedSalespeople[\s\S]*!allowedSalespeople\.some/);
assert.match(options, /clerkSalesIds[\s\S]*query\.in\("id", clerkSalesIds\)/);
assert.match(currentUser, /await requireAssignedSales\(account\.id, requested\)/);
assert.match(admin, /requireAdmin\(\)[\s\S]*set_order_clerk_sales_assignments/);
assert.match(editor, /保存范围[\s\S]*|setAssigned/);
assert.match(read("components/admin-settings-panels.tsx"), /<ClerkSalesScopeEditor key=\{payload\.user\.id\} clerkId=\{payload\.user\.id\}/,
  "clerk scope must use the user ID confirmed by the permissions response");
assert.match(editor, /<details className="relative mt-3[\s\S]*搜索可授权销售员[\s\S]*type="checkbox"/,
  "seller assignments should use a compact searchable multi-select");
assert.match(editor, /!loading && !error[\s\S]*暂无可授权销售员/,
  "load failures must not be presented as an empty seller search result");

assert.match(dealSql, /first_pi[\s\S]*confirmed_at is not null[\s\S]*status not in \('DRAFT', 'CANCELLED'\)/);
assert.match(dealSql, /s\.status = 'SHIPPED'[\s\S]*i\.shipped_quantity is distinct from i\.quantity/);
assert.match(dealSql, /customer_first_pi_fully_shipped\(c\.id\)[\s\S]*promote_customer_after_first_pi_shipment\(candidate\.id\)/);
console.log("clerk assignment and shipped-deal contract tests passed");
