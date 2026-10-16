import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requireUser } from "@/lib/auth/current-user";
import { NOTIFICATION_TYPES } from "@/lib/notification-policy";

export async function GET() {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    if (!hasPermission(account, "notifications.view")) throw new Error("FORBIDDEN");
    const [preference, policies] = await Promise.all([
      supabase.from("user_notification_preferences").select("voice_enabled").eq("user_id", user.id).maybeSingle(),
      supabase.from("notification_delivery_policies").select("type,popup_enabled,voice_enabled"),
    ]);
    if (preference.error) throw preference.error;
    if (policies.error) throw policies.error;
    return NextResponse.json({
      voice_enabled: Boolean(preference.data?.voice_enabled),
      policies: NOTIFICATION_TYPES.map(item => {
        const stored = policies.data?.find(row => row.type === item.type);
        return { type: item.type, label: item.label, popup_enabled: stored?.popup_enabled ?? item.popup, voice_enabled: stored?.voice_enabled ?? item.voice };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知设置加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    if (!hasPermission(account, "notifications.view")) throw new Error("FORBIDDEN");
    const body = await request.json() as { voice_enabled?: unknown };
    if (typeof body.voice_enabled !== "boolean") return NextResponse.json({ error: "语音设置无效" }, { status: 400 });
    const { error } = await supabase.from("user_notification_preferences").upsert({
      user_id: user.id, voice_enabled: body.voice_enabled, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true, voice_enabled: body.voice_enabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "语音设置保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
