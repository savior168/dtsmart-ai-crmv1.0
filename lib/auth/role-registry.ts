import { ROLE_LABELS, USER_ROLES, normalizeRole, type UserRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

// Cross-identity custom roles are paused until their data/RLS boundaries are
// redesigned and verified. Keep the existing built-in roles available.
export const CUSTOM_ROLES_ENABLED = false;

export function isBuiltinRole(role: string): role is (typeof USER_ROLES)[number] {
  return USER_ROLES.includes(role as (typeof USER_ROLES)[number]);
}

/**
 * Never trust a role code supplied by an admin form merely because its syntax
 * is valid. Custom roles must exist and be enabled before account assignment.
 */
async function resolveRegisteredRole(
  admin: ReturnType<typeof createAdminClient>,
  value: unknown,
  requireAssignment: boolean,
): Promise<UserRole | null> {
  let role: UserRole;
  try {
    role = normalizeRole(value);
  } catch {
    return null;
  }
  if (isBuiltinRole(role)) return role;
  if (!CUSTOM_ROLES_ENABLED) return null;
  const { data, error } = await admin.from("app_role_definitions")
    .select("code,enabled,is_system,assignment_enabled").eq("code", role).maybeSingle();
  if (error) throw error;
  return data?.enabled && (!requireAssignment || data.assignment_enabled) && !data.is_system ? role : null;
}

export function resolveAssignableRole(admin: ReturnType<typeof createAdminClient>, value: unknown) {
  return resolveRegisteredRole(admin, value, true);
}

export function resolveConfigurableRole(admin: ReturnType<typeof createAdminClient>, value: unknown) {
  return resolveRegisteredRole(admin, value, false);
}

export function builtinRoleLabel(role: string) {
  return isBuiltinRole(role) ? ROLE_LABELS[role] : role;
}

export function isRoleRegistryMissing(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205"
    || /relation .*app_role_definitions.* does not exist/i.test(error?.message || "");
}

export async function readRoleDefinitions(admin: ReturnType<typeof createAdminClient>) {
  if (!CUSTOM_ROLES_ENABLED) {
    return { data: USER_ROLES.map(code => ({ code, name: ROLE_LABELS[code], is_system: true, enabled: true, assignment_enabled: true })), ready: false };
  }
  const { data, error } = await admin.from("app_role_definitions")
    .select("code,name,is_system,enabled,assignment_enabled").order("is_system", { ascending: false }).order("created_at");
  if (error) {
    if (!isRoleRegistryMissing(error)) throw error;
    // Old deployments must keep their built-in roles functional while the
    // backward-compatible registry migration is being rolled out.
    return { data: USER_ROLES.map(code => ({ code, name: ROLE_LABELS[code], is_system: true, enabled: true, assignment_enabled: true })), ready: false };
  }
  return { data: data || [], ready: true };
}
