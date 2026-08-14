import { NextRequest, NextResponse } from "next/server";
import { isEmail, isPhone, normalizeEmail, normalizePhone } from "@/lib/auth/identifiers";
import { createClient } from "@/lib/supabase/server";

function otpError(message?: string, type?: string) {
  if (message?.includes("Signups not allowed") || message?.includes("User not found")) return "该账号尚未注册";
  if (message?.toLowerCase().includes("rate limit")) return "验证码发送过于频繁，请稍后再试";
  if (type === "phone" && (message?.includes("provider") || message?.includes("SMS"))) return "短信服务尚未配置，请先使用邮箱或密码登录";
  return message ? `验证码发送失败：${message}` : "验证码发送失败，请稍后重试";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const type = body.type === "phone" ? "phone" : "email";
    const contact = String(body.contact || "").trim();
    if (type === "email" && !isEmail(contact)) return NextResponse.json({ error: "请输入有效邮箱地址" }, { status: 400 });
    if (type === "phone" && !isPhone(contact)) return NextResponse.json({ error: "手机号须使用国际格式，例如 +8613800138000" }, { status: 400 });

    const supabase = await createClient();
    const payload = type === "email"
      ? { email: normalizeEmail(contact), options: { shouldCreateUser: false } }
      : { phone: normalizePhone(contact), options: { shouldCreateUser: false } };
    const { error } = await supabase.auth.signInWithOtp(payload);
    if (error) return NextResponse.json({ error: otpError(error.message, type) }, { status: 400 });
    return NextResponse.json({ ok: true, message: "验证码已发送，请注意查收" });
  } catch (error) {
    console.error("[auth/send-otp]", error);
    return NextResponse.json({ error: "验证码服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
