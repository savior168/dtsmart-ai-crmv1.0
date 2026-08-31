import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORE_PERMISSION_CODES, PERMISSION_CATALOG, isKnownPermission, normalizeRole } from "@/lib/auth/permissions";

type OverrideEffect = "ALLOW" | "DENY" | "INHERIT";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();
    const [{ data: target, error: targetError }, { data: overrides, error: overrideError }] = await Promise.all([
      admin.from("users").select("id,name,email,role,status").eq("id", id).maybeSingle(),
      admin.from("user_permission_overrides").select("permission_code,effect,updated_at").eq("user_id", id),
    ]);
    if (targetError || !target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    if (overrideError) throw overrideError;
    const role = normalizeRole(target.role);
    const { data: roleRows, error: roleError } = await admin.from("role_permission_settings")
      .select("permission_code,enabled").eq("role_code", role);
    if (roleError) throw roleError;
    return NextResponse.json({
      user: target,
      catalog: PERMISSION_CATALOG,
      role_permissions: (roleRows || []).filter((item) => item.enabled).map((item) => item.permission_code),
      overrides: overrides || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户权限加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAdmin();
    const { id } = await context.params;
    if (id === user.id) return NextResponse.json({ error: "不能修改当前登录系统管理员的个性权限" }, { status: 400 });
    const body = await request.json() as { permission?: string; effect?: OverrideEffect };
    const permission = String(body.permission || "");
    const effect = String(body.effect || "").toUpperCase() as OverrideEffect;
    if (!isKnownPermission(permission) || !["ALLOW", "DENY", "INHERIT"].includes(effect)) {
      return NextResponse.json({ error: "权限参数无效" }, { status: 400 });
    }
    if (CORE_PERMISSION_CODES.has(permission)) {
      return NextResponse.json({ error: "系统核心权限不能通过用户个性权限下放或关闭" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.from("users").select("id,name,email,role").eq("id", id).maybeSingle();
    if (targetError || !target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    if (normalizeRole(target.role) === "ADMIN") return NextResponse.json({ error: "系统管理员固定拥有全部权限" }, { status: 400 });
    if (normalizeRole(target.role) === "SALES" && effect === "ALLOW" && PERMISSION_CATALOG.find((item) => item.code === permission)?.kind === "DATA") {
      return NextResponse.json({ error: "销售员不能获得跨用户数据权限" }, { status: 400 });
    }
    if (effect === "INHERIT") {
      const { error } = await admin.from("user_permission_overrides").delete().eq("user_id", id).eq("permission_code", permission);
      if (error) throw error;
    } else {
      const { error } = await admin.from("user_permission_overrides").upsert({ user_id: id, permission_code: permission, effect, updated_by: user.id, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "ADMIN_USER_PERMISSION_UPDATE",
      target_type: "user",
      target_id: id,
      content: { target_name: target.name, target_email: target.email, permission, effect },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户权限保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
