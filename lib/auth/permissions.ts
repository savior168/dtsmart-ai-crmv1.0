export type UserRole = "ADMIN" | "MANAGER" | "SALES";

export type UserProfile = {
  id: string;
  role: UserRole;
  department_id: string | null;
};

export function canManageAll(role: UserRole) {
  return role === "ADMIN";
}

export function canManageDepartment(profile: UserProfile, departmentId: string | null) {
  return profile.role === "ADMIN" ||
    (profile.role === "MANAGER" && profile.department_id !== null && profile.department_id === departmentId);
}

export function canAccessCustomer(
  profile: UserProfile,
  customer: { owner_id: string | null; department_id: string | null; status: string },
) {
  if (profile.role === "ADMIN") return true;
  if (profile.role === "MANAGER") return customer.department_id === profile.department_id;
  return customer.owner_id === profile.id || customer.status === "UNCLAIMED" || customer.status === "RELEASED";
}
