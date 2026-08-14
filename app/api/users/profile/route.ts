import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const payload: Record<string, string | null> = {};
    if ("name" in body) payload.name = String(body.name || "").trim() || null;
    if ("avatar_url" in body) payload.avatar_url = String(body.avatar_url || "").trim() || null;
    if ("email" in body) {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
      }
      const { error: authError } = await supabase.auth.updateUser({ email });
      if (authError) throw authError;
      payload.email = email;
    }
    if (!Object.keys(payload).length) {
      return NextResponse.json({ error: "没有需要保存的资料" }, { status: 400 });
    }
    const { error } = await supabase.from("users").update(payload).eq("id", user.id);
    if (error) throw error;
    await writeAudit(supabase, user.id, "USER_PROFILE_UPDATE", "user", user.id, payload);
    return NextResponse.json({ ok: true, message: "email" in body ? "资料已保存；邮箱变更可能需要完成确认邮件" : "资料已保存" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "资料修改失败" }, { status: 400 });
  }
}
