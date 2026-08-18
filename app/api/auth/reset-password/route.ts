import { NextRequest, NextResponse } from "next/server";
import { isEmail, normalizeEmail } from "@/lib/auth/identifiers";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = normalizeEmail(String(body.email || ""));
    if (!isEmail(email)) return NextResponse.json({ error: "请输入有效邮箱地址" }, { status: 400 });
    const origin = new URL(request.url).origin;
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
    if (error) throw error;
    return NextResponse.json({ ok: true, message: "重置邮件已发送，请检查收件箱和垃圾邮件" });
  } catch (error) {
    console.error("[auth/reset-password]", error);
    return NextResponse.json({ error: error instanceof Error ? `重置邮件发送失败：${error.message}` : "重置邮件发送失败" }, { status: 400 });
  }
}
