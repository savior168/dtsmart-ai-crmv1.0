import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { NOTIFICATION_TYPES } from "@/lib/notification-policy";

export async function GET() {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const [policies, announcements] = await Promise.all([
      admin.from("notification_delivery_policies").select("type,popup_enabled,voice_enabled,updated_at"),
      admin.from("system_announcements").select("id,title,content,published_at,published_by,recipient_roles,recipient_count").order("published_at", { ascending: false }).limit(20),
    ]);
    if (policies.error) throw policies.error;
    if (announcements.error) throw announcements.error;
    return NextResponse.json({
      policies: NOTIFICATION_TYPES.map(item => {
        const saved = policies.data?.find(row => row.type === item.type);
        return { type: item.type, label: item.label, popup_enabled: saved?.popup_enabled ?? item.popup, voice_enabled: saved?.voice_enabled ?? item.voice };
      }),
      announcements: announcements.data || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知管理加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json() as { type?: unknown; popup_enabled?: unknown; voice_enabled?: unknown };
    if (typeof body.type !== "string" || !NOTIFICATION_TYPES.some(item => item.type === body.type)
      || typeof body.popup_enabled !== "boolean" || typeof body.voice_enabled !== "boolean") {
      return NextResponse.json({ error: "通知类型或开关值无效" }, { status: 400 });
    }
    const { error } = await supabase.rpc("set_notification_delivery_policy", {
      p_type: body.type, p_popup_enabled: body.popup_enabled, p_voice_enabled: body.voice_enabled,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知策略保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

