import { createClient } from "@supabase/supabase-js";

const taskId = process.argv[2] || process.env.AI_AUDIT_TASK_ID;
if (!taskId) throw new Error("请提供 task_id");
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) throw new Error(`缺少环境变量：${key}`);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const must = (label, response) => {
  if (response.error) throw new Error(`${label}：${response.error.message}`);
  return response.data || [];
};

const task = must("任务查询", await db.from("ai_screening_tasks").select("*").eq("id", taskId).single());
const items = must("任务客户查询", await db.from("ai_screening_task_items")
  .select("id,customer_id,status,current_step,attempt_count,error_code,error_message,retryable,automation_status,early_stop_reason,input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd,duration_ms,started_at,completed_at,updated_at,channel_checkpoint")
  .eq("task_id", taskId));
const results = must("分析结果查询", await db.from("ai_screening_results")
  .select("id,task_item_id,customer_id,target_decision,automation_status,evidence_sufficiency,evidence_sufficiency_score,early_stop_reason,input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd,model_calls,completed_at,created_at")
  .eq("task_id", taskId));
const evidence = must("证据查询", await db.from("ai_screening_evidence")
  .select("id,result_id,customer_id,status,fetch_status,evidence_strength,evidence_type,source_url,source_id,error_code,failure_reason")
  .eq("task_id", taskId));
const calls = must("模型调用查询", await db.from("ai_screening_model_calls")
  .select("id,task_item_id,customer_id,channel,attempt_number,status,input_tokens,cached_input_tokens,output_tokens,total_tokens,cost_usd,duration_ms,error_code,error_message,created_at")
  .eq("task_id", taskId));

const group = (rows, getter) => Object.fromEntries(
  [...rows.reduce((map, row) => {
    const key = String(getter(row) ?? "NULL");
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map())].sort((a, b) => b[1] - a[1]),
);
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const byItem = (rows) => rows.reduce((map, row) => {
  const key = String(row.task_item_id || "NO_ITEM");
  const list = map.get(key) || [];
  list.push(row);
  map.set(key, list);
  return map;
}, new Map());

const resultsByItem = byItem(results);
const callsByItem = byItem(calls);
const evidenceByResult = evidence.reduce((map, row) => {
  const key = String(row.result_id || "NO_RESULT");
  map.set(key, (map.get(key) || 0) + 1);
  return map;
}, new Map());

const itemMismatches = items.map((item) => {
  const itemResults = resultsByItem.get(item.id) || [];
  const itemCalls = callsByItem.get(item.id) || [];
  const resultTokens = sum(itemResults, "total_tokens");
  const callTokens = sum(itemCalls, "total_tokens");
  const resultCost = sum(itemResults, "cost_usd");
  const callCost = sum(itemCalls, "cost_usd");
  const evidenceCount = itemResults.reduce((n, result) => n + Number(evidenceByResult.get(result.id) || 0), 0);
  const mismatch = Number(item.total_tokens || 0) !== resultTokens
    || resultTokens !== callTokens
    || Math.abs(Number(item.cost_usd || 0) - resultCost) > 0.000001
    || Math.abs(resultCost - callCost) > 0.000001;
  return {
    item_id: item.id,
    status: item.status,
    current_step: item.current_step,
    error_code: item.error_code,
    item_tokens: Number(item.total_tokens || 0),
    result_tokens: resultTokens,
    call_tokens: callTokens,
    item_cost: Number(item.cost_usd || 0),
    result_cost: resultCost,
    call_cost: callCost,
    result_count: itemResults.length,
    model_call_count: itemCalls.length,
    evidence_count: evidenceCount,
    mismatch,
  };
}).filter((row) => row.mismatch || row.status === "FAILED");

const strongEvidence = evidence.filter((row) => ["STRONG", "strong"].includes(String(row.evidence_strength || "")) && row.source_url);
const report = {
  audited_at: new Date().toISOString(),
  task: {
    id: task.id,
    task_number: task.task_number,
    name: task.name,
    strategy: task.strategy,
    status: task.status,
    created_at: task.created_at,
    started_at: task.started_at,
    finished_at: task.finished_at,
    elapsed_ms: task.elapsed_ms,
    total_count: task.total_count,
    success_count: task.success_count,
    failed_count: task.failed_count,
    processed_count: task.processed_count,
    pending_count: task.pending_count,
    total_tokens: Number(task.total_tokens || 0),
    total_cost_usd: Number(task.total_cost_usd || 0),
  },
  facts: {
    item_count: items.length,
    result_count: results.length,
    evidence_count: evidence.length,
    strong_evidence_with_link_count: strongEvidence.length,
    model_call_count: calls.length,
    item_statuses: group(items, (row) => row.status),
    item_steps: group(items, (row) => row.current_step),
    failure_codes: group(items.filter((row) => row.status === "FAILED"), (row) => row.error_code),
    result_decisions: group(results, (row) => row.automation_status || row.target_decision),
    evidence_sufficiency: group(results, (row) => row.evidence_sufficiency),
    early_stop_reasons: group(results, (row) => row.early_stop_reason),
    model_call_statuses: group(calls, (row) => row.status),
  },
  accounting: {
    task_tokens: Number(task.total_tokens || 0),
    items_tokens: sum(items, "total_tokens"),
    results_tokens: sum(results, "total_tokens"),
    model_calls_tokens: sum(calls, "total_tokens"),
    task_cost: Number(task.total_cost_usd || 0),
    items_cost: sum(items, "cost_usd"),
    results_cost: sum(results, "cost_usd"),
    model_calls_cost: sum(calls, "cost_usd"),
  },
  mismatch_count: itemMismatches.length,
  mismatches: itemMismatches,
};

console.log(JSON.stringify(report, null, 2));
