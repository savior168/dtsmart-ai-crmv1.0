import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { account: profile } = await requireUser();
    if (profile.role === "SALES") return NextResponse.json({ profile, users: [] });
    const { data, error } = await createAdminClient().from("users").select("id,name,email,role").eq("status", "ACTIVE").in("role", ["ADMIN", "SUPERVISOR", "SALES"]).order("name");
    if (error) throw error;
    return NextResponse.json({ profile, users: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "用户加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
