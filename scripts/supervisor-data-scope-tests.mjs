import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canViewSubordinateData, isSubordinateDataPermission } from "../lib/auth/supervisor-data-scope.ts";

assert.equal(canViewSubordinateData({ role: "SUPERVISOR", supervisor_can_view_subordinates: false }), false);
assert.equal(canViewSubordinateData({ role: "SUPERVISOR" }), false);
assert.equal(canViewSubordinateData({ role: "SUPERVISOR", supervisor_can_view_subordinates: true }), true);
assert.equal(canViewSubordinateData({ role: "SALES", supervisor_can_view_subordinates: true }), false);
for (const code of ["customers.data_all", "orders.data_all", "stock.data_all", "reports.data_all", "ai.data_all", "ai.usage.view_all"]) {
  assert.equal(isSubordinateDataPermission(code), true, code);
}
for (const code of ["customers.view", "orders.create", "stock.view", "customers.edit"]) {
  assert.equal(isSubordinateDataPermission(code), false, code);
}

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/20261019041000_supervisor_subordinate_view_switch.sql");
const dashboardMigration = await read("../supabase/migrations/202609120003_dashboard_overview_performance.sql");
const salesReportMigration = await read("../supabase/migrations/202609300004_sales_report_all_country_groups.sql");
const rankingMigration = await read("../supabase/migrations/202609300003_sales_report_current_owner_metrics.sql");
const renewalMigration = await read("../supabase/migrations/202609020001_customer_public_pool_workflow.sql");
const adminApi = await read("../app/api/admin/supervisor-data-access/route.ts");
const currentUser = await read("../lib/auth/current-user.ts");
assert.match(migration, /supervisor_can_view_subordinates boolean not null default false/i);
assert.match(migration, /role = 'ADMIN' and status = 'ACTIVE'/i);
assert.match(migration, /role = 'SUPERVISOR' for update/i);
assert.match(migration, /ADMIN_SUPERVISOR_DATA_SCOPE/);
assert.match(migration, /before update of role, status on public\.users/i);
assert.match(migration, /create policy users_supervisor_data_scope[\s\S]*?public\.current_user_role\(\) <> 'SUPERVISOR' or id = auth\.uid\(\)/i);
assert.match(migration, /create policy customers_supervisor_data_scope on public\.customers as restrictive/i);
assert.match(migration, /create policy sales_orders_supervisor_data_scope on public\.sales_orders as restrictive/i);
assert.match(migration, /create policy stock_orders_supervisor_data_scope on public\.stock_orders as restrictive/i);
assert.match(migration, /create policy customers_supervisor_own_update on public\.customers as restrictive/i);
assert.match(migration, /create policy customer_protection_supervisor_own_update on public\.customer_protection as restrictive/i);
assert.match(migration, /create policy ai_tasks_supervisor_own_update on public\.ai_screening_tasks as restrictive/i);
assert.match(migration, /create policy followups_supervisor_own_insert on public\.followups as restrictive/i);
assert.match(migration, /create policy quotes_supervisor_own_insert on public\.quotes as restrictive/i);
assert.match(migration, /create policy attachments_supervisor_own_insert on public\.attachments as restrictive/i);
assert.match(migration, /dashboard_overview 主管范围定义已变化/);
assert.match(migration, /sales_report_breakdowns 主管范围定义已变化/);
assert.match(migration, /sales_performance_report 主管范围定义已变化/);
assert.match(migration, /review_customer_protection_renewal 主管范围定义已变化/);
assert.ok(dashboardMigration.includes("elsif exists (select 1 from public.users u where u.id = p_scope_user_id and u.manager_id = actor.id and u.status = 'ACTIVE') then"));
assert.ok(salesReportMigration.includes("elsif exists (select 1 from public.users u where u.id=p_user_id and u.manager_id=actor.id and u.status='ACTIVE') then"));
assert.ok(rankingMigration.includes("(a.role='SUPERVISOR' and (u.id=a.id or u.manager_id=a.id))"));
assert.ok(renewalMigration.includes("if actor.role='SUPERVISOR' and request_owner.manager_id is distinct from actor.id then"));
assert.match(adminApi, /requireAdmin\(\)/);
assert.match(currentUser, /canViewSubordinateData\(account\)/);
console.log("Supervisor data scope contracts passed");
