import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

export async function GET() {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    const [{ data }, { data: profile }] = await Promise.all([
      supabase.from("users").select("id,name,email,phone,role").eq("id", user.id).single(),
      supabase.from("profiles").select("avatar_url,business_phone,business_email").eq("id", user.id).maybeSingle(),
    ]);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      phone: data?.phone || "",
      business_phone: profile?.business_phone || "",
      business_email: profile?.business_email || "",
      name:
        data?.name ||
        String(user.user_metadata?.username || user.user_metadata?.name || "").trim() ||
        user.email ||
        "当前用户",
      role: account.role,
      status: account.status,
      must_change_password: account.must_change_password,
      permissions: account.permissions,
      avatar_url: profile?.avatar_url ? `/api/users/avatar?v=${encodeURIComponent(profile.avatar_url)}` : "",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message === "SESSION_REVOKED" ? "会话已被管理员撤销，请重新登录" : "请先登录" }, { status: 401 });
  }
}
