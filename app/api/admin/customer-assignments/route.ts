import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { postgrestContains } from "@/lib/postgrest-search";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const mode = request.nextUrl.searchParams.get("mode") || "options";
    if (mode === "history") {
      const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
      const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("page_size") || 20)));
      const search = request.nextUrl.searchParams.get("q")?.trim() || "";
      const historyType = request.nextUrl.searchParams.get("history_type")?.trim().toUpperCase() || "";
      const dateFrom = request.nextUrl.searchParams.get("date_from")?.trim() || "";
      const dateTo = request.nextUrl.searchParams.get("date_to")?.trim() || "";
      let query = admin.from("customer_assignment_batches")
        .select("id,batch_number,batch_name,reason_type,reason,mode,customer_count,created_at,source:users!customer_assignment_batches_source_user_id_fkey(id,name,email),target:users!customer_assignment_batches_target_user_id_fkey(id,name,email),creator:users!customer_assignment_batches_created_by_fkey(id,name,email)", { count: "exact" })
        .order("created_at", { ascending: false });
      if (search) {
        const pattern = postgrestContains(search.replace(/[(),]/g, " "));
        query = query.or(`batch_number.ilike.${pattern},batch_name.ilike.${pattern},reason.ilike.${pattern}`);
      }
      if (historyType === "HANDOVER") query = query.eq("reason_type", "ACCOUNT_HANDOVER");
      if (historyType === "ASSIGN") query = query.eq("mode", "ASSIGN").neq("reason_type", "ACCOUNT_HANDOVER");
      if (historyType === "RELEASE") query = query.eq("mode", "RELEASE");
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
      const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
      if (result.error) throw result.error;
      return NextResponse.json({ data: result.data || [], count: result.count || 0, page, page_size: pageSize });
    }
    const [activeUsers, inactiveUsers, owned] = await Promise.all([
      admin.from("users").select("id,name,email,role,manager_id").eq("status", "ACTIVE").in("role", ["SALES", "SUPERVISOR"]).order("name"),
      admin.from("users").select("id,name,email,role,status").in("status", ["DISABLED", "DEPARTED"]).in("role", ["SALES", "SUPERVISOR"]).order("name"),
      admin.from("customers").select("owner_id").is("deleted_at", null).not("owner_id", "is", null),
    ]);
    if (activeUsers.error) throw activeUsers.error;
    if (inactiveUsers.error) throw inactiveUsers.error;
    if (owned.error) throw owned.error;
    const counts = new Map<string, number>();
    for (const item of owned.data || []) counts.set(item.owner_id, (counts.get(item.owner_id) || 0) + 1);
    return NextResponse.json({
      assignees: activeUsers.data || [],
      inactive_users: (inactiveUsers.data || []).map((item) => ({ ...item, customer_count: counts.get(item.id) || 0 })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户分配信息加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await request.json();
    const action = String(body.action || "").toUpperCase();
    if (action === "ASSIGN") {
      const ids = Array.isArray(body.customer_ids) ? body.customer_ids.map(String).filter(Boolean) : [];
      const result = await supabase.rpc("admin_assign_eligible_customers", {
        p_customer_ids: ids,
        p_target_user_id: String(body.target_user_id || ""),
        p_batch_name: String(body.batch_name || ""),
        p_reason: String(body.reason || ""),
      });
      if (result.error) throw result.error;
      return NextResponse.json({ success: true, data: result.data, message: "客户分配完成" });
    }
    if (action === "HANDOVER") {
      const result = await supabase.rpc("handover_inactive_user_customers", {
        p_source_user_id: String(body.source_user_id || ""),
        p_target_user_id: body.mode === "RELEASE" ? null : String(body.target_user_id || ""),
        p_mode: String(body.mode || ""),
        p_batch_name: String(body.batch_name || ""),
        p_reason: String(body.reason || ""),
      });
      if (result.error) throw result.error;
      return NextResponse.json({ success: true, data: result.data, message: body.mode === "RELEASE" ? "离职客户已释放至对应待分配范围" : "离职客户及关联业务已经完成交接" });
    }
    return NextResponse.json({ error: "不支持的分配操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户分配失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
