import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORE_PERMISSION_CODES, normalizeRole, normalizeStatus, permissionPageCode, type AccountStatus, type UserRole } from "@/lib/auth/permissions";

const permissionCache = new Map<UserRole, { expires: number; values: string[] }>();

function isTransientReadError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown } | null;
  const code = String(candidate?.code || candidate?.status || "");
  const message = String(candidate?.message || "");
  return ["502", "503", "504", "525", "529"].includes(code)
    || /(?:gateway timeout|temporar(?:y|ily)|timed? out|ssl handshake failed|cloudflare)/i.test(message);
}

async function readCurrentAccount(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const read = () => admin.from("users")
    .select("id,name,email,role,status,must_change_password,force_logout_at,manager_id")
    .eq("id", userId)
    .maybeSingle();
  let result = await read();
  // Supabase/PostgREST may intermittently return a gateway timeout even when
  // the database is healthy. A single read-only retry prevents a transient
  // upstream failure from logging an authenticated user out of the CRM.
  if (result.error && isTransientReadError(result.error)) result = await read();
  return result;
}

async function readRolePermissions(admin: ReturnType<typeof createAdminClient>, role: UserRole) {
  const read = () => admin.from("role_permission_settings")
    .select("permission_code,enabled")
    .eq("role_code", role);
  let result = await read();
  if (result.error && isTransientReadError(result.error)) result = await read();
  return result;
}

export type CurrentAccount = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  must_change_password: boolean;
  force_logout_at: string | null;
  manager_id: string | null;
  permissions: string[];
};

export async function requireUser(options: { allowPasswordChange?: boolean } = {}) {
  const supabase = await createClient();
  // Verify the signed access token locally (JWKS keys are cached by auth-js)
  // instead of calling /auth/v1/user for every application API request. This
  // preserves cryptographic identity verification while preventing an Auth
  // gateway slowdown from cascading into a system-wide request storm.
  const { data: claimsData, error } = await supabase.auth.getClaims();
  if (error && isTransientReadError(error)) throw new Error("AUTHORIZATION_UNAVAILABLE");
  const claims = claimsData?.claims;
  if (error || !claims?.sub) throw new Error("UNAUTHORIZED");
  const user = {
    id: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : undefined,
    user_metadata: claims.user_metadata && typeof claims.user_metadata === "object" ? claims.user_metadata : {},
  };
  const admin = createAdminClient();
  const { data, error: accountError } = await readCurrentAccount(admin, user.id);
  if (accountError && isTransientReadError(accountError)) throw new Error("AUTHORIZATION_UNAVAILABLE");
  if (accountError || !data) throw new Error("ACCOUNT_NOT_FOUND");
  const role = normalizeRole(data.role);
  const cachedPermissions = permissionCache.get(role);
  let rolePermissions = cachedPermissions && cachedPermissions.expires > Date.now() ? cachedPermissions.values : [];
  if (!rolePermissions.length && role !== "ADMIN") {
    const { data: permissionRows, error: permissionError } = await readRolePermissions(admin, role);
    // A database gateway failure is not an authorization decision. Never turn
    // it into an empty permission set, otherwise an active user is shown the
    // misleading "no permission" page during a transient upstream outage.
    if (permissionError) throw new Error("AUTHORIZATION_UNAVAILABLE");
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
    permissions = permissions.filter((code) => !CORE_PERMISSION_CODES.has(code) && !CORE_PERMISSION_CODES.has(permissionPageCode(code)));
  }
  const account: CurrentAccount = {
    id: data.id,
    name: String(data.name || user.user_metadata?.name || user.email || "用户"),
    email: String(data.email || user.email || ""),
    role,
    status: normalizeStatus(data.status),
    must_change_password: Boolean(data.must_change_password),
    force_logout_at: data.force_logout_at ? String(data.force_logout_at) : null,
    manager_id: data.manager_id ? String(data.manager_id) : null,
    permissions,
  };
  if (account.status !== "ACTIVE") throw new Error(`ACCOUNT_${account.status}`);
  const issuedAt = Number.isFinite(Number(claims.iat)) ? Number(claims.iat) * 1000 : 0;
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
  if (!hasPermission(context.account, permission)) throw new Error("FORBIDDEN");
  return context;
}

export function hasPermission(account: CurrentAccount, permission: string) {
  if (account.role === "ADMIN") return true;
  // Legacy grants and per-user overrides cannot revive an admin-only page or action.
  const pagePermission = permissionPageCode(permission);
  if (CORE_PERMISSION_CODES.has(permission) || CORE_PERMISSION_CODES.has(pagePermission)) return false;
  if (!account.permissions.includes(permission)) return false;
  return pagePermission === permission || account.permissions.includes(pagePermission);
}

/**
 * Cross-user DATA permissions are read-only. A business record is writable
 * only by its owner, while the system administrator keeps the explicit
 * platform-wide maintenance override.
 */
export function canWriteOwnedRecord(account: CurrentAccount, ownerId: string | null | undefined) {
  return account.role === "ADMIN" || ownerId === account.id;
}

export async function requestedOwnerId(request: Request, account: CurrentAccount, dataPermission: string) {
  if (!hasPermission(account, dataPermission)) return account.id;
  const requested = new URL(request.url).searchParams.get("user_id")?.trim() || "";
  if (account.role === "ADMIN") return requested.toLowerCase() === "all" ? null : requested || account.id;
  // 主管仅能读本人和直属下级；权限判断必须在服务端执行，不能只依赖
  // 下拉选项的前端限制。暂不提供“全员”或跨主管聚合范围。
  if (!requested || requested === account.id || requested.toLowerCase() === "all") return account.id;
  if (account.role !== "SUPERVISOR") return account.id;
  const { data, error } = await createAdminClient().from("users").select("id").eq("id", requested).eq("manager_id", account.id).eq("status", "ACTIVE").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("FORBIDDEN");
  return requested;
}

export function clearPermissionCache(role?: UserRole) {
  if (role) permissionCache.delete(role);
  else permissionCache.clear();
}

export function authErrorStatus(message: string) {
  if (message === "UNAUTHORIZED" || message === "SESSION_REVOKED") return 401;
  if (message === "FORBIDDEN") return 403;
  if (message === "AUTHORIZATION_UNAVAILABLE") return 503;
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
