import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { USER_ROLES } from "@/lib/auth/permissions";

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await createAdminClient().from("role_permission_settings").select("role_code,permission_code,enabled,updated_at").order("role_code").order("permission_code");
    if (error) throw error;
    return NextResponse.json({ data: data || [] });
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
    if (!USER_ROLES.includes(role as never) || !permission) return NextResponse.json({ error: "权限参数无效" }, { status: 400 });
    if (role === "ADMIN") return NextResponse.json({ error: "系统管理员核心权限不可关闭" }, { status: 400 });
    const admin = createAdminClient();
    const { error } = await admin.from("role_permission_settings").upsert({ role_code: role, permission_code: permission, enabled, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_ROLE_PERMISSION_UPDATE", target_type: "role", target_id: null, content: { role, permission, enabled } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "权限保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
