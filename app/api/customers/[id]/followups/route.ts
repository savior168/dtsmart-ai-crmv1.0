import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { FOLLOWUP_TYPES } from "@/lib/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("followups.create");
    const { id } = await context.params;
    const body = await request.json();
    if (!FOLLOWUP_TYPES.includes(body.type)) return NextResponse.json({ error: "无效跟进类型" }, { status: 400 });
    if (!String(body.content || "").trim()) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
    const outcome = String(body.outcome || "CONTACT_ONLY").toUpperCase();
    if (!["CONTACT_ONLY", "INTEREST", "NO_INTEREST"].includes(outcome)) {
      return NextResponse.json({ error: "请选择有效的客户反馈结果" }, { status: 400 });
    }
    if (outcome === "INTEREST" && body.has_attachment !== true) {
      return NextResponse.json({ error: "客户明确有采购意向时必须上传真实沟通凭证" }, { status: 400 });
    }
    const nextFollowDate = body.next_follow_date ? String(body.next_follow_date) : null;
    if (nextFollowDate && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(nextFollowDate) || Number.isNaN(Date.parse(nextFollowDate)))) {
      return NextResponse.json({ error: "下次跟进时间无效，请重新选择日期和时间" }, { status: 400 });
    }
    const clientRequestId = body.client_request_id ? String(body.client_request_id) : null;
    if (clientRequestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientRequestId)) {
      return NextResponse.json({ error: "提交编号无效，请刷新页面后重试" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("create_customer_followup", {
      p_customer_id: id,
      p_type: body.type,
      p_content: String(body.content).trim(),
      p_next_follow_date: nextFollowDate,
      p_outcome: outcome,
      p_followup_status: body.followup_status || null,
      p_client_request_id: clientRequestId,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "跟进保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
