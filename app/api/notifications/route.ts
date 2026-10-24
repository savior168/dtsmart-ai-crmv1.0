import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requireUser } from "@/lib/auth/current-user";

const fields = "id,type,category,title,content,metadata,href,entity_type,entity_id,read_at,dismissed_at,archived_at,action_status,deliver_at,created_at";

export async function GET(request: NextRequest) {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    if (!hasPermission(account, "notifications.view")) throw new Error("FORBIDDEN");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(10, Number(params.get("page_size") || 20)));
    const status = params.get("status") || (params.get("unread") === "true" ? "unread" : "active");
    const now = new Date().toISOString();
    let query = supabase.from("system_notifications").select(fields, { count: "exact" })
      .eq("recipient_id", user.id).lte("deliver_at", now).order("deliver_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (status === "unread") query = query.is("read_at", null).is("archived_at", null);
    else if (status === "pending") query = query.eq("action_status", "PENDING").is("archived_at", null);
    else if (status === "archived") query = query.not("archived_at", "is", null);
    else if (status !== "all") query = query.is("archived_at", null);
    const [rows, unreadResult, pendingResult] = await Promise.all([
      query,
      supabase.from("system_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).lte("deliver_at", now).is("read_at", null).is("archived_at", null),
      supabase.from("system_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).lte("deliver_at", now).eq("action_status", "PENDING").is("archived_at", null),
    ]);
    if (rows.error) throw rows.error;
    return NextResponse.json({ data: rows.data || [], count: rows.count || 0, unread: unreadResult.count || 0, pending: pendingResult.count || 0, page, page_size: pageSize, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    if (!hasPermission(account, "notifications.view")) throw new Error("FORBIDDEN");
    const body = await request.json() as { id?: string; action?: "READ" | "READ_ALL" | "ARCHIVE" | "RESTORE" | "RESOLVE" | "DISMISS" | "ACKNOWLEDGE" };
    const action = body.action || (body.id ? "READ" : "READ_ALL");
    if (!["READ", "READ_ALL", "ARCHIVE", "RESTORE", "RESOLVE", "DISMISS", "ACKNOWLEDGE"].includes(action)) {
      return NextResponse.json({ error: "通知操作无效" }, { status: 400 });
    }
    const now = new Date().toISOString();
    let query = supabase.from("system_notifications").update(
      action === "ACKNOWLEDGE" ? { dismissed_at: now, read_at: now }
        : action === "DISMISS" ? { dismissed_at: now }
        : action === "ARCHIVE" ? { archived_at: now, read_at: now }
        : action === "RESTORE" ? { archived_at: null }
          : action === "RESOLVE" ? { action_status: "RESOLVED", read_at: now }
            : { read_at: now },
    ).eq("recipient_id", user.id);
    if (action === "READ_ALL") query = query.is("read_at", null).is("archived_at", null).lte("deliver_at", now);
    else {
      if (!body.id) return NextResponse.json({ error: "缺少通知编号" }, { status: 400 });
      query = query.eq("id", body.id);
      if (action === "ACKNOWLEDGE") query = query.eq("type", "SYSTEM_ANNOUNCEMENT");
    }
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
