import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type CostRow = { task_id: string | null; provider: string; model_or_sku: string | null; operation: string; amount_type: string; amount_usd: number; quantity: number; occurred_at: string };

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.acquisition.usage.view");
    const ownerId = await requestedOwnerId(request, account, "ai.acquisition.data_all");
    const params = request.nextUrl.searchParams;
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rawFrom = params.get("from") || today;
    const rawTo = params.get("to") || rawFrom;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(rawTo) ? rawTo : from;
    const status = params.get("status") || "";
    const costMode = params.get("cost_mode") || "";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const admin = createAdminClient();
    let taskQuery = admin.from("ai_acquisition_tasks").select("id,user_id,task_number,name,status,cost_mode,discovered_count,processed_count,accepted_count,elapsed_ms,created_at,updated_at,owner:users!ai_acquisition_tasks_user_id_fkey(id,name,email)");
    if (ownerId) taskQuery = taskQuery.eq("user_id", ownerId);
    if (status) taskQuery = taskQuery.eq("status", status);
    if (["FREE_ONLY", "ADAPTIVE"].includes(costMode)) taskQuery = taskQuery.eq("cost_mode", costMode);
    const taskResult = await taskQuery.order("updated_at", { ascending: false });
    if (taskResult.error) throw taskResult.error;
    const tasks = taskResult.data || [];
    const parentIds = tasks.map((task) => task.id);
    const parentByCostTask = new Map(parentIds.map((id) => [id, id]));
    for (let offset = 0; offset < parentIds.length; offset += 200) {
      const children = await admin.from("ai_acquisition_candidates").select("task_id,screening_task_id").in("task_id", parentIds.slice(offset, offset + 200)).not("screening_task_id", "is", null);
      if (children.error) throw children.error;
      for (const row of children.data || []) if (row.screening_task_id) parentByCostTask.set(row.screening_task_id, row.task_id);
    }
    const costIds = [...parentByCostTask.keys()];
    const costs: CostRow[] = [];
    for (let offset = 0; offset < costIds.length; offset += 150) {
      const result = await admin.from("api_cost_ledger").select("task_id,provider,model_or_sku,operation,amount_type,amount_usd,quantity,occurred_at").in("task_id", costIds.slice(offset, offset + 150)).gte("occurred_at", `${from}T00:00:00.000+08:00`).lte("occurred_at", `${to}T23:59:59.999+08:00`);
      if (result.error) throw result.error;
      costs.push(...((result.data || []) as CostRow[]));
    }
    const rangeStart = Date.parse(`${from}T00:00:00.000+08:00`);
    const rangeEnd = Date.parse(`${to}T23:59:59.999+08:00`);
    const rows = tasks.map((task) => {
      const taskCosts = costs.filter((cost) => cost.task_id && parentByCostTask.get(cost.task_id) === task.id);
      const quantity = (rows: CostRow[]) => rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 1)), 0);
      return { ...task, calls: quantity(taskCosts), free_calls: quantity(taskCosts.filter((cost) => cost.amount_type === "FREE")), google_calls: quantity(taskCosts.filter((cost) => cost.provider === "GOOGLE_PLACES")), openai_calls: quantity(taskCosts.filter((cost) => cost.provider === "OPENAI")), total_cost_usd: taskCosts.reduce((sum, cost) => sum + Number(cost.amount_usd || 0), 0) };
    }).filter((task) => task.calls > 0 || (Date.parse(task.created_at) >= rangeStart && Date.parse(task.created_at) <= rangeEnd));
    const quantity = (items: CostRow[]) => items.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 1)), 0);
    const summary = { tasks: rows.length, discovered: rows.reduce((sum, row) => sum + Number(row.discovered_count || 0), 0), accepted: rows.reduce((sum, row) => sum + Number(row.accepted_count || 0), 0), calls: quantity(costs), free_calls: quantity(costs.filter((row) => row.amount_type === "FREE")), google_calls: quantity(costs.filter((row) => row.provider === "GOOGLE_PLACES")), openai_calls: quantity(costs.filter((row) => row.provider === "OPENAI")), total_cost_usd: costs.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0) };
    return NextResponse.json({ summary, data: rows.slice((page - 1) * pageSize, page * pageSize), count: rows.length, show_owner: hasPermission(account, "ai.acquisition.data_all") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客用量查询失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) });
  }
}
