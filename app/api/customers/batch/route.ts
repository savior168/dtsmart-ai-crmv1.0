import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { permanentlyDeleteCustomers } from "@/lib/customers/soft-delete";

type BatchBody = { ids?: string[]; action?: "STAGE" | "DELETE"; status?: string; reason?: string };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BatchBody;
    const { supabase, user, account } = await requirePermission(body.action === "DELETE" ? "customers.delete" : "customers.batch_edit");
    const ids = [...new Set((body.ids || []).filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (!ids.length) return NextResponse.json({ error: "请选择至少一条客户数据" }, { status: 400 });

    if (body.action === "DELETE") {
      const result = await permanentlyDeleteCustomers({ supabase, userId: user.id, ids, allowAll: account.role === "ADMIN" });
      return NextResponse.json({
        total_count: ids.length,
        success_count: result.successIds.length,
        failed_count: result.failures.length,
        results: ids.map((id) => result.failures.find((item) => item.id === id) || { id, ok: result.successIds.includes(id) }),
      });
    }

    if (body.action !== "STAGE" || !["CLAIMED", "FOLLOWING", "QUOTE", "DEAL", "RELEASED"].includes(body.status || "")) {
      return NextResponse.json({ error: "无效的批量操作或客户状态" }, { status: 400 });
    }
    let allowedQuery = supabase.from("customers").select("id").in("id", ids);
    if (account.role !== "ADMIN") allowedQuery = allowedQuery.eq("owner_id", user.id);
    const { data: allowedRows, error: allowedError } = await allowedQuery;
    if (allowedError) throw new Error(allowedError.message);
    const allowedIds = new Set((allowedRows || []).map((row) => row.id));
    const successIds: string[] = [];
    const failures: Array<{ id: string; ok: false; error: string }> = ids
      .filter((id) => !allowedIds.has(id))
      .map((id) => ({ id, ok: false, error: "客户不存在或您没有操作权限" }));
    for (const id of ids.filter((item) => allowedIds.has(item))) {
      const result = body.status === "RELEASED"
        ? await supabase.rpc("release_customer", { p_customer_id: id, p_reason: body.reason?.trim() || "批量更新为无效客户" })
        : await supabase.rpc("set_customer_stage", { p_customer_id: id, p_status: body.status });
      if (result.error) failures.push({ id, ok: false, error: result.error.message });
      else successIds.push(id);
    }
    const successSet = new Set(successIds);
    if (successIds.length) await supabase.from("audit_logs").insert(successIds.map((id) => ({ user_id: user.id, action: "CUSTOMER_STAGE", target_type: "customer", target_id: id, content: { status: body.status, reason: body.reason || null } })));
    return NextResponse.json({
      total_count: ids.length,
      success_count: successIds.length,
      failed_count: ids.length - successIds.length,
      results: ids.map((id) => successSet.has(id) ? { id, ok: true } : failures.find((item) => item.id === id) || { id, ok: false, error: "客户不存在或您没有操作权限" }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
