import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type UsageCall = {
  source_call_id: string; task_id: string; task_name: string; task_number: string | null;
  task_status: string | null; task_total_count: number; task_created_at: string | null;
  customer_id: string; channel: string; model: string | null;
  input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number;
  cost_usd: number; call_status: string; duration_ms: number | null; error_message: string | null; occurred_at: string;
};

type Completion = {
  source_task_item_id: string; task_id: string; task_name: string; task_number: string | null;
  task_status: string | null; task_total_count: number; task_created_at: string | null;
  customer_id: string; completed_at: string;
};

type TaskUsage = {
  id: string; name: string; task_number: string | null; status: string | null;
  total_count: number; processed_count: number; model_call_count: number;
  input_tokens: number; cached_input_tokens: number; output_tokens: number;
  total_tokens: number; total_cost_usd: number; created_at: string | null; task_exists: boolean;
};

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.usage.view");
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = params.get("to") || new Date().toISOString().slice(0, 10);
    const model = params.get("model")?.trim() || "";
    const status = params.get("status")?.trim() || "";
    const taskId = params.get("task_id")?.trim() || "";
    const scopeUserId = await requestedOwnerId(request, account, "ai.usage.view_all");
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const returnAll = params.get("all") === "true";
    const admin = createAdminClient();
    const start = `${from}T00:00:00.000Z`;
    const end = `${to}T23:59:59.999Z`;

    const calls: UsageCall[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = admin.from("ai_screening_usage_ledger")
        .select("source_call_id,task_id,task_name,task_number,task_status,task_total_count,task_created_at,customer_id,channel,model,input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd,call_status,duration_ms,error_message,occurred_at")
        .gte("occurred_at", start).lte("occurred_at", end);
      if (scopeUserId) query = query.eq("user_id", scopeUserId);
      if (taskId) query = query.eq("task_id", taskId);
      const result = await query.order("occurred_at", { ascending: false }).range(offset, offset + 999);
      if (result.error) throw result.error;
      const rows = (result.data || []) as UsageCall[];
      calls.push(...rows);
      if (rows.length < 1000) break;
    }

    const completions: Completion[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = admin.from("ai_screening_completion_ledger")
        .select("source_task_item_id,task_id,task_name,task_number,task_status,task_total_count,task_created_at,customer_id,completed_at")
        .gte("completed_at", start).lte("completed_at", end);
      if (scopeUserId) query = query.eq("user_id", scopeUserId);
      if (taskId) query = query.eq("task_id", taskId);
      const result = await query.order("completed_at", { ascending: false }).range(offset, offset + 999);
      if (result.error) throw result.error;
      const rows = (result.data || []) as Completion[];
      completions.push(...rows);
      if (rows.length < 1000) break;
    }

    const models = [...new Set(calls.map((call) => call.model).filter((value): value is string => Boolean(value)))].sort();
    const filteredCalls = model ? calls.filter((call) => call.model === model) : calls;
    const allowedTaskIds = model ? new Set(filteredCalls.map((call) => call.task_id)) : null;
    const filteredCompletions = allowedTaskIds ? completions.filter((item) => allowedTaskIds.has(item.task_id)) : completions;
    const taskMap = new Map<string, TaskUsage>();
    const ensureTask = (row: UsageCall | Completion) => {
      const current = taskMap.get(row.task_id);
      if (current) return current;
      const created: TaskUsage = {
        id: row.task_id, name: row.task_name || "已删除的AI筛选任务", task_number: row.task_number,
        status: row.task_status, total_count: Number(row.task_total_count || 0), processed_count: 0,
        model_call_count: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
        total_tokens: 0, total_cost_usd: 0, created_at: row.task_created_at, task_exists: false,
      };
      taskMap.set(row.task_id, created);
      return created;
    };
    for (const completion of filteredCompletions) ensureTask(completion).processed_count += 1;
    for (const call of filteredCalls) {
      const task = ensureTask(call);
      task.model_call_count += 1;
      task.input_tokens += Number(call.input_tokens || 0);
      task.cached_input_tokens += Number(call.cached_input_tokens || 0);
      task.output_tokens += Number(call.output_tokens || 0);
      task.total_tokens += Number(call.total_tokens || 0);
      task.total_cost_usd += Number(call.cost_usd || 0);
    }

    const taskIds = [...taskMap.keys()];
    const existing = new Set<string>();
    for (let offset = 0; offset < taskIds.length; offset += 200) {
      let existingQuery = admin.from("ai_screening_tasks").select("id").in("id", taskIds.slice(offset, offset + 200));
      if (scopeUserId) existingQuery = existingQuery.eq("user_id", scopeUserId);
      const result = await existingQuery;
      if (result.error) throw result.error;
      for (const row of result.data || []) existing.add(row.id);
    }
    for (const id of existing) {
      const task = taskMap.get(id);
      if (task) task.task_exists = true;
    }

    const allTaskRows = [...taskMap.values()]
      .filter((task) => !status || task.status === status)
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    const totalsResult = await admin.rpc("ai_screening_usage_totals", { p_user_id: scopeUserId });
    if (totalsResult.error) throw totalsResult.error;
    const historical = Array.isArray(totalsResult.data) ? totalsResult.data[0] : totalsResult.data;
    const totals = {
      processed: Number(historical?.processed || 0), input: Number(historical?.input_tokens || 0),
      cached: Number(historical?.cached_input_tokens || 0), output: Number(historical?.output_tokens || 0),
      tokens: Number(historical?.total_tokens || 0), cost: Number(historical?.cost_usd || 0),
    };
    const dailyMap = new Map<string, { date: string; tokens: number; cost: number; processed: number }>();
    for (const call of filteredCalls) {
      const date = call.occurred_at.slice(0, 10);
      const current = dailyMap.get(date) || { date, tokens: 0, cost: 0, processed: 0 };
      current.tokens += Number(call.total_tokens || 0);
      current.cost += Number(call.cost_usd || 0);
      dailyMap.set(date, current);
    }
    for (const completion of filteredCompletions) {
      const date = completion.completed_at.slice(0, 10);
      const current = dailyMap.get(date) || { date, tokens: 0, cost: 0, processed: 0 };
      current.processed += 1;
      dailyMap.set(date, current);
    }
    const daily = [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date));
    const count = allTaskRows.length;
    const tasks = returnAll ? allTaskRows : allTaskRows.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({ tasks, count, page, pageSize, models, totals, daily, show_owner: account.role !== "SALES" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI筛选用量查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
