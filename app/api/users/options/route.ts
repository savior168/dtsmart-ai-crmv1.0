import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { account: profile } = await requireUser();
    const permission = new URL(request.url).searchParams.get("permission") || "";
    const canSelectOwner = permission ? hasPermission(profile, permission) : false;
    if (!canSelectOwner) return NextResponse.json({ profile, users: [], can_select_owner: false });
    const { data, error } = await createAdminClient().from("users").select("id,name,email,role").eq("status", "ACTIVE").in("role", ["ADMIN", "SUPERVISOR", "SALES"]).order("name");
    if (error) throw error;
    return NextResponse.json({ profile, users: data || [], can_select_owner: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
