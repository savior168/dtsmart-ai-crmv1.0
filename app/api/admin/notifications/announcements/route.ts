import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json() as { request_id?: unknown; title?: unknown; content?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (typeof body.request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)
      || !title || title.length > 120 || !content || content.length > 4000) {
      return NextResponse.json({ error: "请填写有效的公告标题和内容" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("publish_system_announcement", {
      p_request_id: body.request_id, p_title: title, p_content: content,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "系统公告发布失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
