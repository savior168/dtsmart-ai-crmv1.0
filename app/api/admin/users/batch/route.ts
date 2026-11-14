import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { resolveAssignableRole } from "@/lib/auth/role-registry";
import { canApplyLifecycleAction } from "@/lib/auth/lockout";
import { createAdminClient } from "@/lib/supabase/admin";
import { managerAssignmentsCreatingCycles } from "@/lib/auth/subordinate-scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["UPDATE_ROLE", "UPDATE_MANAGER", "DISABLE", "DEPART", "ACTIVATE", "FORCE_LOGOUT", "DELETE"]);

type Target = { id: string; name: string | null; email: string; role: string; status: string; manager_id: string | null };

async function historyCount(id: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("user_has_business_history", { p_user_id: id });
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("无法核验用户业务历史，已取消删除");
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const ids = body.ids;
    const action = String(body.action || "").toUpperCase();
    const reason = String(body.reason || "").trim();
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "请选择 1 至 50 个不重复的用户" }, { status: 400 });
    }
    if (!ACTIONS.has(action)) return NextResponse.json({ error: "不支持的批量操作" }, { status: 400 });
    if (["DISABLE", "DEPART", "DELETE"].includes(action) && !reason) return NextResponse.json({ error: "请填写操作原因" }, { status: 400 });
    if (ids.includes(user.id)) return NextResponse.json({ error: "批量操作不能包含当前登录管理员" }, { status: 400 });

    const admin = createAdminClient();
    const { data, error } = await admin.from("users").select("id,name,email,role,status,manager_id").in("id", ids);
    if (error) throw error;
    const targets = (data || []) as Target[];
    if (targets.length !== ids.length) return NextResponse.json({ error: "部分用户不存在，请刷新列表后重试" }, { status: 409 });
    const targetById = new Map(targets.map((item) => [item.id, item]));
    const ordered = ids.map((id) => targetById.get(id)!);
    if (ordered.some((item) => !canApplyLifecycleAction(item.status, action))) {
      return NextResponse.json({ error: "部分账号当前状态不支持该批量操作，请刷新列表并重新选择" }, { status: 409 });
    }
    const nowForCount = new Date().toISOString();
    const { count: activeAdminCount, error: countError } = await admin.from("users")
      .select("id", { count: "exact", head: true }).eq("role", "ADMIN").eq("status", "ACTIVE")
      .or(`locked_until.is.null,locked_until.lte.${nowForCount}`);
    if (countError) throw countError;
    const requestedRole = action === "UPDATE_ROLE" ? await resolveAssignableRole(admin, body.role) : null;
    if (action === "UPDATE_ROLE" && (!requestedRole || requestedRole === "ADMIN")) {
      return NextResponse.json({ error: "批量修改角色只能选择已开放分配的非管理员角色；管理员角色须逐个审核设置" }, { status: 400 });
    }
    const removesAdmin = ordered.filter((item) => item.role === "ADMIN" && item.status === "ACTIVE" &&
      (["DISABLE", "DEPART", "DELETE"].includes(action) || (action === "UPDATE_ROLE" && requestedRole !== "ADMIN"))).length;
    if ((activeAdminCount || 0) - removesAdmin < 1) return NextResponse.json({ error: "必须保留至少一名已启用的系统管理员" }, { status: 409 });

    const managerId = String(body.manager_id || "");
    const requiresManager = (action === "UPDATE_MANAGER" && ordered.some((item) => item.role === "SALES"))
      || (action === "UPDATE_ROLE" && requestedRole === "SALES");
    if (requiresManager && !managerId) {
      return NextResponse.json({ error: "销售员必须设置已启用且未锁定的上级" }, { status: 400 });
    }
    if ((action === "UPDATE_MANAGER" || action === "UPDATE_ROLE") && managerId) {
      if (!UUID.test(managerId)) return NextResponse.json({ error: "上级账号无效" }, { status: 400 });
      if (ids.includes(managerId)) return NextResponse.json({ error: "不能把选中用户设置为自己的上级" }, { status: 400 });
      const { data: manager, error: managerError } = await admin.from("users").select("id,role,status,locked_until").eq("id", managerId).maybeSingle();
      if (managerError) throw managerError;
      if (!manager || manager.status !== "ACTIVE"
        || (manager.locked_until && Date.parse(manager.locked_until) > Date.now())) {
        return NextResponse.json({ error: "上级必须是已启用且未锁定的用户" }, { status: 400 });
      }
      const cycleIds = await managerAssignmentsCreatingCycles(ids, managerId);
      if (cycleIds.length) {
        const target = targetById.get(cycleIds[0]);
        return NextResponse.json({ error: `不能将 ${target?.name || target?.email || "该用户"} 的下属设为其上级` }, { status: 400 });
      }
    }
    if (action === "DELETE") {
      // Auth Admin deletion cannot be wrapped in a Postgres transaction. Do a
      // full preflight, then report each result; a newly added FK may still
      // reject an individual deletion, which must never be hidden.
      const counts: boolean[] = [];
      for (let start = 0; start < ordered.length; start += 5) {
        counts.push(...await Promise.all(ordered.slice(start, start + 5).map((item) => historyCount(item.id))));
      }
      const now = new Date().toISOString();
      const deleted: string[] = [];
      const departed: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const [index, target] of ordered.entries()) {
        if (counts[index]) {
          const result = await admin.from("users").update({ status: "DEPARTED", departed_at: now, force_logout_at: now, review_reason: reason, reviewed_by: user.id, reviewed_at: now }).eq("id", target.id);
          if (result.error) failed.push({ id: target.id, error: result.error.message });
          else departed.push(target.id);
          continue;
        }
        const result = await admin.auth.admin.deleteUser(target.id);
        if (!result.error) {
          deleted.push(target.id);
          continue;
        }
        // A business row may have appeared after preflight. The database
        // deletion guard rejects that race; preserve the identity instead.
        try {
          if (await historyCount(target.id)) {
            const departure = await admin.from("users").update({ status: "DEPARTED", departed_at: now, force_logout_at: now, review_reason: reason, reviewed_by: user.id, reviewed_at: now }).eq("id", target.id);
            if (departure.error) throw departure.error;
            departed.push(target.id);
          } else failed.push({ id: target.id, error: result.error.message });
        } catch (caught) {
          failed.push({ id: target.id, error: caught instanceof Error ? caught.message : result.error.message });
        }
      }
      const changes = [...deleted.map((id) => ({ id, outcome: "DELETED" })), ...departed.map((id) => ({ id, outcome: "DEPARTED" }))];
      if (changes.length) {
        const audit = await admin.from("audit_logs").insert(changes.map(({ id, outcome }) => ({ user_id: user.id, action: "ADMIN_USER_BATCH_DELETE", target_type: "user", target_id: id, content: { outcome, reason, target_email: targetById.get(id)?.email } })));
        if (audit.error) throw audit.error;
      }
      return NextResponse.json({ ok: failed.length === 0, deleted, departed, failed, message: `已删除 ${deleted.length} 个无历史账号，${departed.length} 个有历史账号标记离职；${failed.length} 个未完成` });
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { reviewed_by: user.id, reviewed_at: now, review_reason: reason || null };
    // The database trigger revokes a supervisor grant only when the role
    // actually changes; repeating the same role must not silently revoke it.
    if (action === "UPDATE_ROLE") Object.assign(update, {
      role: requestedRole,
      ...(managerId ? { manager_id: managerId } : requestedRole === "SALES" ? { manager_id: managerId } : {}),
      force_logout_at: now,
    });
    if (action === "UPDATE_MANAGER") Object.assign(update, { manager_id: managerId || null, force_logout_at: now });
    if (action === "DISABLE") Object.assign(update, { status: "DISABLED", force_logout_at: now });
    if (action === "DEPART") Object.assign(update, { status: "DEPARTED", departed_at: now, force_logout_at: now });
    if (action === "ACTIVATE") Object.assign(update, { status: "ACTIVE", departed_at: null, locked_until: null, failed_login_attempts: 0 });
    if (action === "FORCE_LOGOUT") Object.assign(update, { force_logout_at: now, review_reason: reason || "管理员批量强制退出" });
    const result = await admin.from("users").update(update).in("id", ids).select("id");
    if (result.error) throw result.error;
    if (result.data?.length !== ids.length) throw new Error("批量更新数量不一致，请核对数据及审计记录");
    const audit = await admin.from("audit_logs").insert(ordered.map((target) => ({ user_id: user.id, action: `ADMIN_USER_BATCH_${action}`, target_type: "user", target_id: target.id, content: { reason, previous_role: target.role, previous_status: target.status, previous_manager_id: target.manager_id, next_role: update.role, next_status: update.status, next_manager_id: update.manager_id } })));
    if (audit.error) throw audit.error;
    return NextResponse.json({ ok: true, updated: ids, message: `已完成 ${ids.length} 个账号的批量操作` });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "批量账号操作失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
