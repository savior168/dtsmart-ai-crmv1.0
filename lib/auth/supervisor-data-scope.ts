export type SupervisorScopeAccount = { role: string; supervisor_can_view_subordinates?: boolean | null };

export function canViewSubordinateData(account: SupervisorScopeAccount): boolean {
  return account.role === "SUPERVISOR" && account.supervisor_can_view_subordinates === true;
}

export function isSubordinateDataPermission(permission: string): boolean {
  return permission.endsWith(".data_all") || permission === "ai.usage.view_all";
}
