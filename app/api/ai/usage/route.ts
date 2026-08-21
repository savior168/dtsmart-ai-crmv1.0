import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type ModelCall = {
  id: string; task_id: string; customer_id: string; channel: string; model: string | null;
  input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number;
  cost_usd: number; status: string; duration_ms: number | null; error_message: string | null; created_at: string;
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = params.get("to") || new Date().toISOString().slice(0, 10);
    const model = params.get("model")?.trim() || "";
    const status = params.get("status")?.trim() || "";
    const taskId = params.get("task_id")?.trim() || "";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const returnAll = params.get("all") === "true";
    const admin = createAdminClient();

    let taskQuery = admin.from("ai_screening_tasks").select("id,name,task_number,status,total_count,processed_count,input_tokens,cached_input_tokens,output_tokens,total_tokens,total_cost_usd,created_at").eq("user_id", user.id);
    if (status) taskQuery = taskQuery.eq("status", status);
    if (taskId) taskQuery = taskQuery.eq("id", taskId);
    const taskResult = await taskQuery.order("created_at", { ascending: false });
    if (taskResult.error) throw taskResult.error;
    const ownedTasks = taskResult.data || [];
    const taskIds = ownedTasks.map((item) => item.id);
    const allCalls: ModelCall[] = [];
    for (let idOffset = 0; idOffset < taskIds.length; idOffset += 100) {
      const idBatch = taskIds.slice(idOffset, idOffset + 100);
      for (let rowOffset = 0; ; rowOffset += 1000) {
        const calls = await admin.from("ai_screening_model_calls")
          .select("id,task_id,customer_id,channel,model,input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd,status,duration_ms,error_message,created_at")
          .in("task_id", idBatch)
          .gte("created_at", `${from}T00:00:00.000Z`)
          .lte("created_at", `${to}T23:59:59.999Z`)
          .order("created_at", { ascending: false })
          .range(rowOffset, rowOffset + 999);
        if (calls.error) throw calls.error;
        const rows = (calls.data || []) as ModelCall[];
        allCalls.push(...rows);
        if (rows.length < 1000) break;
      }
    }

    const models = [...new Set(allCalls.map((call) => call.model).filter((value): value is string => Boolean(value)))].sort();
    const filteredCalls = model ? allCalls.filter((call) => call.model === model) : allCalls;
    const taskCalls = new Map<string, ModelCall[]>();
    for (const call of filteredCalls) taskCalls.set(call.task_id, [...(taskCalls.get(call.task_id) || []), call]);
    const taskRows = ownedTasks.filter((task) => taskCalls.has(task.id)).map((task) => {
      const calls = taskCalls.get(task.id) || [];
      return {
        ...task,
        processed_count: new Set(calls.map((call) => call.customer_id)).size,
        model_call_count: calls.length,
        input_tokens: calls.reduce((sum, call) => sum + Number(call.input_tokens || 0), 0),
        cached_input_tokens: calls.reduce((sum, call) => sum + Number(call.cached_input_tokens || 0), 0),
        output_tokens: calls.reduce((sum, call) => sum + Number(call.output_tokens || 0), 0),
        total_tokens: calls.reduce((sum, call) => sum + Number(call.total_tokens || 0), 0),
        total_cost_usd: calls.reduce((sum, call) => sum + Number(call.cost_usd || 0), 0),
      };
    });
    const totals = {
      processed: new Set(filteredCalls.map((call) => call.customer_id)).size,
      input: filteredCalls.reduce((sum, call) => sum + Number(call.input_tokens || 0), 0),
      cached: filteredCalls.reduce((sum, call) => sum + Number(call.cached_input_tokens || 0), 0),
      output: filteredCalls.reduce((sum, call) => sum + Number(call.output_tokens || 0), 0),
      tokens: filteredCalls.reduce((sum, call) => sum + Number(call.total_tokens || 0), 0),
      cost: filteredCalls.reduce((sum, call) => sum + Number(call.cost_usd || 0), 0),
    };
    const dailyMap = new Map<string, { date: string; tokens: number; cost: number; customers: Set<string> }>();
    for (const call of filteredCalls) {
      const date = String(call.created_at).slice(0, 10);
      const current = dailyMap.get(date) || { date, tokens: 0, cost: 0, customers: new Set<string>() };
      current.tokens += Number(call.total_tokens || 0);
      current.cost += Number(call.cost_usd || 0);
      current.customers.add(call.customer_id);
      dailyMap.set(date, current);
    }
    const daily = [...dailyMap.values()].map((item) => ({ date: item.date, tokens: item.tokens, cost: item.cost, processed: item.customers.size })).sort((a, b) => a.date.localeCompare(b.date));
    const count = taskRows.length;
    const tasks = returnAll ? taskRows : taskRows.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({ tasks, count, page, pageSize, models, totals, daily });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI筛选用量查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
