import { NextRequest, NextResponse } from "next/server";
import { authUserMatchesContact, isEmail, isPhone, isUsername, listAuthUsers, normalizeEmail, normalizePhone } from "@/lib/auth/identifiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCaptcha } from "@/lib/auth/captcha";

export async function POST(request: NextRequest) {
  let createdUserId = "";
  try {
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const email = body.email ? normalizeEmail(String(body.email)) : "";
    const phone = body.phone ? normalizePhone(String(body.phone)) : "";
    const captcha = await verifyCaptcha(body.captcha);
    if (!captcha.ok) return NextResponse.json({ error: captcha.error }, { status: 400 });
    if (!isUsername(username)) return NextResponse.json({ error: "用户名需为 1-15 位中文、字母、数字、下划线或短横线" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    if (!isEmail(email)) return NextResponse.json({ error: "请输入有效邮箱地址" }, { status: 400 });
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
    const { data, error } = await admin.auth.admin.createUser({
      email,
      phone: phone || undefined,
      password,
      email_confirm: true,
      phone_confirm: Boolean(phone),
      user_metadata: { username, name: username, email, phone },
    });
    if (error || !data.user) throw error || new Error("创建用户失败");
    createdUserId = data.user.id;

    const { error: profileError } = await admin.from("users").upsert({
      id: data.user.id,
      name: username,
      email,
      role: "SALES",
      status: "PENDING",
      reviewed_by: null,
      reviewed_at: null,
      review_reason: null,
    });
    if (profileError) throw profileError;
    const { error: extendedProfileError } = await admin.from("profiles").upsert({ id: data.user.id, name: username, email, phone: phone || null });
    if (extendedProfileError && extendedProfileError.code !== "42P01") throw extendedProfileError;
    const { data: admins } = await admin.from("users").select("id").eq("role", "ADMIN").eq("status", "ACTIVE");
    if (admins?.length) {
      await admin.from("system_notifications").insert(admins.map((item) => ({
        recipient_id: item.id,
        type: "REGISTRATION_REVIEW",
        title: "新用户注册待审核",
        content: `${username}（${email}）提交了注册申请`,
        href: `/settings/users?status=PENDING&review=${data.user.id}`,
        metadata: { user_id: data.user.id, username, email },
      })));
    }
    return NextResponse.json({ ok: true, message: "注册申请已提交，请等待系统管理员审核。审核通过后即可登录。" }, { status: 201 });
  } catch (error) {
    console.error("[auth/register]", error);
    if (createdUserId) await createAdminClient().auth.admin.deleteUser(createdUserId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "注册失败";
    return NextResponse.json({ error: message.includes("already") ? "该邮箱或手机号已注册" : `注册失败：${message}` }, { status: 400 });
  }
}
