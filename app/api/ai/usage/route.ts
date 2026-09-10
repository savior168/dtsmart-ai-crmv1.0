import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
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
  openai_cost_usd: number; google_places_cost_usd: number; google_places_call_count: number;
  google_places_skus: Record<string, { count: number; cost_usd: number }>;
};

type ThirdPartyCall = { task_id: string | null; customer_id: string | null; provider: string; model_or_sku: string | null; quantity: number; amount_usd: number; occurred_at: string };

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

    const thirdPartyCalls: ThirdPartyCall[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = admin.from("api_cost_ledger")
        .select("task_id,customer_id,provider,model_or_sku,quantity,amount_usd,occurred_at")
        .eq("service", "AI筛选").gte("occurred_at", start).lte("occurred_at", end);
      if (scopeUserId) query = query.eq("user_id", scopeUserId);
      if (taskId) query = query.eq("task_id", taskId);
      const result = await query.order("occurred_at", { ascending: false }).range(offset, offset + 999);
      if (result.error) throw result.error;
      const rows = (result.data || []) as ThirdPartyCall[];
      thirdPartyCalls.push(...rows);
      if (rows.length < 1000) break;
    }

    const models = [...new Set(calls.map((call) => call.model).filter((value): value is string => Boolean(value)))].sort();
    const sourceTaskIds = [...new Set([
      ...calls.map((row) => row.task_id),
      ...completions.map((row) => row.task_id),
      ...thirdPartyCalls.map((row) => row.task_id || ""),
    ].filter(Boolean))];
    const existing = new Set<string>();
    const currentStatus = new Map<string, string>();
    for (let offset = 0; offset < sourceTaskIds.length; offset += 200) {
      let existingQuery = admin.from("ai_screening_tasks").select("id,status").in("id", sourceTaskIds.slice(offset, offset + 200));
      if (scopeUserId) existingQuery = existingQuery.eq("user_id", scopeUserId);
      const result = await existingQuery;
      if (result.error) throw result.error;
      for (const row of result.data || []) {
        existing.add(row.id);
        currentStatus.set(row.id, String(row.status || ""));
      }
    }
    const snapshotStatus = new Map<string, string>();
    for (const row of [...calls, ...completions]) {
      if (row.task_id && row.task_status) snapshotStatus.set(row.task_id, row.task_status);
    }
    const taskMatchesStatus = (id: string) => !status || (currentStatus.get(id) || snapshotStatus.get(id) || "") === status;
    const statusTaskIds = new Set(sourceTaskIds.filter(taskMatchesStatus));
    const modelCalls = calls.filter((call) => (!model || call.model === model) && statusTaskIds.has(call.task_id));
    const modelTaskIds = model ? new Set(modelCalls.map((call) => call.task_id)) : statusTaskIds;
    const filteredCalls = modelCalls;
    const filteredCompletions = completions.filter((item) => modelTaskIds.has(item.task_id));
    const taskMap = new Map<string, TaskUsage>();
    const ensureTask = (row: UsageCall | Completion) => {
      const current = taskMap.get(row.task_id);
      if (current) return current;
      const created: TaskUsage = {
        id: row.task_id, name: row.task_name || "已删除的AI筛选任务", task_number: row.task_number,
        status: currentStatus.get(row.task_id) || row.task_status, total_count: Number(row.task_total_count || 0), processed_count: 0,
        model_call_count: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
        total_tokens: 0, total_cost_usd: 0, created_at: row.task_created_at, task_exists: false,
        openai_cost_usd: 0, google_places_cost_usd: 0, google_places_call_count: 0, google_places_skus: {},
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
      task.openai_cost_usd += Number(call.cost_usd || 0);
    }
    const scopedThirdPartyCalls = thirdPartyCalls.filter((call) => call.task_id && modelTaskIds.has(call.task_id));
    for (const call of scopedThirdPartyCalls) {
      if (!call.task_id) continue;
      const task = taskMap.get(call.task_id);
      if (!task || call.provider !== "GOOGLE_PLACES") continue;
      const quantity = Math.max(0, Number(call.quantity || 1));
      const amount = Number(call.amount_usd || 0);
      const sku = call.model_or_sku || "HISTORICAL_UNCLASSIFIED";
      task.google_places_call_count += quantity;
      task.google_places_cost_usd += amount;
      task.total_cost_usd += amount;
      const current = task.google_places_skus[sku] || { count: 0, cost_usd: 0 };
      current.count += quantity; current.cost_usd += amount; task.google_places_skus[sku] = current;
    }

    for (const id of existing) {
      const task = taskMap.get(id);
      if (task) task.task_exists = true;
    }

    const allTaskRows = [...taskMap.values()]
      .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    const selected = allTaskRows.reduce((summary, task) => {
      summary.processed += task.processed_count;
      summary.model_calls += task.model_call_count;
      summary.input += task.input_tokens;
      summary.cached += task.cached_input_tokens;
      summary.output += task.output_tokens;
      summary.tokens += task.total_tokens;
      summary.openai_cost += task.openai_cost_usd;
      summary.google_places_cost += task.google_places_cost_usd;
      summary.google_places_calls += task.google_places_call_count;
      return summary;
    }, { processed: 0, model_calls: 0, input: 0, cached: 0, output: 0, tokens: 0, openai_cost: 0, google_places_cost: 0, google_places_calls: 0 });
    const canViewHistoricalCost = hasPermission(account, "ai.cost_summary.view");
    const totalsResult = canViewHistoricalCost ? await admin.rpc("ai_screening_usage_totals", { p_user_id: null }) : null;
    if (totalsResult?.error) throw totalsResult.error;
    const historical = totalsResult ? (Array.isArray(totalsResult.data) ? totalsResult.data[0] : totalsResult.data) : null;
    const historicalGoogle: ThirdPartyCall[] = [];
    for (let offset = 0; canViewHistoricalCost; offset += 1000) {
      const query = admin.from("api_cost_ledger").select("task_id,customer_id,provider,model_or_sku,quantity,amount_usd,occurred_at").eq("service", "AI筛选").eq("provider", "GOOGLE_PLACES");
      const result = await query.range(offset, offset + 999);
      if (result.error) throw result.error;
      const rows = (result.data || []) as ThirdPartyCall[]; historicalGoogle.push(...rows);
      if (rows.length < 1000) break;
    }
    const historicalGoogleCost = historicalGoogle.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);
    const googleSkuTotals = historicalGoogle.reduce((all, row) => { const sku=row.model_or_sku||"HISTORICAL_UNCLASSIFIED"; const current=all[sku]||{count:0,cost_usd:0}; current.count+=Math.max(0,Number(row.quantity||1)); current.cost_usd+=Number(row.amount_usd||0); all[sku]=current; return all; }, {} as Record<string,{count:number;cost_usd:number}>);
    const totals = canViewHistoricalCost ? {
      processed: Number(historical?.processed || 0), input: Number(historical?.input_tokens || 0),
      cached: Number(historical?.cached_input_tokens || 0), output: Number(historical?.output_tokens || 0),
      tokens: Number(historical?.total_tokens || 0), openai_cost: Number(historical?.cost_usd || 0),
      google_places_cost: historicalGoogleCost, cost: Number(historical?.cost_usd || 0) + historicalGoogleCost,
      google_places_calls: historicalGoogle.reduce((sum,row)=>sum+Math.max(0,Number(row.quantity||1)),0), google_places_skus: googleSkuTotals,
    } : null;
    const googleMonthly = canViewHistoricalCost ? [...historicalGoogle.reduce((months, row) => {
      const month = String(row.occurred_at || "").slice(0, 7) || "未知月份";
      const current = months.get(month) || { month, calls: 0, cost_usd: 0, skus: {} as Record<string, { count: number; cost_usd: number }> };
      const quantity = Math.max(0, Number(row.quantity || 1));
      const amount = Number(row.amount_usd || 0);
      const sku = row.model_or_sku || "HISTORICAL_UNCLASSIFIED";
      current.calls += quantity;
      current.cost_usd += amount;
      const skuValue = current.skus[sku] || { count: 0, cost_usd: 0 };
      skuValue.count += quantity;
      skuValue.cost_usd += amount;
      current.skus[sku] = skuValue;
      months.set(month, current);
      return months;
    }, new Map<string, { month: string; calls: number; cost_usd: number; skus: Record<string, { count: number; cost_usd: number }> }>()).values()]
      .sort((left, right) => right.month.localeCompare(left.month)) : [];
    const dailyMap = new Map<string, { date: string; tokens: number; cost: number; openai_cost: number; google_places_cost: number; processed: number }>();
    for (const call of filteredCalls) {
      const date = call.occurred_at.slice(0, 10);
      const current = dailyMap.get(date) || { date, tokens: 0, cost: 0, openai_cost: 0, google_places_cost: 0, processed: 0 };
      current.tokens += Number(call.total_tokens || 0);
      current.cost += Number(call.cost_usd || 0);
      current.openai_cost += Number(call.cost_usd || 0);
      dailyMap.set(date, current);
    }
    for (const completion of filteredCompletions) {
      const date = completion.completed_at.slice(0, 10);
      const current = dailyMap.get(date) || { date, tokens: 0, cost: 0, openai_cost: 0, google_places_cost: 0, processed: 0 };
      current.processed += 1;
      dailyMap.set(date, current);
    }
    for (const call of scopedThirdPartyCalls.filter((row)=>row.provider==="GOOGLE_PLACES")) {
      const date=call.occurred_at.slice(0,10); const current=dailyMap.get(date)||{date,tokens:0,cost:0,openai_cost:0,google_places_cost:0,processed:0};
      current.google_places_cost+=Number(call.amount_usd||0); current.cost+=Number(call.amount_usd||0); dailyMap.set(date,current);
    }
    const daily = [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date));
    const count = allTaskRows.length;
    const tasks = returnAll ? allTaskRows : allTaskRows.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({
      tasks, count, page, pageSize, models, selected, totals, google_monthly: googleMonthly, daily,
      show_owner: hasPermission(account, "ai.usage.view_all"),
      show_historical_cost_summary: canViewHistoricalCost,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI筛选用量查询失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
