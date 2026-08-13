import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

type BatchBody = { ids?: string[]; action?: "STAGE" | "ASSIGN"; status?: string; user_id?: string };

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as BatchBody;
    const ids = [...new Set(body.ids || [])].slice(0, 100);
    if (!ids.length) return NextResponse.json({ error: "请选择客户" }, { status: 400 });
    if (body.action === "STAGE" && !["CLAIMED", "FOLLOWING", "QUOTE", "DEAL"].includes(body.status || "")) return NextResponse.json({ error: "无效客户状态" }, { status: 400 });
    if (body.action === "ASSIGN" && !body.user_id) return NextResponse.json({ error: "请选择负责人" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "无效批量操作" }, { status: 400 });
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      const rpc = body.action === "ASSIGN" ? "assign_customer" : "set_customer_stage";
      const args = body.action === "ASSIGN" ? { p_customer_id: id, p_user_id: body.user_id! } : { p_customer_id: id, p_status: body.status! };
      const { error } = await supabase.rpc(rpc, args);
      if (error) results.push({ id, ok: false, error: error.message });
      else {
        results.push({ id, ok: true });
        await writeAudit(supabase, user.id, `CUSTOMER_${body.action}`, "customer", id, { status: body.status, assignee: body.user_id, batch: true });
      }
    }
    const success_count = results.filter((item) => item.ok).length;
    return NextResponse.json({ total_count: ids.length, success_count, failed_count: ids.length - success_count, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
