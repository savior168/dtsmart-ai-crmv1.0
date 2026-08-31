import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type WorkflowBody = { action?: "CLAIM" | "RELEASE" | "ASSIGN" | "STAGE"; reason?: string; user_id?: string; status?: string };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as WorkflowBody;
    const permission = body.action === "CLAIM" ? "customers.claim" : body.action === "RELEASE" ? "customers.release" : body.action === "ASSIGN" ? "customers.assign" : "customers.edit";
    const { supabase, user, account } = await requirePermission(permission);
    if (body.action !== "CLAIM" && !hasPermission(account, "customers.data_all")) {
      const customer = await createAdminClient().from("customers").select("owner_id").eq("id", id).maybeSingle();
      if (customer.error) throw customer.error;
      if (!customer.data || customer.data.owner_id !== user.id) return NextResponse.json({ error: "只能操作当前归属自己的客户" }, { status: 403 });
    }
    let rpc: string;
    let args: Record<string, string>;
    if (body.action === "CLAIM") { rpc = "claim_customer"; args = { p_customer_id: id }; }
    else if (body.action === "RELEASE") { rpc = "release_customer"; args = { p_customer_id: id, p_reason: body.reason || "" }; }
    else if (body.action === "ASSIGN") { rpc = "assign_customer"; args = { p_customer_id: id, p_user_id: body.user_id || "" }; }
    else if (body.action === "STAGE") { rpc = "set_customer_stage"; args = { p_customer_id: id, p_status: body.status || "" }; }
    else return NextResponse.json({ error: "无效操作" }, { status: 400 });

    const { data, error } = await supabase.rpc(rpc, args);
    if (error) throw error;
    await writeAudit(supabase, user.id, `CUSTOMER_${body.action}`, "customer", id, { reason: body.reason, assignee: body.user_id, status: body.status });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户流程操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
