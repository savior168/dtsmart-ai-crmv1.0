import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canViewSubordinateData, isSubordinateDataPermission, SUPERVISOR_TEAM_ALL_PERMISSIONS } from "../lib/auth/supervisor-data-scope.ts";
import { descendantIds, wouldCreateManagerCycle } from "../lib/auth/subordinate-tree.ts";

assert.deepEqual(descendantIds("boss", [
  { id: "boss", manager_id: null },
  { id: "supervisor", manager_id: "boss" },
  { id: "sales", manager_id: "supervisor" },
  { id: "unrelated", manager_id: null },
]), ["boss", "supervisor", "sales"]);
// A disabled manager is still a hierarchy node; active descendants remain
// reachable through it (the API filters inactive accounts from choices).
assert.deepEqual(descendantIds("boss", [
  { id: "boss", manager_id: null },
  { id: "disabled-manager", manager_id: "boss" },
  { id: "active-grandchild", manager_id: "disabled-manager" },
]), ["boss", "disabled-manager", "active-grandchild"]);
assert.equal(wouldCreateManagerCycle("boss", "sales", [
  { id: "boss", manager_id: null },
  { id: "supervisor", manager_id: "boss" },
  { id: "sales", manager_id: "supervisor" },
]), true);
assert.equal(wouldCreateManagerCycle("sales", "boss", [
  { id: "boss", manager_id: null },
  { id: "sales", manager_id: "boss" },
]), false);
assert.deepEqual(descendantIds("boss", [
  { id: "boss", manager_id: "sales" },
  { id: "supervisor", manager_id: "boss" },
  { id: "sales", manager_id: "supervisor" },
]), ["boss", "supervisor", "sales"]);

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
const usersApi = await read("../app/api/admin/users/route.ts");
const batchUsersApi = await read("../app/api/admin/users/batch/route.ts");
const currentUser = await read("../lib/auth/current-user.ts");
const adminPanel = await read("../components/admin-settings-panels.tsx");
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
assert.match(usersApi, /body\.manager_id !== undefined \? body\.manager_id \|\| "" : target\.manager_id \|\| ""/);
assert.match(batchUsersApi, /managerAssignmentsCreatingCycles\(ids, managerId\)/);
assert.match(currentUser, /canViewSubordinateData\(account\)/);
const scopeApi = await read("../lib/auth/subordinate-scope.ts");
const hierarchyMigration = await read("../supabase/migrations/20261112000100_multilevel_supervisor_scope.sql");
assert.match(scopeApi, /select\("id,manager_id,status"\)/);
assert.match(scopeApi, /visibleIds\.filter[\s\S]*activeUsers\.has\(id\)/);
assert.match(hierarchyMigration, /inactive users remain hierarchy nodes/i);
assert.match(hierarchyMigration, /from public\.users child join descendants d on child\.manager_id = d\.id\s+where not child\.id = any\(d\.visited\)/i);
assert.doesNotMatch(adminPanel, /setTab\("supervisor-data"\)/);
assert.match(adminPanel, /function UserPermissionDialog[\s\S]*?查看多级下属数据/);
assert.match(adminPanel, /function UserPermissionDialog[\s\S]*?changeSupervisorScope[\s\S]*?\/api\/admin\/supervisor-data-access/);
const ownerOptions = await read("../app/api/users/options/route.ts");
const dashboardApi = await read("../app/api/dashboard/stats/route.ts");
const salesReport = await read("../lib/reports/sales.ts");
const salesReportApi = await read("../app/api/reports/sales/route.ts");
const salesReportExportApi = await read("../app/api/reports/sales/export/route.ts");
const authorizedAllMigration = await read("../supabase/migrations/20261116034439_authorized_owner_all_scope.sql");
assert.match(ownerOptions, /SUPERVISOR_TEAM_ALL_PERMISSIONS\.has\(permission\)/);
assert.match(currentUser, /SUPERVISOR_TEAM_ALL_PERMISSIONS\.has\(dataPermission\)/);
for (const permission of ["dashboard.data_all", "customers.data_all", "orders.data_all", "stock.data_all", "quotes.data_all", "reports.data_all", "followups.data_all", "ai.acquisition.data_all", "ai.data_all", "ai.usage.view_all"]) {
  assert.equal(SUPERVISOR_TEAM_ALL_PERMISSIONS.has(permission), true, permission);
}
assert.equal(SUPERVISOR_TEAM_ALL_PERMISSIONS.has("imports.data_all"), false);
assert.match(currentUser, /requested\.toLowerCase\(\) === "all"[\s\S]*?dataPermission === "customers\.data_all" \? account\.supervisor_can_view_customers : canViewSubordinateData\(account\)\)\) return null/);
const customerScopeMigration = await read("../supabase/migrations/20261116064426_my_customers_independent_subordinate_scope.sql");
assert.match(customerScopeMigration, /o\.permission_code = 'customers\.data_all'[\s\S]*?o\.effect = 'ALLOW'/);
assert.match(customerScopeMigration, /create policy customers_supervisor_data_scope[\s\S]*?supervisor_can_read_customer_owner/);
assert.match(adminPanel, /我的客户 · 查看下属客户/);
assert.match(dashboardApi, /teamOwnerIds[\s\S]*?activeDescendantIds\(account\.id\)/);
assert.match(dashboardApi, /followupsQuery\.in\("owner_id", teamOwnerIds\)/);
assert.match(authorizedAllMigration, /actor\.role <> ''SUPERVISOR'' or public\.supervisor_can_read_user\(c\.owner_id\)/);
assert.match(authorizedAllMigration, /public\.supervisor_can_read_user\(p_sales_user_id\)/);
for (const permission of ["dashboard.view", "dashboard.data_all", "reports.view", "reports.data_all"]) {
  assert.ok(authorizedAllMigration.includes(`''${permission}''`), permission);
}
assert.match(authorizedAllMigration, /sales_performance_report owner scope definition changed/);
assert.match(salesReport, /profile\.supervisor_can_view_subordinates === true && canViewOtherUsers/);
assert.match(salesReportApi, /hasPermission\(account, "reports\.data_all"\)/);
assert.match(salesReportExportApi, /hasPermission\(account, "reports\.data_all"\)/);
for (const path of [
  "../app/api/customers/protection/route.ts",
  "../app/api/customers/protection/releases/route.ts",
  "../app/api/customer-conflicts/route.ts",
  "../app/api/followups/route.ts",
  "../app/api/followups/export/route.ts",
  "../app/api/ai-acquisition/tasks/route.ts",
  "../app/api/ai-acquisition/customers/route.ts",
  "../app/api/ai-acquisition/usage/route.ts",
  "../app/api/ai/tasks/route.ts",
  "../app/api/ai/results/route.ts",
  "../app/api/ai/failures/route.ts",
  "../app/api/ai/usage/route.ts",
]) {
  const source = await read(path);
  assert.match(source, /teamOwnerIds[\s\S]*?activeDescendantIds\(account\.id\)/, path);
  assert.match(source, /\.in\("(?:owner_id|user_id|task\.user_id|source_owner_id|sales_user_id)", teamOwnerIds\)|teamOwnerIds\.has\(id\)|teamOwnerIds\.includes\(|teamOwnerIds\.join\(/, path);
}
console.log("Supervisor data scope contracts passed");
