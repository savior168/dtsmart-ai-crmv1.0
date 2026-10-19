import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await createAdminClient().from("users")
      .select("id,name,email,status,supervisor_can_view_subordinates")
      .eq("role", "SUPERVISOR").order("name");
    if (error) throw error;
    return NextResponse.json({ data: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "主管数据范围加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json();
    const id = String(body.id || "");
    const enabled = body.enabled;
    const reason = String(body.reason || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || typeof enabled !== "boolean" || !reason || reason.length > 500) {
      return NextResponse.json({ error: "请选择主管、开关状态并填写 1 至 500 字操作原因" }, { status: 400 });
    }
    const { error } = await supabase.rpc("set_supervisor_subordinate_view", {
      p_supervisor_id: id, p_enabled: enabled, p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, message: enabled ? "已开启查看直属下属数据" : "已关闭查看直属下属数据" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "主管数据范围更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
