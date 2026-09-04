import { NextRequest, NextResponse } from "next/server";
import { requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { FOLLOWUP_TYPES } from "@/lib/types";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user, account } = await requirePermission("followups.edit");
    const { id } = await context.params;
    const body = await request.json();
    if (!FOLLOWUP_TYPES.includes(body.type)) return NextResponse.json({ error: "无效跟进类型" }, { status: 400 });
    const content = String(body.content || "").trim();
    if (!content) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
    const existing = await createAdminClient().from("followups").select("id,user_id,customer_id,customer:customers!inner(owner_id)").eq("id", id).single();
    if (existing.error) throw existing.error;
    const customer = Array.isArray(existing.data.customer) ? existing.data.customer[0] : existing.data.customer;
    if (account.role !== "ADMIN" && (existing.data.user_id !== user.id || customer?.owner_id !== user.id)) {
      return NextResponse.json({ error: "仅当前归属销售员可修改本人创建的跟进记录" }, { status: 403 });
    }
    const updated = await supabase.from("followups").update({ type: body.type, content, next_follow_date: body.next_follow_date || null }).eq("id", id).select("id,customer_id").single();
    if (updated.error) throw updated.error;
    await writeAudit(supabase, user.id, "FOLLOWUP_UPDATE", "customer", updated.data.customer_id, { followup_id: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "跟进记录修改失败" }, { status: 400 });
  }
}
