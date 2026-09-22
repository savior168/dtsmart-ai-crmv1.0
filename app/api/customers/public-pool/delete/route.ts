import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { permanentlyDeleteCustomers } from "@/lib/customers/soft-delete";

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireAdmin();
    const body = await request.json() as { ids?: string[]; reason?: string };
    const ids = [...new Set((body.ids || []).filter((id): id is string => typeof id === "string" && Boolean(id.trim())))];
    const reason = String(body.reason || "").trim();
    if (!ids.length) return NextResponse.json({ error: "请选择至少一条客户数据" }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "请填写永久删除原因" }, { status: 400 });
    const result = await permanentlyDeleteCustomers({ supabase, userId: user.id, ids, allowAll: true, reason });
    return NextResponse.json({
      total_count: ids.length,
      success_count: result.successIds.length,
      failed_count: result.failures.length,
      results: ids.map((id) => result.failures.find((item) => item.id === id) || { id, ok: result.successIds.includes(id) }),
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "公海客户删除失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
