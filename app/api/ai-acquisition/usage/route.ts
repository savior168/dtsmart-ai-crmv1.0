import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { actualCostUsd, isActuallyIncurredCost } from "@/lib/api-cost-actual";
import { summarizeUsagePurposes } from "@/lib/api-usage-purpose";

type CostRow = { task_id: string | null; provider: string; model_or_sku: string | null; operation: string; amount_type: string; amount_usd: number; quantity: number; input_tokens:number; cached_input_tokens:number; output_tokens:number; metadata:Record<string,unknown>|null; occurred_at: string };
type CandidateRow = { id:string; task_id:string; decision:string; imported_customer_id:string|null; created_at:string; processed_at:string|null };

function shanghaiDay(value:string) {
  return new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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
    const allTime = params.get("all_time") === "1";
    const overview = params.get("overview") === "1";
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
      let costQuery = admin.from("api_cost_ledger").select("task_id,provider,model_or_sku,operation,amount_type,amount_usd,quantity,input_tokens,cached_input_tokens,output_tokens,metadata,occurred_at").in("task_id", costIds.slice(offset, offset + 150));
      if (!allTime) costQuery = costQuery.gte("occurred_at", `${from}T00:00:00.000+08:00`).lte("occurred_at", `${to}T23:59:59.999+08:00`);
      const result = await costQuery;
      if (result.error) throw result.error;
      costs.push(...((result.data || []) as CostRow[]));
    }
    const candidates:CandidateRow[]=[];
    for (let offset = 0; offset < parentIds.length; offset += 150) {
      for (let rowOffset = 0; ; rowOffset += 1000) {
        const result = await admin.from("ai_acquisition_candidates").select("id,task_id,decision,imported_customer_id,created_at,processed_at").in("task_id", parentIds.slice(offset, offset + 150)).order("created_at",{ascending:true}).order("id",{ascending:true}).range(rowOffset,rowOffset+999);
        if (result.error) throw result.error;
        const candidateRows=(result.data||[]) as CandidateRow[];
        candidates.push(...candidateRows);
        if(candidateRows.length<1000)break;
      }
    }
    const rangeStart = Date.parse(`${from}T00:00:00.000+08:00`);
    const rangeEnd = Date.parse(`${to}T23:59:59.999+08:00`);
    const createdInRange=(candidate:CandidateRow)=>allTime||(Date.parse(candidate.created_at)>=rangeStart&&Date.parse(candidate.created_at)<=rangeEnd);
    const processedInRange=(candidate:CandidateRow)=>Boolean(candidate.processed_at)&&(allTime||(Date.parse(String(candidate.processed_at))>=rangeStart&&Date.parse(String(candidate.processed_at))<=rangeEnd));
    const discoveredCandidates=candidates.filter(createdInRange);
    const processedCandidates=candidates.filter(processedInRange);
    const acceptedCandidates=processedCandidates.filter((candidate)=>candidate.decision==="ACCEPTED"&&Boolean(candidate.imported_customer_id));
    const candidateTaskIdsInRange=new Set([...discoveredCandidates,...processedCandidates].map((candidate)=>candidate.task_id));
    const rows = tasks.map((task) => {
      const taskCosts = costs.filter((cost) => cost.task_id && parentByCostTask.get(cost.task_id) === task.id);
      const quantity = (rows: CostRow[]) => rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 1)), 0);
      return { ...task, calls: quantity(taskCosts), free_calls: quantity(taskCosts.filter((cost) => cost.amount_type === "FREE")), google_calls: quantity(taskCosts.filter((cost) => cost.provider === "GOOGLE_PLACES")), openai_calls: quantity(taskCosts.filter((cost) => cost.provider === "OPENAI")), google_catalog_cost_usd: taskCosts.filter((cost) => cost.provider === "GOOGLE_PLACES").reduce((sum,cost)=>sum+Number(cost.amount_usd||0),0), total_cost_usd: actualCostUsd(taskCosts) };
    }).filter((task) => allTime || task.calls > 0 || candidateTaskIdsInRange.has(task.id) || (Date.parse(task.created_at) >= rangeStart && Date.parse(task.created_at) <= rangeEnd));
    const quantity = (items: CostRow[]) => items.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 1)), 0);
    const summary = { tasks: rows.length, discovered: discoveredCandidates.length, processed: processedCandidates.length, accepted:acceptedCandidates.length, calls: quantity(costs), free_calls: quantity(costs.filter((row) => row.amount_type === "FREE")), google_calls: quantity(costs.filter((row) => row.provider === "GOOGLE_PLACES")), google_free_calls: quantity(costs.filter((row) => row.provider === "GOOGLE_PLACES" && row.amount_type === "FREE")), openai_calls: quantity(costs.filter((row) => row.provider === "OPENAI")), openai_cost_usd: costs.filter((row) => row.provider === "OPENAI").reduce((sum, row) => sum + Number(row.amount_usd || 0), 0), google_cost_usd: costs.filter((row) => row.provider === "GOOGLE_PLACES" && isActuallyIncurredCost(row)).reduce((sum, row) => sum + Number(row.amount_usd || 0), 0), google_catalog_cost_usd: costs.filter((row) => row.provider === "GOOGLE_PLACES").reduce((sum,row)=>sum+Number(row.amount_usd||0),0), total_cost_usd: actualCostUsd(costs), purpose_breakdown:summarizeUsagePurposes(costs) };
    const todayStart = Date.parse(`${today}T00:00:00.000+08:00`);
    const todayEnd = Date.parse(`${today}T23:59:59.999+08:00`);
    const todayCosts = costs.filter((row) => { const timestamp=Date.parse(row.occurred_at); return timestamp>=todayStart&&timestamp<=todayEnd; });
    const todayProcessed = candidates.filter((candidate) => { const timestamp=Date.parse(String(candidate.processed_at||"")); return Number.isFinite(timestamp)&&timestamp>=todayStart&&timestamp<=todayEnd; });
    const todaySummary = {
      calls: quantity(todayCosts),
      total_cost_usd: actualCostUsd(todayCosts),
      processed: todayProcessed.length,
      accepted: todayProcessed.filter((candidate)=>candidate.decision==="ACCEPTED"&&Boolean(candidate.imported_customer_id)).length,
    };
    const dailyByDate=new Map<string,{date:string;discovered:number;processed:number;accepted:number;calls:number;cost:number}>();
    const dailyRow=(date:string)=>{const current=dailyByDate.get(date)||{date,discovered:0,processed:0,accepted:0,calls:0,cost:0};dailyByDate.set(date,current);return current};
    if(!allTime){
      for(let cursor=from;cursor<=to;){dailyRow(cursor);const next=new Date(`${cursor}T00:00:00.000Z`);next.setUTCDate(next.getUTCDate()+1);cursor=next.toISOString().slice(0,10);if(dailyByDate.size>=366)break}
      for(const candidate of discoveredCandidates)dailyRow(shanghaiDay(candidate.created_at)).discovered+=1;
      for(const candidate of processedCandidates){const row=dailyRow(shanghaiDay(String(candidate.processed_at)));row.processed+=1;if(candidate.decision==="ACCEPTED"&&candidate.imported_customer_id)row.accepted+=1}
      for(const cost of costs){const row=dailyRow(shanghaiDay(cost.occurred_at));row.calls+=Math.max(0,Number(cost.quantity||1));if(isActuallyIncurredCost(cost))row.cost+=Number(cost.amount_usd||0)}
    }
    const daily=[...dailyByDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
    return NextResponse.json({ summary, today_summary:overview?todaySummary:undefined, daily, data: overview?[]:rows.slice((page - 1) * pageSize, page * pageSize), count: rows.length, show_owner: hasPermission(account, "ai.acquisition.data_all") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客用量查询失败";
    console.error("[ai-acquisition/usage] query failed", error);
    const publicMessage = ["UNAUTHORIZED", "SESSION_REVOKED", "FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(message) || message.startsWith("ACCOUNT_") ? message : "AI获客用量查询失败，请稍后重试";
    return NextResponse.json({ error: publicMessage }, { status: authErrorStatus(publicMessage) });
  }
}
