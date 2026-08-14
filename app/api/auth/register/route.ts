import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authUserMatchesContact, isEmail, isPhone, isUsername, listAuthUsers, normalizeEmail, normalizePhone } from "@/lib/auth/identifiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  let createdUserId = "";
  try {
    const body = await request.json();
    const type = body.type === "phone" ? "phone" : "email";
    const username = String(body.username || "").trim();
    const name = String(body.name || "").trim() || username;
    const password = String(body.password || "");
    const email = body.email ? normalizeEmail(String(body.email)) : "";
    const phone = body.phone ? normalizePhone(String(body.phone)) : "";

    if (!isUsername(username)) return NextResponse.json({ error: "用户名需为 3-30 位中文、字母、数字、下划线或短横线" }, { status: 400 });
    if (name.length > 50) return NextResponse.json({ error: "姓名不能超过 50 个字符" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    if (type === "email" && !isEmail(email)) return NextResponse.json({ error: "请输入有效邮箱地址" }, { status: 400 });
    if (type === "phone" && !isPhone(phone)) return NextResponse.json({ error: "手机号须使用国际格式，例如 +8613800138000" }, { status: 400 });
    if (email && !isEmail(email)) return NextResponse.json({ error: "绑定邮箱格式不正确" }, { status: 400 });
    if (phone && !isPhone(phone)) return NextResponse.json({ error: "绑定手机号须使用国际格式" }, { status: 400 });

    const users = await listAuthUsers();
    const normalizedUsername = username.toLowerCase();
    if (users.some((user) => String(user.user_metadata?.username || "").trim().toLowerCase() === normalizedUsername)) {
      return NextResponse.json({ error: "该用户名已被使用" }, { status: 409 });
    }
    if (users.some((user) => authUserMatchesContact(user, email, phone))) {
      return NextResponse.json({ error: "该邮箱或手机号已绑定其他账号" }, { status: 409 });
    }

    const admin = createAdminClient();
    const storedEmail = email || `phone-${randomUUID()}@accounts.dtsmart.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email: storedEmail,
      phone: phone || undefined,
      password,
      email_confirm: false,
      phone_confirm: false,
      user_metadata: { username, name, email, phone },
    });
    if (error || !data.user) throw error || new Error("创建用户失败");
    createdUserId = data.user.id;

    const { error: profileError } = await admin.from("users").upsert({ id: data.user.id, name, email: storedEmail, role: "SALES", status: "ACTIVE" });
    if (profileError) throw profileError;
    const { error: extendedProfileError } = await admin.from("profiles").upsert({ id: data.user.id, name, email: email || null, phone: phone || null });
    if (extendedProfileError && extendedProfileError.code !== "42P01") throw extendedProfileError;

    const supabase = await createClient();
    const otpPayload = type === "email"
      ? { email, options: { shouldCreateUser: false } }
      : { phone, options: { shouldCreateUser: false } };
    const { error: otpError } = await supabase.auth.signInWithOtp(otpPayload);
    if (otpError) {
      await admin.auth.admin.deleteUser(data.user.id);
      createdUserId = "";
      const message = type === "phone"
        ? "短信服务尚未配置，暂时无法使用手机号注册。请改用邮箱注册。"
        : `验证邮件发送失败：${otpError.message}`;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, otp_sent: true, message: "账号已创建，验证码已发送" }, { status: 201 });
  } catch (error) {
    console.error("[auth/register]", error);
    if (createdUserId) await createAdminClient().auth.admin.deleteUser(createdUserId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "注册失败";
    return NextResponse.json({ error: message.includes("already") ? "该邮箱或手机号已注册" : `注册失败：${message}` }, { status: 400 });
  }
}
