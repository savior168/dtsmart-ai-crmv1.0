import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.results.view");
    const params = request.nextUrl.searchParams;
    const taskId = params.get("task_id") || "";
    const today = params.get("today") === "true";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const grade = params.get("grade") || "";
    const target = params.get("target") || "";
    const evidence = params.get("evidence") || "";
    const search = params.get("search")?.trim() || "";
    const returnAll = params.get("all") === "true";
    const scopeUserId = await requestedOwnerId(request, account, "ai.data_all");
    const admin = createAdminClient();
    const ownedTasks: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 1000) {
      let ownedQuery = admin.from("ai_screening_tasks").select("id,name,task_number,strategy,total_count,success_count,failed_count,total_tokens,total_cost_usd,created_at,updated_at,user_id").order("updated_at", { ascending: false }).order("created_at", { ascending: false });
      if (scopeUserId) ownedQuery = ownedQuery.eq("user_id", scopeUserId);
      const owned = await ownedQuery.range(offset, offset + 999);
      if (owned.error) throw owned.error;
      const rows = owned.data || [];
      ownedTasks.push(...rows);
      if (rows.length < 1000) break;
    }
    const ownerIds = Array.from(new Set(ownedTasks.map((task) => String(task.user_id || "")).filter(Boolean)));
    const owners = ownerIds.length ? await admin.from("users").select("id,name,email").in("id", ownerIds) : { data: [], error: null };
    if (owners.error) throw owners.error;
    const ownerById = new Map((owners.data || []).map((owner) => [owner.id, owner]));
    const taskRows = ownedTasks.map((task) => ({ ...task, owner: ownerById.get(String(task.user_id || "")) || null }));
    let taskIds = ownedTasks.map((item) => String(item.id));
    if (taskId) taskIds = taskIds.filter((id) => id === taskId);
    if (!taskIds.length) return NextResponse.json({ data: [], count: 0, tasks: taskRows, show_owner: account.role !== "SALES", summary: { total: 0, valid: 0, invalid: 0, review: 0, failed: 0, tokens: 0, cost: 0, grades: {} } });
    const safeSearch = search.replace(/[,%()]/g," ").trim();
    const buildResultQuery = () => {
      let query = admin.from("ai_screening_results").select("*,customer:customers!inner(id,company_name,contact_name,phone,email,country,website,google_url),task:ai_screening_tasks!inner(id,name,task_number,user_id)", { count: "exact" });
      if (scopeUserId) query = query.eq("task.user_id", scopeUserId);
      if (taskId) query = query.eq("task_id", taskId);
      if (today) query = query.gte("completed_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      if (grade) query = query.eq("grade", grade);
      // The target list rule is score-based. `target_decision` is retained for
      // the separate manual-review workflow, but must not change the customer
      // target classification.
      if (target === "VALID") query = query.gte("score", 60);
      else if (target === "INVALID") query = query.lt("score", 60);
      else if (target === "REVIEW") query = query.eq("target_decision", "REVIEW");
      if (evidence) query = query.eq("evidence_sufficiency", evidence);
      if (safeSearch) query = query.or(`company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`, { referencedTable: "customers" });
      return query.order("completed_at", { ascending: false });
    };
    let resultData: unknown[] = [];
    let resultCount = 0;
    if (returnAll) {
      const batchSize = 1000;
      for (let offset = 0; ; offset += batchSize) {
        const batch = await buildResultQuery().range(offset, offset + batchSize - 1);
        if (batch.error) throw batch.error;
        const rows = batch.data || [];
        resultData = resultData.concat(rows);
        resultCount = batch.count || resultData.length;
        if (rows.length < batchSize) break;
      }
    } else {
      const result = await buildResultQuery().range((page - 1) * pageSize, page * pageSize - 1);
      if (result.error) throw result.error;
      resultData = result.data || [];
      resultCount = result.count || 0;
    }
    const summaryItems: Array<{ grade: string | null; score: number | null; target_decision: string | null; total_tokens: number | null; cost_usd: number | string | null; evidence_sufficiency: string | null; early_stop_reason: string | null; completed_at: string | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      let summaryQuery = admin.from("ai_screening_results").select("grade,score,target_decision,total_tokens,cost_usd,evidence_sufficiency,early_stop_reason,completed_at,task:ai_screening_tasks!inner(user_id)");
      if (scopeUserId) summaryQuery = summaryQuery.eq("task.user_id", scopeUserId);
      if (taskId) summaryQuery = summaryQuery.eq("task_id", taskId);
      if (today) summaryQuery = summaryQuery.gte("completed_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const summaryRows = await summaryQuery.range(offset, offset + 999);
      if (summaryRows.error) throw summaryRows.error;
      const rows = summaryRows.data || [];
      summaryItems.push(...rows);
      if (rows.length < 1000) break;
    }
    const grades: Record<string, number> = {};
    const summary = summaryItems.reduce((value, item) => {
      value.total += 1;
      if (item.score != null && item.score >= 60) value.valid += 1;
      else if (item.score != null) value.invalid += 1;
      if (item.target_decision === "REVIEW") value.review += 1;
      value.tokens += Number(item.total_tokens || 0);
      value.cost += Number(item.cost_usd || 0);
      if (item.evidence_sufficiency === "SUFFICIENT") value.sufficient += 1;
      if (item.early_stop_reason) value.early_stopped += 1;
      grades[item.grade || "-"] = (grades[item.grade || "-"] || 0) + 1;
      return value;
    }, { total: 0, valid: 0, invalid: 0, review: 0, failed: 0, tokens: 0, cost: 0, sufficient: 0, early_stopped: 0, grades });
    let failedQuery = admin.from("ai_screening_task_items").select("id,task:ai_screening_tasks!inner(user_id)", { count: "exact", head: true }).eq("status", "FAILED");
    if (scopeUserId) failedQuery = failedQuery.eq("task.user_id", scopeUserId);
    if (taskId) failedQuery = failedQuery.eq("task_id", taskId);
    if (today) failedQuery = failedQuery.gte("completed_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const failed = await failedQuery;
    if (failed.error) throw failed.error;
    summary.failed = failed.count || 0;
    const data = (resultData as Array<Record<string, unknown>>).map((row) => {
      const task = Array.isArray(row.task) ? row.task[0] : row.task as Record<string, unknown> | null;
      return { ...row, owner: task ? ownerById.get(String(task.user_id || "")) || null : null };
    });
    return NextResponse.json({ data, count: resultCount, tasks: taskRows, show_owner: account.role !== "SALES", summary, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI结果查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, account } = await requirePermission("ai.results.review");
    const body = await request.json() as {
      result_ids?: string[]; result_id?: string; target_decision?: "VALID" | "INVALID" | "REVIEW";
      grade?: "A" | "B" | "C" | "D"; score?: number; manual_review_note?: string;
    };
    const resultIds = [...new Set([...(body.result_ids || []), ...(body.result_id ? [body.result_id] : [])])];
    if (!resultIds.length) return NextResponse.json({ error: "请选择需要修正的分析结果" }, { status: 400 });
    if (body.score !== undefined && (!Number.isInteger(body.score) || body.score < 0 || body.score > 100)) return NextResponse.json({ error: "目标客户评分必须为0到100的整数" }, { status: 400 });
    const admin = createAdminClient();
    const owned = await admin.from("ai_screening_results").select("id,customer_id,score,task:ai_screening_tasks!inner(user_id)").in("id", resultIds);
    if (owned.error) throw owned.error;
    const permitted = (owned.data || []).filter((row) => {
      const task = Array.isArray(row.task) ? row.task[0] : row.task;
      return account.role === "ADMIN" || task?.user_id === user.id;
    });
    if (permitted.length !== resultIds.length) return NextResponse.json({ error: "其他用户的AI分析结果仅供查看，不能人工修改" }, { status: 403 });
    const update: Record<string, unknown> = {
      manual_review_status: "REVIEWED",
      manual_review_note: body.manual_review_note?.trim() || null,
      manual_reviewed_by: user.id,
      manual_reviewed_at: new Date().toISOString(),
    };
    if (body.target_decision) update.target_decision = body.target_decision;
    if (body.grade) update.grade = body.grade;
    if (body.score !== undefined) update.score = body.score;
    const saved = await admin.from("ai_screening_results").update(update).in("id", resultIds);
    if (saved.error) throw saved.error;
    for (const row of permitted) {
      const customerUpdate: Record<string, unknown> = {};
      if (body.grade) customerUpdate.ai_level = body.grade;
      if (body.score !== undefined) customerUpdate.ai_score = body.score;
      const effectiveScore = body.score ?? row.score;
      if (typeof effectiveScore === "number") customerUpdate.is_target_customer = effectiveScore >= 60;
      if (Object.keys(customerUpdate).length) {
        const customerSaved = await admin.from("customers").update(customerUpdate).eq("id", row.customer_id);
        if (customerSaved.error) throw customerSaved.error;
      }
    }
    await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_RESULT_MANUAL_REVIEW", target_type: "ai_screening_result", target_id: resultIds[0], content: { result_ids: resultIds, changes: update } });
    return NextResponse.json({ success: true, updated: resultIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI分析结果修正失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
