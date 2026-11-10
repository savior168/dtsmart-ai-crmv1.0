import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

const validRequestId = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const requestId = request.nextUrl.searchParams.get("request_id");
    if (!validRequestId(requestId)) return NextResponse.json({ error: "公告请求编号无效" }, { status: 400 });
    const { data, error } = await createAdminClient().from("system_announcements")
      .select("id,title,content,recipient_roles,delivery_level")
      .eq("request_id", requestId).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ announcement: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "公告状态查询失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json() as { request_id?: unknown; title?: unknown; content?: unknown; recipient_roles?: unknown; delivery_level?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const recipientRoles = body.recipient_roles;
    const deliveryLevel = body.delivery_level ?? "NORMAL";
    const validRoles = recipientRoles === null || (Array.isArray(recipientRoles)
      && recipientRoles.length > 0 && recipientRoles.length <= USER_ROLES.length
      && recipientRoles.every(role => typeof role === "string" && USER_ROLES.includes(role as typeof USER_ROLES[number]))
      && new Set(recipientRoles).size === recipientRoles.length);
    if (!validRequestId(body.request_id)
      || !validRoles
      || !["NORMAL", "IMPORTANT", "CRITICAL"].includes(String(deliveryLevel))
      || !title || title.length > 120 || !content || content.length > 4000) {
      return NextResponse.json({ error: "请填写有效的公告标题、内容和接收角色" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("publish_system_announcement", {
      p_request_id: body.request_id, p_title: title, p_content: content,
      p_recipient_roles: recipientRoles, p_delivery_level: deliveryLevel,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "系统公告发布失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

