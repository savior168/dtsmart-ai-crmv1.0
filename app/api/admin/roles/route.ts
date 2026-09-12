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
    const { error } = await admin.from("role_permission_settings").upsert({ role_code: role, permission_code: permission, enabled, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
    // A hidden page must not retain enabled child permissions in storage. This
    // makes the switch state, the effective authorization and the audit trail
    // agree instead of merely dimming an apparently-on child switch in the UI.
    if (!enabled && permissionPageCode(permission) === permission) {
      const childCodes = PERMISSION_CATALOG
        .filter((item) => item.code !== permission && permissionPageCode(item.code) === permission && !item.core)
        .map((item) => item.code);
      if (childCodes.length) {
        const { error: childrenError } = await admin.from("role_permission_settings").upsert(
          childCodes.map((permission_code) => ({ role_code: role, permission_code, enabled: false, updated_by: user.id, updated_at: new Date().toISOString() })),
          { onConflict: "role_code,permission_code" },
        );
        if (childrenError) throw childrenError;
      }
    }
    clearPermissionCache(role as "SUPERVISOR" | "SALES" | "WAREHOUSE");
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_ROLE_PERMISSION_UPDATE", target_type: "role", target_id: null, content: { role, permission, enabled } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "权限保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
