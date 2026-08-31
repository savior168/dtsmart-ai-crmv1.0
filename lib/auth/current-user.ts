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
  let permissions = cachedPermissions && cachedPermissions.expires > Date.now() ? cachedPermissions.values : [];
  if (!permissions.length && role !== "ADMIN") {
    const { data: permissionRows } = await admin.from("role_permission_settings").select("permission_code,enabled").eq("role_code", role);
    permissions = (permissionRows || []).filter((item) => item.enabled).map((item) => String(item.permission_code));
    permissionCache.set(role, { expires: Date.now() + 30000, values: permissions });
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

export function requestedOwnerId(request: Request, account: CurrentAccount) {
  if (account.role === "SALES") return account.id;
  const requested = new URL(request.url).searchParams.get("user_id")?.trim();
  return requested || null;
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
