import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { softDeleteCustomers } from "@/lib/customers/soft-delete";

type BatchBody = { ids?: string[]; action?: "STAGE" | "DELETE"; status?: string };

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as BatchBody;
    const ids = [...new Set((body.ids || []).filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (!ids.length) return NextResponse.json({ error: "请选择至少一条客户数据" }, { status: 400 });

    if (body.action === "DELETE") {
      const result = await softDeleteCustomers({ supabase, userId: user.id, ids });
      return NextResponse.json({
        total_count: ids.length,
        success_count: result.successIds.length,
        failed_count: result.failures.length,
        results: ids.map((id) => result.failures.find((item) => item.id === id) || { id, ok: result.successIds.includes(id) }),
      });
    }

    if (body.action !== "STAGE" || !["UNCLAIMED", "CLAIMED", "QUOTE", "DEAL", "RELEASED"].includes(body.status || "")) {
      return NextResponse.json({ error: "无效的批量操作或客户状态" }, { status: 400 });
    }
    const { data: updated, error } = await supabase
      .from("customers")
      .update({ status: body.status })
      .in("id", ids)
      .is("deleted_at", null)
      .select("id");
    if (error) throw error;
    const successIds = (updated || []).map((item) => item.id);
    const successSet = new Set(successIds);
    return NextResponse.json({
      total_count: ids.length,
      success_count: successIds.length,
      failed_count: ids.length - successIds.length,
      results: ids.map((id) => successSet.has(id) ? { id, ok: true } : { id, ok: false, error: "客户不存在或您没有操作权限" }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
