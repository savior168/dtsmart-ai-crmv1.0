import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await createAdminClient().from("system_security_settings").select("max_failed_login_attempts,lock_minutes,temporary_password_hours,updated_at").eq("id", true).single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "安全设置加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json();
    const payload = {
      max_failed_login_attempts: Math.min(10, Math.max(3, Number(body.max_failed_login_attempts || 5))),
      lock_minutes: Math.min(1440, Math.max(5, Number(body.lock_minutes || 15))),
      temporary_password_hours: Math.min(168, Math.max(1, Number(body.temporary_password_hours || 24))),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const admin = createAdminClient();
    const { error } = await admin.from("system_security_settings").update(payload).eq("id", true);
    if (error) throw error;
    await admin.from("audit_logs").insert({ user_id: user.id, action: "ADMIN_SECURITY_SETTINGS_UPDATE", target_type: "security_settings", target_id: null, content: payload });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "安全设置保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
