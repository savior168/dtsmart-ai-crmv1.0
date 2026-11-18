import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new Error("用户编号无效");
    const admin = createAdminClient();
    const [{ data: clerk, error: clerkError }, { data: sellers, error: sellerError }, { data: assignments, error: assignmentError }] = await Promise.all([
      admin.from("users").select("id,name,email,role,status").eq("id", id).maybeSingle(),
      admin.from("users").select("id,name,email,role,status").in("role", ["SALES", "SUPERVISOR"]).order("name"),
      admin.from("order_clerk_sales_assignments").select("sales_user_id").eq("clerk_user_id", id),
    ]);
    if (clerkError) throw clerkError;
    if (!clerk || clerk.role !== "ORDER_CLERK") return NextResponse.json({ error: "请选择制单员账号" }, { status: 404 });
    if (sellerError) throw sellerError;
    if (assignmentError) throw assignmentError;
    return NextResponse.json({ clerk, sellers: sellers || [], sales_user_ids: (assignments || []).map((row) => row.sales_user_id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "制单范围加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json() as { sales_user_ids?: unknown; reason?: unknown };
    const ids = body.sales_user_ids;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!UUID.test(id) || !Array.isArray(ids) || ids.length > 500 || ids.some((value) => typeof value !== "string" || !UUID.test(value)) || new Set(ids).size !== ids.length || !reason || reason.length > 500) {
      return NextResponse.json({ error: "请提供有效的授权名单和操作原因" }, { status: 400 });
    }
    const { error } = await supabase.rpc("set_order_clerk_sales_assignments", {
      p_clerk_id: id, p_sales_ids: ids, p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "制单范围保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
