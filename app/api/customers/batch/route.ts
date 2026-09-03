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

    return NextResponse.json({ error: "客户阶段和跟进状态只支持单条手工修改，不能批量变更" }, { status: 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
