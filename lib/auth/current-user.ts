import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRole, normalizeStatus, type AccountStatus, type UserRole } from "@/lib/auth/permissions";

const permissionCache = new Map<UserRole, { expires: number; values: string[] }>();

export type CurrentAccount = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  must_change_password: boolean;
  force_logout_at: string | null;
  permissions: string[];
};

function tokenIssuedAt(accessToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as { iat?: number };
    return payload.iat ? payload.iat * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function requireUser(options: { allowPasswordChange?: boolean } = {}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  const admin = createAdminClient();
  const { data, error: accountError } = await admin.from("users")
    .select("id,name,email,role,status,must_change_password,force_logout_at")
    .eq("id", user.id)
    .maybeSingle();
  if (accountError || !data) throw new Error("ACCOUNT_NOT_FOUND");
  const role = normalizeRole(data.role);
  const cachedPermissions = permissionCache.get(role);
  let rolePermissions = cachedPermissions && cachedPermissions.expires > Date.now() ? cachedPermissions.values : [];
  if (!rolePermissions.length && role !== "ADMIN") {
    const { data: permissionRows } = await admin.from("role_permission_settings").select("permission_code,enabled").eq("role_code", role);
    rolePermissions = (permissionRows || []).filter((item) => item.enabled).map((item) => String(item.permission_code));
    permissionCache.set(role, { expires: Date.now() + 15000, values: rolePermissions });
  }
  let permissions = rolePermissions;
  if (role !== "ADMIN") {
    // 显式拒绝优先于角色默认与显式允许；表尚未迁移时保持角色权限，避免部署顺序造成登录中断。
    const overrides = await admin.from("user_permission_overrides").select("permission_code,effect").eq("user_id", user.id);
    if (!overrides.error) {
      const denied = new Set((overrides.data || []).filter((item) => item.effect === "DENY").map((item) => String(item.permission_code)));
      const allowed = (overrides.data || []).filter((item) => item.effect === "ALLOW").map((item) => String(item.permission_code));
      permissions = [...new Set([...rolePermissions, ...allowed])].filter((code) => !denied.has(code));
    }
  }
  const account: CurrentAccount = {
    id: data.id,
    name: String(data.name || user.user_metadata?.name || user.email || "用户"),
    email: String(data.email || user.email || ""),
    role,
    status: normalizeStatus(data.status),
    must_change_password: Boolean(data.must_change_password),
    force_logout_at: data.force_logout_at ? String(data.force_logout_at) : null,
    permissions,
  };
  if (account.status !== "ACTIVE") throw new Error(`ACCOUNT_${account.status}`);
  const { data: sessionData } = await supabase.auth.getSession();
  const issuedAt = sessionData.session?.access_token ? tokenIssuedAt(sessionData.session.access_token) : 0;
  if (account.force_logout_at && issuedAt && Date.parse(account.force_logout_at) > issuedAt) {
    await supabase.auth.signOut().catch(() => undefined);
    throw new Error("SESSION_REVOKED");
  }
  if (account.must_change_password && !options.allowPasswordChange) throw new Error("PASSWORD_CHANGE_REQUIRED");
  return { supabase, user, account };
}

export async function requireAdmin(options: { allowPasswordChange?: boolean } = {}) {
  const context = await requireUser(options);
  if (context.account.role !== "ADMIN") throw new Error("FORBIDDEN");
  return context;
}

export async function requirePermission(permission: string) {
  const context = await requireUser();
  if (context.account.role !== "ADMIN" && !context.account.permissions.includes(permission)) throw new Error("FORBIDDEN");
  return context;
}

export function hasPermission(account: CurrentAccount, permission: string) {
  return account.role === "ADMIN" || account.permissions.includes(permission);
}

/**
 * Cross-user DATA permissions are read-only. A business record is writable
 * only by its owner, while the system administrator keeps the explicit
 * platform-wide maintenance override.
 */
export function canWriteOwnedRecord(account: CurrentAccount, ownerId: string | null | undefined) {
  return account.role === "ADMIN" || ownerId === account.id;
}

export function requestedOwnerId(request: Request, account: CurrentAccount, dataPermission: string) {
  if (!hasPermission(account, dataPermission)) return account.id;
  const requested = new URL(request.url).searchParams.get("user_id")?.trim() || "";
  if (requested.toLowerCase() === "all") return null;
  // 拥有全部数据权限只代表可以主动扩大范围。主管和系统管理员进入
  // 任何业务页面时也默认查看本人数据，避免默认混入其他销售数据。
  return requested || account.id;
}

export function clearPermissionCache(role?: UserRole) {
  if (role) permissionCache.delete(role);
  else permissionCache.clear();
}

export function authErrorStatus(message: string) {
  if (message === "UNAUTHORIZED" || message === "SESSION_REVOKED") return 401;
  if (message === "FORBIDDEN") return 403;
  if (message.startsWith("ACCOUNT_") || message === "PASSWORD_CHANGE_REQUIRED") return 423;
  return 400;
}

export async function writeAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  content: Record<string, unknown>,
) {
  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action,
    target_type: targetType,
    target_id: targetId,
    content,
  });
  if (error) throw error;
}
