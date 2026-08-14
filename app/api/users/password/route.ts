import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const oldPassword = String(body.old_password || "");
    const newPassword = String(body.new_password || "");
    const confirmPassword = String(body.confirm_password || "");
    if (!oldPassword) return NextResponse.json({ error: "请输入原密码" }, { status: 400 });
    if (newPassword.length < 8) return NextResponse.json({ error: "新密码至少需要8位" }, { status: 400 });
    if (newPassword !== confirmPassword) return NextResponse.json({ error: "两次输入的新密码不一致" }, { status: 400 });

    const authClient = await createClient();
    const { error: verifyError } = await authClient.auth.signInWithPassword({ email: user.email || "", password: oldPassword });
    if (verifyError) return NextResponse.json({ error: "原密码验证失败" }, { status: 400 });
    const { error: updateError } = await authClient.auth.updateUser({ password: newPassword });
    if (updateError) throw updateError;
    await writeAudit(supabase, user.id, "USER_PASSWORD_UPDATE", "user", user.id, {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "密码修改失败" }, { status: 400 });
  }
}
