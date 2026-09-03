import { NextRequest, NextResponse } from "next/server";
import { canWriteOwnedRecord, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { FOLLOWUP_TYPES } from "@/lib/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account, supabase } = await requirePermission("followups.create");
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
    const admin = createAdminClient();
    const { data: customer, error: customerError } = await admin.from("customers").select("id,status,owner_id,created_by").eq("id", id).is("deleted_at", null).single();
    if (customerError) throw customerError;
    const effectiveOwner = customer.owner_id || customer.created_by;
    if (!canWriteOwnedRecord(account, effectiveOwner)) {
      return NextResponse.json({ error: "其他用户的客户和跟进数据仅供查看，不能新增跟进" }, { status: 403 });
    }
    const { data, error } = await admin.from("followups").insert({
      customer_id: id,
      user_id: user.id,
      type: body.type,
      content: String(body.content).trim(),
      attachment: body.attachment || null,
      next_follow_date: body.next_follow_date || null,
      outcome,
    }).select("*,creator:users(name,email)").single();
    if (error) throw error;
    await admin.from("customers").update({ last_contact_time: new Date().toISOString() }).eq("id", id);
    await writeAudit(supabase, user.id, "FOLLOWUP_CREATE", "customer", id, { type: body.type, outcome, next_follow_date: body.next_follow_date || null });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "跟进保存失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
