import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_STATUSES, USER_ROLES, normalizeRole } from "@/lib/auth/permissions";

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("")}!8a`;
}

async function activeAdminCount() {
  const { count, error } = await createAdminClient().from("users")
    .select("id", { count: "exact", head: true }).eq("role", "ADMIN").eq("status", "ACTIVE");
  if (error) throw error;
  return count || 0;
}

async function protectLastAdmin(target: { id: string; role: string; status: string }, nextRole?: string, nextStatus?: string) {
  const removesActiveAdmin = target.role === "ADMIN" && target.status === "ACTIVE" &&
    ((nextRole && nextRole !== "ADMIN") || (nextStatus && nextStatus !== "ACTIVE"));
  if (removesActiveAdmin && await activeAdminCount() <= 1) throw new Error("必须保留至少一名已启用的系统管理员");
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = params.get("search")?.trim() || "";
    const status = params.get("status")?.trim().toUpperCase() || "";
    const role = params.get("role")?.trim().toUpperCase() || "";
    const admin = createAdminClient();
    let query = admin.from("users").select("id,name,email,role,status,created_at,reviewed_at,review_reason,last_login_at,must_change_password,locked_until", { count: "exact" });
    if (search) query = query.or(`name.ilike.%${search.replace(/[%,()]/g, " ")}%,email.ilike.%${search.replace(/[%,()]/g, " ")}%`);
    if (ACCOUNT_STATUSES.includes(status as never)) query = query.eq("status", status);
    if (USER_ROLES.includes(role as never)) query = query.eq("role", role);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: count || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户列表加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const id = String(body.id || "");
    const action = String(body.action || "").toUpperCase();
    const reason = String(body.reason || "").trim();
    if (!id) return NextResponse.json({ error: "缺少用户ID" }, { status: 400 });
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.from("users").select("id,name,email,role,status").eq("id", id).maybeSingle();
    if (targetError || !target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    const update: Record<string, unknown> = { reviewed_by: user.id, reviewed_at: new Date().toISOString() };
    if (action === "APPROVE" || action === "ACTIVATE") Object.assign(update, { status: "ACTIVE", review_reason: reason || null, locked_until: null, failed_login_attempts: 0 });
    else if (action === "REJECT") {
      if (!reason) return NextResponse.json({ error: "请填写拒绝原因" }, { status: 400 });
      await protectLastAdmin(target, undefined, "REJECTED");
      Object.assign(update, { status: "REJECTED", review_reason: reason });
    } else if (action === "DISABLE") {
      if (!reason) return NextResponse.json({ error: "请填写停用原因" }, { status: 400 });
      await protectLastAdmin(target, undefined, "DISABLED");
      Object.assign(update, { status: "DISABLED", review_reason: reason, force_logout_at: new Date().toISOString() });
    } else if (action === "UNLOCK") Object.assign(update, { status: "ACTIVE", locked_until: null, failed_login_attempts: 0, review_reason: reason || null });
    else if (action === "UPDATE_ROLE") {
      if (id === user.id) return NextResponse.json({ error: "不能在用户管理中修改当前登录账号的角色" }, { status: 400 });
      const requestedRole = String(body.role || "").toUpperCase();
      if (!USER_ROLES.includes(requestedRole as never)) return NextResponse.json({ error: "角色无效" }, { status: 400 });
      const role = normalizeRole(requestedRole);
      await protectLastAdmin(target, role, undefined);
      Object.assign(update, { role, review_reason: reason || null });
    } else if (action === "FORCE_LOGOUT") Object.assign(update, { force_logout_at: new Date().toISOString(), review_reason: reason || "管理员强制退出" });
    else return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
    if (id === user.id && ["REJECT", "DISABLE", "FORCE_LOGOUT"].includes(action)) return NextResponse.json({ error: "不能对当前登录账号执行该操作" }, { status: 400 });
    const { error } = await admin.from("users").update(update).eq("id", id);
    if (error) throw error;
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: `ADMIN_USER_${action}`,
      target_type: "user",
      target_id: id,
      content: {
        target_name: target.name,
        target_email: target.email,
        reason,
        previous_role: target.role,
        previous_status: target.status,
        next_role: update.role,
        next_status: update.status,
      },
    });
    return NextResponse.json({ ok: true, message: "账号状态已更新" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "账号操作失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const id = String(body.id || "");
    const reason = String(body.reason || "").trim();
    if (!id || !reason) return NextResponse.json({ error: "请选择用户并填写重置原因" }, { status: 400 });
    if (id === user.id) return NextResponse.json({ error: "请在个人中心修改当前账号密码" }, { status: 400 });
    const admin = createAdminClient();
    const { data: target } = await admin.from("users").select("id,name,email,status").eq("id", id).maybeSingle();
    if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    const { data: settings } = await admin.from("system_security_settings").select("temporary_password_hours").eq("id", true).maybeSingle();
    const password = temporaryPassword();
    const expiresAt = new Date(Date.now() + Number(settings?.temporary_password_hours || 24) * 3600000).toISOString();
    const { error: authError } = await admin.auth.admin.updateUserById(id, { password });
    if (authError) throw authError;
    const now = new Date().toISOString();
    const { error } = await admin.from("users").update({ must_change_password: true, temporary_password_expires_at: expiresAt, password_reset_by: user.id, password_reset_at: now, force_logout_at: now, failed_login_attempts: 0, locked_until: null }).eq("id", id);
    if (error) throw error;
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "ADMIN_USER_PASSWORD_RESET",
      target_type: "user",
      target_id: id,
      content: { target_name: target.name, target_email: target.email, reason, expires_at: expiresAt },
    });
    return NextResponse.json({ ok: true, temporary_password: password, expires_at: expiresAt, message: "临时密码已生成，仅本次显示" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "密码重置失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
