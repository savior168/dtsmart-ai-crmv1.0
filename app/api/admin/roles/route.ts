import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus, clearPermissionCache } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORE_PERMISSION_CODES, PERMISSION_CATALOG, USER_ROLES, isKnownPermission, permissionPageCode } from "@/lib/auth/permissions";

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await createAdminClient().from("role_permission_settings").select("role_code,permission_code,enabled,updated_at").order("role_code").order("permission_code");
    if (error) throw error;
    return NextResponse.json({ data: data || [], catalog: PERMISSION_CATALOG });
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
    if (!USER_ROLES.includes(role as never) || !isKnownPermission(permission)) return NextResponse.json({ error: "权限参数无效" }, { status: 400 });
    if (role === "ADMIN") return NextResponse.json({ error: "系统管理员核心权限不可关闭" }, { status: 400 });
    if (CORE_PERMISSION_CODES.has(permission)) return NextResponse.json({ error: "系统核心权限不能下放给非系统管理员" }, { status: 400 });
    if (["SALES","WAREHOUSE"].includes(role) && enabled && PERMISSION_CATALOG.find((item) => item.code === permission)?.kind === "DATA") return NextResponse.json({ error: "销售员或仓库员不能获得跨用户数据权限" }, { status: 400 });
    const admin = createAdminClient();
    const pagePermission = permissionPageCode(permission);
    // The UI disables these switches while their parent page is off, but the
    // API must enforce the same rule. Otherwise a direct request can store an
    // apparently-enabled child that is never effective at runtime.
    if (enabled && pagePermission !== permission) {
      const { data: pageSetting, error: pageSettingError } = await admin
        .from("role_permission_settings")
        .select("enabled")
        .eq("role_code", role)
        .eq("permission_code", pagePermission)
        .maybeSingle();
      if (pageSettingError) throw pageSettingError;
      if (!pageSetting?.enabled) {
        return NextResponse.json({ error: "请先开启所属页面权限，再开启数据范围或功能按钮" }, { status: 409 });
      }
    }
    const isPagePermission = pagePermission === permission;
    const pageChildren = isPagePermission
      ? PERMISSION_CATALOG.filter((item) => item.code !== permission && permissionPageCode(item.code) === permission && !item.core)
      : [];
    const roleCannotUseCrossUserData = ["SALES", "WAREHOUSE"].includes(role);
    const now = new Date().toISOString();
    // A page switch represents the complete usable module. Persist the page
    // and every configurable child in one statement so the UI, stored role
    // defaults and backend authorization can never end up half-enabled.
    const changes = [
      { permission_code: permission, enabled },
      ...pageChildren.map((item) => ({
        permission_code: item.code,
        enabled: enabled && !(roleCannotUseCrossUserData && item.kind === "DATA"),
      })),
    ];
    const { error } = await admin.from("role_permission_settings").upsert(
      changes.map((change) => ({ role_code: role, ...change, updated_by: user.id, updated_at: now })),
      { onConflict: "role_code,permission_code" },
    );
    if (error) throw error;
    clearPermissionCache(role as "SUPERVISOR" | "SALES" | "WAREHOUSE");
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_ROLE_PERMISSION_UPDATE", target_type: "role", target_id: null, content: { role, permission, enabled } });
    return NextResponse.json({ ok: true, changes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "权限保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
