import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { PERMISSION_CATALOG } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeDescendantIds } from "@/lib/auth/subordinate-scope";
import { SUPERVISOR_TEAM_ALL_PERMISSIONS } from "@/lib/auth/supervisor-data-scope";
import { assignedSalesIds } from "@/lib/auth/order-clerk-scope";

export async function GET(request: Request) {
  try {
    const { account: profile } = await requireUser();
    const params = new URL(request.url).searchParams;
    const permission = params.get("permission") || "";
    const creatorOptions = params.get("kind") === "pi_creator";
    const salesOwnerOptions = params.get("kind") === "sales_owner";
    const definition = PERMISSION_CATALOG.find((item) => item.code === permission);
    // 用户选项属于跨用户数据。普通页面查看权限不能借此枚举全部账号；
    // 操作日志只有系统管理员可以切换操作人。
    const canSelectOwner = profile.role === "ADMIN"
      || Boolean(permission && definition?.kind === "DATA" && hasPermission(profile, permission));
    if (!canSelectOwner) return NextResponse.json({ profile, users: [], can_select_owner: false });
    if (creatorOptions && !["orders.data_all", "stock.data_all"].includes(permission)) throw new Error("FORBIDDEN");
    if (salesOwnerOptions && !["orders.data_all", "stock.data_all"].includes(permission)) throw new Error("FORBIDDEN");
    const clerkSalesIds = profile.role === "ORDER_CLERK" && ["customers.data_all", "orders.data_all", "stock.data_all"].includes(permission)
      ? await assignedSalesIds(profile.id) : null;
    if (clerkSalesIds && !clerkSalesIds.length && !creatorOptions) return NextResponse.json({ profile, users: [], can_select_owner: false });
    const admin = createAdminClient();
    const descendantIds = profile.role === "SUPERVISOR" && (permission === "customers.data_all"
      ? profile.supervisor_can_view_customers : profile.supervisor_can_view_subordinates)
      ? await activeDescendantIds(profile.id) : null;
    const users: Array<{ id: string; name: string; email: string; role: string; status: string }> = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query = admin.from("users").select("id,name,email,role,status");
      if (!creatorOptions) query = query.eq("status", "ACTIVE").in("role", ["ADMIN", "SUPERVISOR", "SALES"]);
      if (salesOwnerOptions) query = query.in("role", ["SUPERVISOR", "SALES"]);
      if (clerkSalesIds && !creatorOptions) query = query.in("id", clerkSalesIds);
      if (profile.role === "SUPERVISOR") query = descendantIds
        ? query.in("id", descendantIds)
        : query.eq("id", profile.id);
      const { data, error } = await query.order("name").order("id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      users.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return NextResponse.json({ profile, users, can_select_owner: true,
      can_select_all: profile.role !== "SUPERVISOR" || Boolean(
        (creatorOptions || permission === "sales.performance.data_all" || SUPERVISOR_TEAM_ALL_PERMISSIONS.has(permission))
        && descendantIds && descendantIds.length > 1),
      default_all: profile.role !== "SUPERVISOR" || creatorOptions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
