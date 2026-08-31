import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorStatus } from "@/lib/auth/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser({ allowPasswordChange: true });
    const { data, error } = await supabase.from("system_notifications").select("id,type,title,content,href,read_at,created_at").eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return NextResponse.json({ data: data || [], unread: (data || []).filter((item) => !item.read_at).length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser({ allowPasswordChange: true });
    const body = await request.json();
    let query = supabase.from("system_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", user.id).is("read_at", null);
    if (body.id) query = query.eq("id", String(body.id));
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
