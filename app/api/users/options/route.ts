import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { PERMISSION_CATALOG } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { account: profile } = await requireUser();
    const params = new URL(request.url).searchParams;
    const permission = params.get("permission") || "";
    const creatorOptions = params.get("kind") === "pi_creator";
    const definition = PERMISSION_CATALOG.find((item) => item.code === permission);
    // 用户选项属于跨用户数据。普通页面查看权限不能借此枚举全部账号；
    // 操作日志只有系统管理员可以切换操作人。
    const canSelectOwner = profile.role === "ADMIN"
      || Boolean(permission && definition?.kind === "DATA" && hasPermission(profile, permission));
    if (!canSelectOwner) return NextResponse.json({ profile, users: [], can_select_owner: false });
    if (creatorOptions && !["orders.data_all", "stock.data_all"].includes(permission)) throw new Error("FORBIDDEN");
    let query = createAdminClient().from("users").select("id,name,email,role,status");
    if (!creatorOptions) query = query.eq("status", "ACTIVE").in("role", ["ADMIN", "SUPERVISOR", "SALES"]);
    if (profile.role === "SUPERVISOR") query = profile.supervisor_can_view_subordinates
      ? query.or(`id.eq.${profile.id},manager_id.eq.${profile.id}`)
      : query.eq("id", profile.id);
    const { data, error } = await query.order("name");
    if (error) throw error;
    return NextResponse.json({ profile, users: data || [], can_select_owner: true,
      can_select_all: profile.role !== "SUPERVISOR",
      default_all: !["ADMIN", "SUPERVISOR"].includes(profile.role) || creatorOptions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
