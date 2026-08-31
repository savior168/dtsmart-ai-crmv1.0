export const USER_ROLES = ["ADMIN", "SUPERVISOR", "SALES"] as const;
export const ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "REJECTED", "DISABLED", "LOCKED"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type UserProfile = {
  id: string;
  role: UserRole;
  status: AccountStatus;
  department_id?: string | null;
};

export function canManageAll(role: UserRole) {
  return role === "ADMIN" || role === "SUPERVISOR";
}

export function canManageDepartment(profile: UserProfile, departmentId: string | null) {
  void departmentId;
  return canManageAll(profile.role);
}

export function canAccessCustomer(
  profile: UserProfile,
  customer: { owner_id: string | null; department_id: string | null; status: string },
) {
  if (canManageAll(profile.role)) return true;
  return customer.owner_id === profile.id || customer.status === "UNCLAIMED" || customer.status === "RELEASED";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "系统管理员",
  SUPERVISOR: "主管",
  SALES: "销售员",
};

export const STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING: "待审核",
  ACTIVE: "已启用",
  REJECTED: "已拒绝",
  DISABLED: "已停用",
  LOCKED: "已锁定",
};

export function normalizeRole(value: unknown): UserRole {
  const role = String(value || "SALES").toUpperCase();
  if (role === "MANAGER") return "SUPERVISOR";
  return USER_ROLES.includes(role as UserRole) ? role as UserRole : "SALES";
}

export function normalizeStatus(value: unknown): AccountStatus {
  const status = String(value || "PENDING").toUpperCase();
  return ACCOUNT_STATUSES.includes(status as AccountStatus) ? status as AccountStatus : "PENDING";
}
