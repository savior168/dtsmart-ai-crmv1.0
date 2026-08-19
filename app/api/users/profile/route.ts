import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";
import { isUsername, listAuthUsers } from "@/lib/auth/identifiers";
import { createAdminClient } from "@/lib/supabase/admin";

function sessionSafeMetadata(value: Record<string, unknown> | null | undefined) {
  const metadata = { ...(value || {}) };
  // Never embed an uploaded image/data URL in Supabase Auth metadata. Auth
  // metadata is copied into the session JWT and can make the browser Cookie
  // exceed Vercel's request-header limit. The avatar remains in public.users
  // and public.profiles, where the UI already reads it.
  delete metadata.avatar_url;
  return metadata;
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const admin = createAdminClient();
    const body = await request.json();
    const payload: Record<string, string | null> = {};
    if ("name" in body) {
      const username = String(body.name || "").trim();
      if (!isUsername(username)) return NextResponse.json({ error: "用户名需为 3-30 位中文、字母、数字、下划线或短横线" }, { status: 400 });
      const normalized = username.toLowerCase();
      const users = await listAuthUsers();
      if (users.some((item) => item.id !== user.id && String(item.user_metadata?.username || item.user_metadata?.name || "").trim().toLowerCase() === normalized)) {
        return NextResponse.json({ error: "该用户名已被使用" }, { status: 409 });
      }
      const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...sessionSafeMetadata(user.user_metadata), username, name: username } });
      if (metadataError) throw metadataError;
      payload.name = username;
    }
    if ("avatar_url" in body) {
      const avatarUrl = String(body.avatar_url || "").trim();
      if (avatarUrl.length > 1_500_000) return NextResponse.json({ error: "头像文件过大，请压缩后重试" }, { status: 400 });
      payload.avatar_url = avatarUrl || null;
    }
    if ("email" in body) {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 });
      }
      const { error: authError } = await admin.auth.admin.updateUserById(user.id, { email, email_confirm: true, user_metadata: { ...sessionSafeMetadata(user.user_metadata), email } });
      if (authError) throw authError;
      payload.email = email;
    }
    if (!Object.keys(payload).length) {
      return NextResponse.json({ error: "没有需要保存的资料" }, { status: 400 });
    }
    const { error } = await admin.from("users").update(payload).eq("id", user.id);
    if (error) throw error;
    await writeAudit(supabase, user.id, "USER_PROFILE_UPDATE", "user", user.id, payload);
    const { error: profileError } = await admin.from("profiles").upsert({ id: user.id, name: payload.name ?? undefined, email: payload.email ?? undefined, avatar_url: payload.avatar_url ?? undefined });
    if (profileError && profileError.code !== "42P01" && !/avatar_url.*(column|schema cache)/i.test(profileError.message)) throw profileError;
    return NextResponse.json({ ok: true, message: "资料已同步保存" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "资料修改失败" }, { status: 400 });
  }
}
