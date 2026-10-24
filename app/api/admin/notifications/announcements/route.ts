import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/lib/auth/permissions";
import { SYSTEM_ANNOUNCEMENT_PRIORITIES, SYSTEM_ANNOUNCEMENT_TYPES } from "@/lib/system-announcements";

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json() as { request_id?: unknown; title?: unknown; content?: unknown; recipient_roles?: unknown; announcement_type?: unknown; priority?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const recipientRoles = body.recipient_roles;
    const announcementType = body.announcement_type;
    const priority = body.priority;
    const validRoles = recipientRoles === null || (Array.isArray(recipientRoles)
      && recipientRoles.length > 0 && recipientRoles.length <= USER_ROLES.length
      && recipientRoles.every(role => typeof role === "string" && USER_ROLES.includes(role as typeof USER_ROLES[number]))
      && new Set(recipientRoles).size === recipientRoles.length);
    if (typeof body.request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)
      || !validRoles
      || !SYSTEM_ANNOUNCEMENT_TYPES.some(item => item.value === announcementType)
      || !SYSTEM_ANNOUNCEMENT_PRIORITIES.some(item => item.value === priority)
      || !title || title.length > 120 || !content || content.length > 4000) {
      return NextResponse.json({ error: "请填写有效的公告类型、级别、标题、内容和接收角色" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("publish_system_announcement", {
      p_request_id: body.request_id, p_title: title, p_content: content, p_recipient_roles: recipientRoles,
      p_announcement_type: announcementType, p_priority: priority,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "系统公告发布失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

