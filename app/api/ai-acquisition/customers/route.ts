import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const validScopes = new Set(["today", "accepted", "review"]);

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const ownerId = await requestedOwnerId(request, account, "ai.acquisition.data_all");
    const params = request.nextUrl.searchParams;
    const scope = validScopes.has(params.get("scope") || "") ? String(params.get("scope")) : "accepted";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = (params.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const country = params.get("country") || "";
    const industry = params.get("industry")?.trim() || "";
    const level = params.get("level") || "";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "") ? String(params.get("from")) : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "") ? String(params.get("to")) : "";
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const admin = createAdminClient();

    const base = () => {
      let query = admin
        .from("ai_acquisition_candidates")
        .select("*,task:ai_acquisition_tasks!inner(id,task_number,name,user_id)", { count: "exact" });
      if (ownerId) query = query.eq("task.user_id", ownerId);
      return query;
    };

    let query = base();
    if (scope === "review") query = query.eq("decision", "REVIEW");
    else query = query.eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
    if (scope === "today") query = query.gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
    if (search) query = query.or(`company_name.ilike.%${search}%,address.ilike.%${search}%`);
    if (country) query = query.eq("country", country);
    if (industry) {
      const [industryMatches,categoryMatches]=await Promise.all([
        admin.from("customers").select("id").eq("industry",industry).limit(5000),
        admin.from("customers").select("id").eq("category",industry).limit(5000),
      ]);
      if(industryMatches.error||categoryMatches.error)throw industryMatches.error||categoryMatches.error;
      const matchingCustomerIds=[...new Set([...(industryMatches.data||[]),...(categoryMatches.data||[])].map((row)=>String(row.id)))];
      query=matchingCustomerIds.length?query.or(`staging_customer_id.in.(${matchingCustomerIds.join(",")}),imported_customer_id.in.(${matchingCustomerIds.join(",")})`):query.eq("id","00000000-0000-0000-0000-000000000000");
    }
    if (["A", "B", "C", "D"].includes(level)) query = query.eq("ai_level", level);
    if (from) query=query.gte("processed_at",`${from}T00:00:00.000+08:00`);
    if (to) query=query.lte("processed_at",`${to}T23:59:59.999+08:00`);
    const result = await query.order("processed_at", { ascending: false, nullsFirst: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const customerIds = [...new Set(rows.map((row) => String(row.imported_customer_id || row.staging_customer_id || "")).filter(Boolean))];
    const profiles = customerIds.length ? await admin.from("customers").select("id,industry,category").in("id", customerIds) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const profileById = new Map((profiles.data || []).map((profile) => [String(profile.id), profile]));

    const summaryQueries = [
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`).limit(0),
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).limit(0),
      base().eq("decision", "REVIEW").limit(0),
    ];
    const [todayResult, acceptedResult, reviewResult] = await Promise.all(summaryQueries);
    const summaryError = todayResult.error || acceptedResult.error || reviewResult.error;
    if (summaryError) throw summaryError;

    const canControlTasks = hasPermission(account, "ai.acquisition.control");
    return NextResponse.json({
      data: rows.map((row) => {
        const profile=profileById.get(String(row.imported_customer_id || row.staging_customer_id || ""));
        const task = Array.isArray(row.task) ? row.task[0] : row.task;
        return { ...row, task, display_industry:profile?.industry||profile?.category||"待确认行业", can_control:canControlTasks&&(String(task?.user_id||"")===account.id||account.role==="ADMIN") };
      }),
      count: result.count || 0,
      summary: { today: todayResult.count || 0, accepted: acceptedResult.count || 0, review: reviewResult.count || 0 },
      show_owner: hasPermission(account, "ai.acquisition.data_all"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客客户结果加载失败";
    console.error("AI acquisition customer results failed", error);
    const publicMessage = ["UNAUTHORIZED", "SESSION_REVOKED", "FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(message) || message.startsWith("ACCOUNT_") ? message : "AI获客客户结果加载失败，请稍后重试";
    return NextResponse.json({ error: publicMessage }, { status: authErrorStatus(publicMessage) });
  }
}
