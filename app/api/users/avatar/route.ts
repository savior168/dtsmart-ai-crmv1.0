import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { user } = await requireUser();
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const path = String(profile?.avatar_url || "");
    if (!path) return new NextResponse(null, { status: 404 });
    const { data, error } = await admin.storage.from("avatars").download(path);
    if (error) throw error;
    return new NextResponse(await data.arrayBuffer(), {
      headers: {
        "Content-Type": data.type || "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
