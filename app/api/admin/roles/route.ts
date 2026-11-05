import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus, clearPermissionCache } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORE_PERMISSION_CODES, PERMISSION_CATALOG, USER_ROLES, isKnownPermission, isRetiredPermission, permissionPageCode } from "@/lib/auth/permissions";
import { rolePermissionChanges } from "@/lib/auth/role-permission-changes";
import { CUSTOM_ROLES_ENABLED, readRoleDefinitions, resolveConfigurableRole } from "@/lib/auth/role-registry";

const CUSTOM_ROLE_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

export async function POST(request: NextRequest) {
  if (!CUSTOM_ROLES_ENABLED) return NextResponse.json({ error: "自定义角色功能暂未开放" }, { status: 404 });
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const code = String(body.code || "").trim().toUpperCase();
    const name = String(body.name || "").trim();
    if (!CUSTOM_ROLE_CODE.test(code) || code === "MANAGER" || USER_ROLES.includes(code as never) || name.length < 1 || name.length > 80) {
      return NextResponse.json({ error: "请填写有效角色代码（2 至 40 位大写字母、数字或下划线）及 1 至 80 字角色名称" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("app_role_definitions")
      .insert({ code, name, is_system: false, enabled: true, created_by: user.id, updated_by: user.id })
      .select("code,name,is_system,enabled,assignment_enabled").single();
    if (error) throw error;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_CUSTOM_ROLE_CREATE", target_type: "role", target_id: null, content: { code, name } });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建角色失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PUT(request: NextRequest) {
  if (!CUSTOM_ROLES_ENABLED) return NextResponse.json({ error: "自定义角色功能暂未开放" }, { status: 404 });
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const code = String(body.code || "").trim().toUpperCase();
    const name = String(body.name || "").trim();
    const enabled = body.enabled;
    if (!CUSTOM_ROLE_CODE.test(code) || USER_ROLES.includes(code as never) || name.length < 1 || name.length > 80 || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "角色参数无效" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: existing, error: lookupError } = await admin.from("app_role_definitions")
      .select("code,name,enabled,is_system").eq("code", code).maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing || existing.is_system) return NextResponse.json({ error: "仅可修改自定义角色" }, { status: 404 });
    const now = new Date().toISOString();
    const { data, error } = await admin.from("app_role_definitions")
      .update({ name, enabled, updated_by: user.id, updated_at: now })
      .eq("code", code).eq("is_system", false).select("code,name,is_system,enabled,assignment_enabled").single();
    if (error) throw error;
    clearPermissionCache(code);
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_CUSTOM_ROLE_UPDATE", target_type: "role", target_id: null, content: { code, previous_name: existing.name, name, previous_enabled: existing.enabled, enabled } });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改角色失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function GET() {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const [settings, definitions] = await Promise.all([
      admin.from("role_permission_settings").select("role_code,permission_code,enabled,updated_at").order("role_code").order("permission_code"),
      readRoleDefinitions(admin),
    ]);
    const { data, error } = settings;
    if (error) throw error;
    const effectiveRows = (data || []).map((row) => ({
      ...row,
      enabled: row.role_code === "ADMIN" ? row.enabled : row.enabled && !CORE_PERMISSION_CODES.has(row.permission_code) && !CORE_PERMISSION_CODES.has(permissionPageCode(row.permission_code)),
    }));
    return NextResponse.json({ data: effectiveRows, catalog: PERMISSION_CATALOG.filter((item) => !isRetiredPermission(item.code)), roles: definitions.data, role_registry_ready: definitions.ready });
  } catch (error) {
    const message = error instanceof Error ? error.message : "角色权限加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const role = String(body.role || "").toUpperCase();
    const permission = String(body.permission || "");
    const enabled = Boolean(body.enabled);
    if (!isKnownPermission(permission) || isRetiredPermission(permission)) return NextResponse.json({ error: "权限参数无效或对应模块已停用" }, { status: 400 });
    const admin = createAdminClient();
    if (!await resolveConfigurableRole(admin, role)) return NextResponse.json({ error: "角色无效或已停用" }, { status: 400 });
    if (role === "ADMIN") return NextResponse.json({ error: "系统管理员核心权限不可关闭" }, { status: 400 });
    if (CORE_PERMISSION_CODES.has(permission) || CORE_PERMISSION_CODES.has(permissionPageCode(permission))) return NextResponse.json({ error: "系统核心权限不能下放给非系统管理员" }, { status: 400 });
    const now = new Date().toISOString();
    const changes = rolePermissionChanges(permission, enabled);
    const { error } = await admin.from("role_permission_settings").upsert(
      changes.map((change) => ({ role_code: role, ...change, updated_by: user.id, updated_at: now })),
      { onConflict: "role_code,permission_code" },
    );
    if (error) throw error;
    clearPermissionCache(role);
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_ROLE_PERMISSION_UPDATE", target_type: "role", target_id: null, content: { role, permission, enabled } });
    return NextResponse.json({ ok: true, changes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "权限保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
