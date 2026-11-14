import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_STATUSES } from "@/lib/auth/permissions";
import { readRoleDefinitions, resolveAssignableRole } from "@/lib/auth/role-registry";
import { canApplyLifecycleAction, canSetTimedLock, canUnlockAccount, effectiveAccountStatus } from "@/lib/auth/lockout";
import { isUsername, listAuthUsers } from "@/lib/auth/identifiers";
import { managerAssignmentCreatesCycle } from "@/lib/auth/subordinate-scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("")}!8a`;
}

async function activeAdminCount() {
  const now = new Date().toISOString();
  const { count, error } = await createAdminClient().from("users")
    .select("id", { count: "exact", head: true }).eq("role", "ADMIN").eq("status", "ACTIVE").or(`locked_until.is.null,locked_until.lte.${now}`);
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
    const pageSize = Math.min(500, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = params.get("search")?.trim() || "";
    const status = params.get("status")?.trim().toUpperCase() || "";
    const role = params.get("role")?.trim().toUpperCase() || "";
    const admin = createAdminClient();
    let query = admin.from("users").select("id,name,email,role,status,created_at,reviewed_at,review_reason,last_login_at,must_change_password,failed_login_attempts,locked_until,manager_id,departed_at", { count: "exact" });
    if (search) query = query.or(`name.ilike.%${search.replace(/[%,()]/g, " ")}%,email.ilike.%${search.replace(/[%,()]/g, " ")}%`);
    const now = new Date().toISOString();
    if (status === "LOCKED") query = query.or(`status.eq.LOCKED,and(status.eq.ACTIVE,locked_until.gt.${now})`);
    else if (status === "ACTIVE") query = query.eq("status", "ACTIVE").or(`locked_until.is.null,locked_until.lte.${now}`);
    else if (ACCOUNT_STATUSES.includes(status as never)) query = query.eq("status", status);
    if (/^[A-Z][A-Z0-9_]{1,39}$/.test(role)) query = query.eq("role", role);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    const supervisors: Array<{ id: string; name: string; email: string; role: string; manager_id: string | null; locked_until: string | null }> = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await admin.from("users").select("id,name,email,role,manager_id,locked_until")
        .eq("status", "ACTIVE").order("name").order("id").range(offset, offset + 499);
      if (batch.error) throw batch.error;
      supervisors.push(...(batch.data || []));
      if (!batch.data || batch.data.length < 500) break;
    }
    const roles = await readRoleDefinitions(admin);
    return NextResponse.json({ data: (data || []).map(item => ({ ...item, status: effectiveAccountStatus(item.status, item.locked_until) })), count: count || 0, page, pageSize, supervisors, roles: roles.data });
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
    const { data: target, error: targetError } = await admin.from("users").select("id,name,email,role,status,manager_id,locked_until").eq("id", id).maybeSingle();
    if (targetError || !target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    if (!canApplyLifecycleAction(target.status, action)) return NextResponse.json({ error: "账号当前状态不支持该操作，请刷新列表" }, { status: 409 });
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
    } else if (action === "DEPART") {
      if (!reason) return NextResponse.json({ error: "请填写离职原因" }, { status: 400 });
      await protectLastAdmin(target, undefined, "DEPARTED");
      Object.assign(update, { status: "DEPARTED", departed_at: new Date().toISOString(), review_reason: reason, force_logout_at: new Date().toISOString() });
    } else if (action === "LOCK") {
      const minutes = Number(body.lock_minutes);
      if (!canSetTimedLock(target.status)) return NextResponse.json({ error: "只能锁定已启用账号；停用和离职是独立状态" }, { status: 400 });
      if (!reason || !Number.isInteger(minutes) || minutes < 1 || minutes > 43200) return NextResponse.json({ error: "请填写锁定原因及 1 至 43200 分钟的整数时长" }, { status: 400 });
      const alreadyLocked = canUnlockAccount(target.status, target.locked_until);
      if (target.role === "ADMIN" && !alreadyLocked) {
        const now = new Date().toISOString();
        const { count, error: countError } = await admin.from("users").select("id", { count: "exact", head: true })
          .eq("role", "ADMIN").eq("status", "ACTIVE").or(`locked_until.is.null,locked_until.lte.${now}`);
        if (countError) throw countError;
        if ((count || 0) <= 1) return NextResponse.json({ error: "至少保留一名未锁定且已启用的系统管理员" }, { status: 409 });
      }
      Object.assign(update, { status: "ACTIVE", locked_until: new Date(Date.now() + minutes * 60000).toISOString(), failed_login_attempts: 0, force_logout_at: new Date().toISOString(), review_reason: reason });
    } else if (action === "UNLOCK") {
      if (!reason) return NextResponse.json({ error: "请填写提前解锁原因" }, { status: 400 });
      if (!canUnlockAccount(target.status, target.locked_until)) return NextResponse.json({ error: "账号当前未锁定" }, { status: 409 });
      Object.assign(update, { status: "ACTIVE", locked_until: null, failed_login_attempts: 0, review_reason: reason });
    }
    else if (action === "UPDATE_ROLE") {
      if (id === user.id) return NextResponse.json({ error: "不能在用户管理中修改当前登录账号的角色" }, { status: 400 });
      const role = await resolveAssignableRole(admin, body.role);
      if (!role) return NextResponse.json({ error: "角色不存在、已停用或尚未通过权限安全验证" }, { status: 400 });
      await protectLastAdmin(target, role, undefined);
      const managerId = String(body.manager_id !== undefined ? body.manager_id || "" : target.manager_id || "") || null;
      if (role === "SALES" && !managerId) return NextResponse.json({ error: "销售员必须选择一名已启用的上级" }, { status: 400 });
      if (managerId === target.id) return NextResponse.json({ error: "用户不能设置自己为上级" }, { status: 400 });
      if (managerId && await managerAssignmentCreatesCycle(target.id, managerId)) {
        return NextResponse.json({ error: "不能将下属设为上级，否则会形成循环" }, { status: 400 });
      }
      if (managerId) {
        const { data: manager, error: managerError } = await admin.from("users").select("id,role,status,locked_until").eq("id", managerId).maybeSingle();
        if (managerError) throw managerError;
        if (!manager || manager.status !== "ACTIVE" || (manager.locked_until && Date.parse(manager.locked_until) > Date.now())) {
          return NextResponse.json({ error: "请选择未锁定且已启用的用户作为上级" }, { status: 400 });
        }
      }
      Object.assign(update, { role, manager_id: managerId, force_logout_at: new Date().toISOString(), review_reason: reason || null });
      if (role !== target.role) update.supervisor_can_view_subordinates = false;
    } else if (action === "UPDATE_MANAGER") {
      const managerId = String(body.manager_id || "");
      if (!managerId) {
        if (target.role === "SALES") return NextResponse.json({ error: "销售员必须设置一名已启用的上级" }, { status: 400 });
        Object.assign(update, { manager_id: null, review_reason: reason || null });
      } else {
        if (managerId === target.id) return NextResponse.json({ error: "用户不能设置自己为上级" }, { status: 400 });
        if (await managerAssignmentCreatesCycle(target.id, managerId)) {
          return NextResponse.json({ error: "不能将下属设为上级，否则会形成循环" }, { status: 400 });
        }
        const { data: manager, error: managerError } = await admin.from("users").select("id,name,email,role,status,locked_until").eq("id", managerId).maybeSingle();
        if (managerError) throw managerError;
        if (!manager || manager.status !== "ACTIVE" || (manager.locked_until && Date.parse(manager.locked_until) > Date.now())) return NextResponse.json({ error: "请选择未锁定且已启用的用户作为上级" }, { status: 400 });
        Object.assign(update, { manager_id: manager.id, review_reason: reason || null });
      }
    } else if (action === "FORCE_LOGOUT") Object.assign(update, { force_logout_at: new Date().toISOString(), review_reason: reason || "管理员强制退出" });
    else return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
    if (id === user.id && ["REJECT", "DISABLE", "DEPART", "LOCK", "FORCE_LOGOUT"].includes(action)) return NextResponse.json({ error: "不能对当前登录账号执行该操作" }, { status: 400 });
    const { error } = await admin.from("users").update(update).eq("id", id);
    if (error) throw error;
    if (["APPROVE", "REJECT"].includes(action)) {
      await admin.from("system_notifications").update({ action_status: "RESOLVED" })
        .eq("entity_type", "user").eq("entity_id", id).eq("type", "REGISTRATION_REVIEW");
    }
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
        previous_manager_id: target.manager_id,
        next_manager_id: update.manager_id,
        previous_locked_until: target.locked_until,
        next_locked_until: update.locked_until,
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
      const action = String(body.action || "RESET_PASSWORD").toUpperCase();
    if (action === "CREATE") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const requestedRole = body.role || "SALES";
      if (!isUsername(name) || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "用户名需为 1-15 位中文、字母、数字、下划线或短横线，并填写有效邮箱" }, { status: 400 });
      const managerId = String(body.manager_id || "");
      const admin = createAdminClient();
      const role = await resolveAssignableRole(admin, requestedRole);
      if (!role) return NextResponse.json({ error: "角色不存在、已停用或尚未通过权限安全验证" }, { status: 400 });
      const normalizedName = name.toLowerCase();
      const authUsers = await listAuthUsers();
      if (authUsers.some((item) => String(item.user_metadata?.username || item.user_metadata?.name || "").trim().toLowerCase() === normalizedName)) {
        return NextResponse.json({ error: "该用户名已被使用" }, { status: 409 });
      }
      if (role === "SALES" && !managerId) return NextResponse.json({ error: "请为销售员选择直属上级" }, { status: 400 });
      let effectiveManager: string | null = null;
      if (managerId) {
        if (!UUID.test(managerId)) return NextResponse.json({ error: "上级账号无效" }, { status: 400 });
        const { data: manager, error: managerError } = await admin.from("users").select("id,status,locked_until").eq("id", managerId).maybeSingle();
        if (managerError) throw managerError;
        if (!manager || manager.status !== "ACTIVE" || (manager.locked_until && Date.parse(manager.locked_until) > Date.now())) return NextResponse.json({ error: "请选择未锁定且已启用的用户作为上级" }, { status: 400 });
        effectiveManager = manager.id;
      }
      const password = temporaryPassword();
      const { data: authCreated, error: authCreateError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: name, name } });
      if (authCreateError || !authCreated.user) throw authCreateError || new Error("用户创建失败");
      const createdId = authCreated.user.id;
      const { data: settings } = await admin.from("system_security_settings").select("temporary_password_hours").eq("id", true).maybeSingle();
      const expiresAt = new Date(Date.now() + Number(settings?.temporary_password_hours || 24) * 3600000).toISOString();
      const { error: profileError } = await admin.from("users").update({ name, email, role, status: "ACTIVE", manager_id: effectiveManager, must_change_password: true, temporary_password_expires_at: expiresAt, reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_reason: "系统管理员创建账号" }).eq("id", createdId);
      if (profileError) {
        await admin.auth.admin.deleteUser(createdId);
        throw profileError;
      }
      await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_USER_CREATE", target_type: "user", target_id: createdId, content: { target_name: name, target_email: email, role, manager_id: effectiveManager } });
      return NextResponse.json({ ok: true, temporary_password: password, expires_at: expiresAt, message: "用户已创建并启用，临时密码仅本次显示" });
    }
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

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const id = String(body.id || "");
    const reason = String(body.reason || "").trim();
    if (!id || !reason) return NextResponse.json({ error: "请选择用户并填写删除原因" }, { status: 400 });
    if (id === user.id) return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 });
    const admin = createAdminClient();
    const { data: target } = await admin.from("users").select("id,name,email,role,status").eq("id", id).maybeSingle();
    if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    await protectLastAdmin(target, undefined, "DEPARTED");
    const { data: hasHistory, error: historyError } = await admin.rpc("user_has_business_history", { p_user_id: id });
    if (historyError) throw historyError;
    if (typeof hasHistory !== "boolean") throw new Error("无法核验用户业务历史，已取消删除");
    if (hasHistory) return NextResponse.json({ error: "该账号已有业务或审计记录，不能物理删除。请先标记离职并完成客户交接，系统将保留历史身份用于追溯。" }, { status: 409 });
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_USER_DELETE", target_type: "user", target_id: id, content: { target_name: target.name, target_email: target.email, reason } });
    return NextResponse.json({ ok: true, message: "无业务记录的账号已删除" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户删除失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
