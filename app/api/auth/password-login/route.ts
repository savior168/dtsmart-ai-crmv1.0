import { NextRequest, NextResponse } from "next/server";
import { classifyIdentifier, findUserByUsername, isUsername } from "@/lib/auth/identifiers";
import { createClient } from "@/lib/supabase/server";
import { verifyCaptcha } from "@/lib/auth/captcha";

function loginError(message?: string) {
  if (message?.includes("Email not confirmed") || message?.includes("Phone not confirmed")) {
    return "账号尚未启用，请联系管理员确认账号状态";
  }
  return "账号或密码错误，请检查后重试";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");
    if (!identifier || !password) return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
    const captcha = await verifyCaptcha(body.captcha);
    if (!captcha.ok) return NextResponse.json({ error: captcha.error }, { status: 400 });

    const classified = classifyIdentifier(identifier);
    let credentials: { email: string; password: string } | { phone: string; password: string };
    if (classified.type === "email") credentials = { email: classified.value, password };
    else if (classified.type === "phone") credentials = { phone: classified.value, password };
    else {
      if (!isUsername(identifier)) return NextResponse.json({ error: "请输入有效的用户名、邮箱或国际格式手机号" }, { status: 400 });
      const user = await findUserByUsername(identifier);
      if (!user) return NextResponse.json({ error: "账号或密码错误，请检查后重试" }, { status: 401 });
      if (user.email) credentials = { email: user.email, password };
      else if (user.phone) credentials = { phone: user.phone, password };
      else return NextResponse.json({ error: "该账号尚未绑定可登录的邮箱或手机号" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error || !data.user) return NextResponse.json({ error: loginError(error?.message) }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth/password-login]", error);
    return NextResponse.json({ error: "登录服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
