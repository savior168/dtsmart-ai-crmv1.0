import { NextRequest, NextResponse } from "next/server";
import { isEmail, isPhone, normalizeEmail, normalizePhone } from "@/lib/auth/identifiers";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const type = body.type === "phone" ? "phone" : "email";
    const contact = String(body.contact || "").trim();
    const token = String(body.token || "").replace(/\s/g, "");
    if (token.length < 6) return NextResponse.json({ error: "请输入完整验证码" }, { status: 400 });
    if (type === "email" && !isEmail(contact)) return NextResponse.json({ error: "请输入有效邮箱地址" }, { status: 400 });
    if (type === "phone" && !isPhone(contact)) return NextResponse.json({ error: "请输入有效国际格式手机号" }, { status: 400 });

    const supabase = await createClient();
    const payload = type === "email"
      ? { email: normalizeEmail(contact), token, type: "email" as const }
      : { phone: normalizePhone(contact), token, type: "sms" as const };
    const { data, error } = await supabase.auth.verifyOtp(payload);
    if (error || !data.user) return NextResponse.json({ error: "验证码错误或已过期，请重新获取" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth/verify-otp]", error);
    return NextResponse.json({ error: "验证码验证失败，请稍后重试" }, { status: 500 });
  }
}
