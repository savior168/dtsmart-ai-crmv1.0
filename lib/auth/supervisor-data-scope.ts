export type SupervisorScopeAccount = { role: string; supervisor_can_view_subordinates?: boolean | null };

export function canViewSubordinateData(account: SupervisorScopeAccount): boolean {
  return account.role === "SUPERVISOR" && account.supervisor_can_view_subordinates === true;
}

export function isSubordinateDataPermission(permission: string): boolean {
  return permission.endsWith(".data_all") || permission === "ai.usage.view_all";
}

// Keep the selectable "all" option and the server-side aggregate allowlist in
// sync. Add a permission only after every privileged query behind it is bounded
// to the supervisor's active descendant tree.
export const SUPERVISOR_TEAM_ALL_PERMISSIONS = new Set([
  "dashboard.data_all", "customers.data_all", "orders.data_all", "stock.data_all",
  "quotes.data_all", "reports.data_all", "followups.data_all",
  "ai.acquisition.data_all", "ai.data_all", "ai.usage.view_all",
]);
