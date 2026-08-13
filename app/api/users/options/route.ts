import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data: profile, error: profileError } = await supabase.from("users").select("id,role").eq("id", user.id).single();
    if (profileError) throw profileError;
    if (profile.role !== "ADMIN") return NextResponse.json({ profile, users: [] });
    const { data, error } = await supabase.from("users").select("id,name,email,role").eq("status", "ACTIVE").in("role", ["SALES", "MANAGER"]).order("name");
    if (error) throw error;
    return NextResponse.json({ profile, users: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
