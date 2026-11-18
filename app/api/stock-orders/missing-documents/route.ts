import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    if (!["WAREHOUSE", "ADMIN"].includes(account.role)
      || !hasPermission(account, "supplier.documents.view")) throw new Error("FORBIDDEN");
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 2000) throw new Error("分页参数无效");
    const { data, error } = await supabase.rpc("list_missing_shipped_pi_documents", {
      p_limit: 50, p_offset: (page - 1) * 50,
    });
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: Number(data?.[0]?.total_count || 0), page });
  } catch (error) {
    const message = sqlErrorMessage(error, "待补送货单清单加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
