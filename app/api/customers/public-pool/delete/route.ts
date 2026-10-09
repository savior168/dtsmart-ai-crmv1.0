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
    if (ids.length > 10) return NextResponse.json({ error: "单次最多删除10家客户，请分批提交" }, { status: 413 });
    if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      return NextResponse.json({ error: "客户编号格式无效" }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ error: "请填写永久删除原因" }, { status: 400 });
    if (reason.length > 500) return NextResponse.json({ error: "删除原因不能超过500字" }, { status: 400 });
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
    const timedOut = /canceling statement due to statement timeout|statement timeout/i.test(message);
    return NextResponse.json(
      { error: timedOut ? "本批删除超时，未确认删除结果；请刷新客户列表核对后重试" : message },
      { status: timedOut ? 503 : authErrorStatus(message) || 400 },
    );
  }
}
