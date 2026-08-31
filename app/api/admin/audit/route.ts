import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorStatus } from "@/lib/auth/current-user";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_ACTIONS, IMPORTANT_AUDIT_ACTIONS, auditCategoryOf, type AuditCategory } from "@/lib/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const requestedCategory = params.get("category")?.trim().toUpperCase() || "";
    const category = AUDIT_CATEGORIES.includes(requestedCategory as AuditCategory) ? requestedCategory as AuditCategory : null;
    const userId = params.get("user_id")?.trim() || "";
    const result = params.get("result")?.trim() || "";
    const dateFrom = params.get("from")?.trim() || "";
    const dateTo = params.get("to")?.trim() || "";
    const admin = createAdminClient();
    let query = admin.from("audit_logs").select("id,user_id,action,target_type,target_id,content,result,created_at", { count: "exact" });
    query = query.in("action", category ? AUDIT_CATEGORY_ACTIONS[category] : IMPORTANT_AUDIT_ACTIONS);
    if (userId) query = query.eq("user_id", userId);
    if (result) query = query.eq("result", result);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    const userIds = [...new Set((data || []).flatMap((item) => [
      item.user_id,
      item.target_type === "user" ? item.target_id : null,
    ]).filter(Boolean))];
    const { data: users } = userIds.length ? await admin.from("users").select("id,name,email,role,status").in("id", userIds) : { data: [] };
    const userMap = new Map((users || []).map((item) => [item.id, item]));
    return NextResponse.json({
      data: (data || []).map((item) => ({
        ...item,
        category: auditCategoryOf(item.action),
        user: userMap.get(item.user_id) || null,
        target_user: item.target_type === "user" ? userMap.get(item.target_id) || null : null,
      })),
      count: count || 0,
      page,
      pageSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "日志加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
