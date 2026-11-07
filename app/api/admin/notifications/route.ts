import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { NOTIFICATION_TYPES } from "@/lib/notification-policy";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const isValidDate = (value: string) => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!isValidDate(from) || !isValidDate(to) || (from && to && from > to)) {
      return NextResponse.json({ error: "公告日期范围无效" }, { status: 400 });
    }
    const [policies, announcements] = await Promise.all([
      admin.from("notification_delivery_policies").select("type,popup_enabled,voice_enabled,updated_at"),
      (() => {
        let query = admin.from("system_announcements").select("id,title,content,published_at,published_by,recipient_roles,recipient_count").order("published_at", { ascending: false }).limit(100);
        if (from) query = query.gte("published_at", `${from}T00:00:00+08:00`);
        if (to) {
          const next = new Date(`${to}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          const exclusiveEnd = `${next.toISOString().slice(0, 10)}T00:00:00+08:00`;
          query = query.lt("published_at", exclusiveEnd);
        }
        return query;
      })(),
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

