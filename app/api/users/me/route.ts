import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const [{ data }, { data: profile }] = await Promise.all([
      supabase.from("users").select("id,name,email,role").eq("id", user.id).single(),
      supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle(),
    ]);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      name:
        data?.name ||
        String(user.user_metadata?.username || user.user_metadata?.name || "").trim() ||
        user.email ||
        "当前用户",
      role: data?.role || "SALES",
      avatar_url: profile?.avatar_url ? `/api/users/avatar?v=${encodeURIComponent(profile.avatar_url)}` : "",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
  } catch {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
}
