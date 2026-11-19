import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scopeSql = read("supabase/migrations/20261118120000_order_clerk_sales_assignments.sql");
const customerScopeSql = read("supabase/migrations/20261119021736_clerk_assigned_customer_read.sql");
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
assert.match(customerScopeSql, /customers_order_clerk_assigned_boundary[\s\S]*as restrictive[\s\S]*order_clerk_has_sales_scope\(owner_id\)/,
  "direct customer table reads must be limited to assigned sellers");
assert.match(create, /await requireAssignedSales\(account\.id, salesUserId\)/);
assert.match(choices, /allowedSalespeople[\s\S]*!allowedSalespeople\.some/);
assert.match(options, /clerkSalesIds[\s\S]*query\.in\("id", clerkSalesIds\)/);
assert.match(options, /salesOwnerOptions[\s\S]*query\.in\("role", \["SUPERVISOR", "SALES"\]\)/,
  "PI and stock seller filters must not label administrators as sales owners");
for (const path of ["components/orders-view.tsx", "components/stock-orders-view.tsx"]) {
  assert.match(read(path), /kind="sales_owner"[\s\S]*filterLabel="所属销售员"/,
    `${path} must request only actual sales owners`);
}
assert.match(read("app/api/stock-orders/missing-documents/route.ts"), /supabase\.from\("stock_orders"\)\.select\("id"\)[\s\S]*scopedRows = rows\.filter/,
  "security-definer queue results must be checked against the detail page RLS before emitting links");
assert.match(currentUser, /await requireAssignedSales\(account\.id, requested\)/);
assert.match(read("app/api/users/options/route.ts"), /\["customers\.data_all", "orders\.data_all", "stock\.data_all"\]\.includes\(permission\)/,
  "the customer owner selector must not enumerate unassigned sellers");
for (const path of ["app/api/customers/[id]/route.ts", "app/api/customers/[id]/crm/route.ts"]) {
  assert.match(read(path), /requireAssignedSales\(account\.id, (?:data|customer)\.owner_id\)/,
    `${path} must reject direct detail access after seller assignment is revoked`);
}
for (const path of ["app/api/customers/protection/route.ts", "app/api/customers/protection/releases/route.ts", "app/api/customer-conflicts/route.ts"]) {
  assert.match(read(path), /assignedSalesIds\(account\.id\)/,
    `${path} must scope service-role customer data to assigned sellers`);
}
assert.match(admin, /requireAdmin\(\)[\s\S]*set_order_clerk_sales_assignments/);
assert.match(admin, /const \{ id: rawId \} = await context\.params;\s*const id = rawId\.trim\(\);/,
  "clerk scope endpoint must normalize route IDs consistently before validation and lookup");
const uuidPattern = admin.match(/const UUID = (\/[^;]+\/i);/)?.[1];
assert.ok(uuidPattern, "clerk scope endpoint must validate user IDs");
const validClerkId = new Function(`return ${uuidPattern}`)();
assert.equal(validClerkId.test("21611fd8-303b-4618-97ae-430af5c72e58"), true,
  "a real five-group UUID must not be rejected as an invalid user ID");
assert.equal(validClerkId.test("21611fd8-303b-4618-430af5c72e58"), false,
  "malformed IDs must still be rejected");
assert.match(editor, /保存范围[\s\S]*|setAssigned/);
assert.match(read("components/admin-settings-panels.tsx"), /payload\?\.user\?\.id===user\.id\?<ClerkSalesScopeEditor key=\{user\.id\} clerkId=\{user\.id\}/,
  "clerk scope must render only for the user ID confirmed by the permissions response");
assert.match(editor, /<details className="relative mt-3[\s\S]*搜索可授权销售员[\s\S]*type="checkbox"/,
  "seller assignments should use a compact searchable multi-select");
assert.match(editor, /!loading && !error[\s\S]*暂无可授权销售员/,
  "load failures must not be presented as an empty seller search result");

assert.match(dealSql, /first_pi[\s\S]*confirmed_at is not null[\s\S]*status not in \('DRAFT', 'CANCELLED'\)/);
assert.match(dealSql, /s\.status = 'SHIPPED'[\s\S]*i\.shipped_quantity is distinct from i\.quantity/);
assert.match(dealSql, /customer_first_pi_fully_shipped\(c\.id\)[\s\S]*promote_customer_after_first_pi_shipment\(candidate\.id\)/);
console.log("clerk assignment and shipped-deal contract tests passed");
