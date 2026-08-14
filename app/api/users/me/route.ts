import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data } = await supabase.from("users").select("id,name,email,role,avatar_url").eq("id", user.id).single();
    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: data?.name || user.email || "当前用户",
      role: data?.role || "SALES",
      avatar_url: data?.avatar_url || "",
    });
  } catch {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
}
