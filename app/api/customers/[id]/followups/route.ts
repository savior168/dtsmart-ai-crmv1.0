import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";
import { FOLLOWUP_TYPES } from "@/lib/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    if (!FOLLOWUP_TYPES.includes(body.type)) return NextResponse.json({ error: "无效跟进类型" }, { status: 400 });
    if (!String(body.content || "").trim()) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
    const { data: customer, error: customerError } = await supabase.from("customers").select("id,status,owner_id").eq("id", id).single();
    if (customerError) throw customerError;
    if (customer.owner_id !== user.id) {
      const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
      if (profile?.role !== "ADMIN") throw new Error("只有负责人或管理员可以添加跟进");
    }
    const { data, error } = await supabase.from("followups").insert({
      customer_id: id,
      user_id: user.id,
      type: body.type,
      content: String(body.content).trim(),
      attachment: body.attachment || null,
      next_follow_date: body.next_follow_date || null,
    }).select("*,creator:users(name,email)").single();
    if (error) throw error;
    await supabase.from("customers").update({ last_contact_time: new Date().toISOString() }).eq("id", id);
    if (customer.status === "CLAIMED") {
      const { error: stageError } = await supabase.rpc("set_customer_stage", { p_customer_id: id, p_status: "FOLLOWING" });
      if (stageError) throw stageError;
    }
    await writeAudit(supabase, user.id, "FOLLOWUP_CREATE", "customer", id, { type: body.type, next_follow_date: body.next_follow_date || null });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "跟进保存失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
