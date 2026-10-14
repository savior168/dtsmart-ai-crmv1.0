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
  // Supabase merges user_metadata updates. Setting this to null is required;
  // deleting the property locally would leave an old Base64 avatar intact.
  metadata.avatar_url = null;
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
      if (!isUsername(username)) return NextResponse.json({ error: "用户名需为 1-15 位中文、字母、数字、下划线或短横线" }, { status: 400 });
      const normalized = username.toLowerCase();
      const users = await listAuthUsers();
      if (users.some((item) => item.id !== user.id && String(item.user_metadata?.username || item.user_metadata?.name || "").trim().toLowerCase() === normalized)) {
        return NextResponse.json({ error: "该用户名已被使用" }, { status: 409 });
      }
      // public.users has the database-level case-insensitive unique index. Write
      // it first so a concurrent rename cannot create two login usernames.
      const { data: storedProfile, error: storedProfileError } = await admin.from("users").select("name").eq("id", user.id).single();
      if (storedProfileError) throw storedProfileError;
      const { error: usersError } = await admin.from("users").update({ name: username }).eq("id", user.id);
      if (usersError) {
        if (usersError.code === "23505") return NextResponse.json({ error: "该用户名已被使用" }, { status: 409 });
        throw usersError;
      }
      const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...sessionSafeMetadata(user.user_metadata), username, name: username } });
      if (metadataError) {
        await admin.from("users").update({ name: storedProfile.name }).eq("id", user.id);
        throw metadataError;
      }
      payload.name = username;
    }
    if ("avatar_url" in body) {
      const avatarUrl = String(body.avatar_url || "").trim();
      if (avatarUrl.startsWith("data:") || avatarUrl.length > 2048) {
        return NextResponse.json({ error: "头像必须先上传到文件存储，不能保存 Base64 图片" }, { status: 400 });
      }
      payload.avatar_url = avatarUrl || null;
    }
    if ("email" in body) {
      return NextResponse.json({ error: "登录邮箱不能在个人资料中修改" }, { status: 400 });
    }
    if ("business_phone" in body) {
      const phone = String(body.business_phone || "").trim();
      if (phone.length > 80 || (phone && !/^\+?[\d\s().-]{6,80}$/.test(phone))) {
        return NextResponse.json({ error: "业务联系电话格式不正确" }, { status: 400 });
      }
      payload.business_phone = phone || null;
    }
    if ("business_email" in body) {
      const email = String(body.business_email || "").trim();
      if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return NextResponse.json({ error: "业务邮箱格式不正确" }, { status: 400 });
      }
      payload.business_email = email || null;
    }
    if (!Object.keys(payload).length) {
      return NextResponse.json({ error: "没有需要保存的资料" }, { status: 400 });
    }
    await writeAudit(supabase, user.id, "USER_PROFILE_UPDATE", "user", user.id, payload);
    const profilePayload: Record<string, string | null> = { id: user.id };
    if ("name" in payload) profilePayload.name = payload.name;
    if ("avatar_url" in payload) profilePayload.avatar_url = payload.avatar_url;
    if ("business_phone" in payload) profilePayload.business_phone = payload.business_phone;
    if ("business_email" in payload) profilePayload.business_email = payload.business_email;
    const { error: profileError } = await admin.from("profiles").upsert(profilePayload);
    if (profileError) throw profileError;
    return NextResponse.json({ ok: true, message: "资料已同步保存" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "资料修改失败" }, { status: 400 });
  }
}
