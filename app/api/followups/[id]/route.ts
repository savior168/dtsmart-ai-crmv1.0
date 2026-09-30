import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { FOLLOWUP_TYPES } from "@/lib/types";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("followups.edit");
    const { id } = await context.params;
    const body = await request.json();
    if (!FOLLOWUP_TYPES.includes(body.type)) return NextResponse.json({ error: "无效跟进类型" }, { status: 400 });
    const content = String(body.content || "").trim();
    const editReason = String(body.edit_reason || "").trim();
    if (!content) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
    if (editReason.length < 5) return NextResponse.json({ error: "请填写至少 5 个字的更正原因" }, { status: 400 });
    const nextFollowDate = body.next_follow_date ? String(body.next_follow_date) : null;
    if (nextFollowDate && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(nextFollowDate) || Number.isNaN(Date.parse(nextFollowDate)))) {
      return NextResponse.json({ error: "下次跟进时间无效，请重新选择日期和时间" }, { status: 400 });
    }
    const { error } = await supabase.rpc("correct_customer_followup", {
      p_followup_id: id,
      p_type: body.type,
      p_content: content,
      p_next_follow_date: nextFollowDate,
      p_reason: editReason,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "跟进记录修改失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
