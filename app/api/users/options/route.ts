import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { PERMISSION_CATALOG } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { account: profile } = await requireUser();
    const permission = new URL(request.url).searchParams.get("permission") || "";
    const definition = PERMISSION_CATALOG.find((item) => item.code === permission);
    // 用户选项属于跨用户数据。普通页面查看权限不能借此枚举全部账号；
    // 操作日志只有系统管理员可以切换操作人。
    const canSelectOwner = profile.role === "ADMIN"
      || Boolean(permission && definition?.kind === "DATA" && hasPermission(profile, permission));
    if (!canSelectOwner) return NextResponse.json({ profile, users: [], can_select_owner: false });
    let query = createAdminClient().from("users").select("id,name,email,role").eq("status", "ACTIVE").in("role", ["ADMIN", "SUPERVISOR", "SALES"]);
    if (profile.role === "SUPERVISOR") query = query.or(`id.eq.${profile.id},manager_id.eq.${profile.id}`);
    const { data, error } = await query.order("name");
    if (error) throw error;
    return NextResponse.json({ profile, users: data || [], can_select_owner: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
