import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const taskId = params.get("task_id") || "";
    const today = params.get("today") === "true";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const grade = params.get("grade") || "";
    const target = params.get("target") || "";
    const evidence = params.get("evidence") || "";
    const search = params.get("search")?.trim() || "";
    const admin = createAdminClient();
    const owned = await admin.from("ai_screening_tasks").select("id,name,task_number,strategy,total_count,success_count,failed_count,total_tokens,total_cost_usd,created_at").eq("user_id", user.id);
    if (owned.error) throw owned.error;
    let taskIds = (owned.data || []).map((item) => item.id);
    if (taskId) taskIds = taskIds.filter((id) => id === taskId);
    if (!taskIds.length) return NextResponse.json({ data: [], count: 0, tasks: owned.data || [], summary: { total: 0, valid: 0, invalid: 0, review: 0, failed: 0, tokens: 0, cost: 0, grades: {} } });
    let customerIds:string[]|null=null;
    if(search){const safe=search.replace(/[,%()]/g," ").trim();const customers=await admin.from("customers").select("id").or(`company_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`).limit(1000);if(customers.error)throw customers.error;customerIds=(customers.data||[]).map(row=>row.id);if(!customerIds.length)return NextResponse.json({data:[],count:0,tasks:owned.data||[],page,pageSize});}
    let query = admin.from("ai_screening_results").select("*,customer:customers(id,company_name,contact_name,phone,email,country,website,google_url),task:ai_screening_tasks(id,name,task_number)", { count: "exact" }).in("task_id", taskIds);
    if (today) query = query.gte("completed_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (grade) query = query.eq("grade", grade);
    if (target) query = query.eq("target_decision", target);
    if (evidence) query = query.eq("evidence_sufficiency", evidence);
    if (customerIds) query = query.in("customer_id",customerIds);
    const result = await query.order("completed_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    let summaryQuery = admin.from("ai_screening_results").select("grade,target_decision,total_tokens,cost_usd,evidence_sufficiency,early_stop_reason,completed_at").in("task_id", taskIds);
    if (today) summaryQuery = summaryQuery.gte("completed_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const summaryRows = await summaryQuery;
    if (summaryRows.error) throw summaryRows.error;
    const grades: Record<string, number> = {};
    const summary = (summaryRows.data || []).reduce((value, item) => {
      value.total += 1;
      if (item.target_decision === "VALID") value.valid += 1;
      else if (item.target_decision === "INVALID") value.invalid += 1;
      else value.review += 1;
      value.tokens += Number(item.total_tokens || 0);
      value.cost += Number(item.cost_usd || 0);
      if (item.evidence_sufficiency === "SUFFICIENT") value.sufficient += 1;
      if (item.early_stop_reason) value.early_stopped += 1;
      grades[item.grade || "-"] = (grades[item.grade || "-"] || 0) + 1;
      return value;
    }, { total: 0, valid: 0, invalid: 0, review: 0, failed: 0, tokens: 0, cost: 0, sufficient: 0, early_stopped: 0, grades });
    const failed = await admin.from("ai_screening_task_items").select("id", { count: "exact", head: true }).in("task_id", taskIds).eq("status", "FAILED");
    if (failed.error) throw failed.error;
    summary.failed = failed.count || 0;
    return NextResponse.json({ data: result.data || [], count: result.count || 0, tasks: owned.data || [], summary, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI结果查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
