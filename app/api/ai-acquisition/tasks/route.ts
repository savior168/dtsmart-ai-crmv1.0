import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_ACQUISITION_DISCOVERY_CEILING, MAX_ACQUISITION_INDUSTRIES, MAX_ACQUISITION_KEYWORDS, normalizeAcquisitionCountries } from "@/lib/ai-acquisition/config";
import { normalizeError } from "@/lib/ai/error-normalization";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";
import { acquisitionTaskNumberPrefix, createAcquisitionTaskNumber } from "@/lib/ai/task-number";
import { isActuallyIncurredCost } from "@/lib/api-cost-actual";
import { rescueStalledAiAcquisitionTasks } from "@/lib/ai-acquisition/dispatch";

function presentTask<T extends Record<string, unknown>>(task: T) {
  const scheduled = task.status === "QUEUED" && !task.started_at && task.last_dispatch_at && new Date(String(task.last_dispatch_at)).getTime() > Date.now()
    ? String(task.last_dispatch_at)
    : null;
  return { ...task, scheduled_at: scheduled };
}

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    try {
      await rescueStalledAiAcquisitionTasks();
    } catch (recoveryError) {
      console.error("[ai-acquisition] best-effort task recovery failed", recoveryError);
    }
    const ownerId = await requestedOwnerId(request, account, "ai.acquisition.data_all");
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const status = request.nextUrl.searchParams.get("status") || "";
    const metric = request.nextUrl.searchParams.get("metric") || "";
    const search = (request.nextUrl.searchParams.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const costMode = request.nextUrl.searchParams.get("cost_mode") || "";
    const countries = [...new Set(request.nextUrl.searchParams.getAll("country").map((value) => value.trim()).filter(Boolean))];
    const industries = [...new Set(request.nextUrl.searchParams.getAll("industry").map((value) => value.trim()).filter(Boolean))];
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    const admin = createAdminClient();
    const optionRows: Array<{countries:string[] | null;industries:string[] | null;industry:string | null}> = [];
    for(let offset=0;offset<20000;offset+=1000){
      let optionQuery=admin.from("ai_acquisition_tasks").select("countries,industries,industry");
      if(ownerId)optionQuery=optionQuery.eq("user_id",ownerId);
      const optionPage=await optionQuery.order("created_at",{ascending:false}).range(offset,offset+999);
      if(optionPage.error)throw optionPage.error;
      optionRows.push(...(optionPage.data||[]));
      if((optionPage.data||[]).length<1000)break;
    }
    const countOptions=(values:string[])=>[...values.reduce((map,value)=>{const normalized=String(value||"").trim();if(normalized)map.set(normalized,(map.get(normalized)||0)+1);return map},new Map<string,number>())].map(([value,count])=>({value,count})).sort((left,right)=>right.count-left.count||left.value.localeCompare(right.value,"zh-CN"));
    const filterOptions={
      countries:countOptions(optionRows.flatMap((row)=>Array.isArray(row.countries)?row.countries:[])),
      industries:countOptions(optionRows.flatMap((row)=>Array.isArray(row.industries)&&row.industries.length?row.industries:[row.industry||""])),
    };
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let acceptedMetricTaskIds: string[] = [];
    if (["accepted", "today_accepted"].includes(metric)) {
      for (let offset = 0; ; offset += 1000) {
        let acceptedRows = admin.from("ai_acquisition_candidates").select("task_id").eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
        if (metric === "today_accepted") acceptedRows = acceptedRows.gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
        const chunk = await acceptedRows.range(offset, offset + 999);
        if (chunk.error) throw chunk.error;
        acceptedMetricTaskIds.push(...(chunk.data || []).map((row) => row.task_id));
        if ((chunk.data || []).length < 1000) break;
      }
      acceptedMetricTaskIds = [...new Set(acceptedMetricTaskIds)];
    }
    let query = admin.from("ai_acquisition_tasks").select("*,owner:users!ai_acquisition_tasks_user_id_fkey(id,name,email)", { count: "exact" });
    if (ownerId) query = query.eq("user_id", ownerId);
    if (status) query = query.eq("status", status);
    else if (metric === "active") query = query.in("status", ["QUEUED", "RUNNING", "PAUSING", "PAUSED"]);
    else if (metric === "completed") query = query.eq("status", "COMPLETED");
    else if (metric === "failed") query = query.eq("status", "FAILED");
    if (metric === "accepted") query = acceptedMetricTaskIds.length ? query.in("id", acceptedMetricTaskIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    if (metric === "today_accepted") query = acceptedMetricTaskIds.length ? query.in("id", acceptedMetricTaskIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    if (metric === "review") query = query.gt("review_count", 0);
    if (["FREE_ONLY", "ADAPTIVE"].includes(costMode)) query = query.eq("cost_mode", costMode);
    if (countries.length) query = query.overlaps("countries", countries);
    if (industries.length) query = query.overlaps("industries", industries);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000+08:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999+08:00`);
    if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
    const result = await query.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const pageTaskIds = (result.data || []).map((row) => String(row.id));
    const checkpointResult = pageTaskIds.length
      ? await admin.rpc("get_ai_acquisition_discovery_progress", { p_task_ids: pageTaskIds })
      : { data: [], error: null };
    if (checkpointResult.error) throw checkpointResult.error;
    const checkpointByTask = new Map<string, { completed:number; rawHits:number }>();
    for (const checkpoint of checkpointResult.data || []) {
      const taskId = String(checkpoint.task_id);
      checkpointByTask.set(taskId, { completed:Number(checkpoint.terminal_count||0), rawHits:Number(checkpoint.raw_hit_count||0) });
    }
    const usageByTask = new Map<string,{google_calls:number;openai_calls:number;total_tokens:number;openai_cost_usd:number;google_cost_usd:number;total_cost_usd:number}>();
    if (pageTaskIds.length && hasPermission(account, "ai.acquisition.usage.view")) {
      const costParentByTask = new Map(pageTaskIds.map((taskId)=>[taskId,taskId]));
      const childResult = await admin.from("ai_acquisition_candidates").select("task_id,screening_task_id").in("task_id",pageTaskIds).not("screening_task_id","is",null);
      if(childResult.error)throw childResult.error;
      for(const child of childResult.data||[])if(child.screening_task_id)costParentByTask.set(String(child.screening_task_id),String(child.task_id));
      const costTaskIds=[...costParentByTask.keys()];
      const costRows:Array<{task_id:string|null;provider:string;quantity:number;input_tokens:number;output_tokens:number;amount_usd:number;amount_type:string}>=[];
      for(let offset=0;;offset+=1000){const chunk=await admin.from("api_cost_ledger").select("task_id,provider,quantity,input_tokens,output_tokens,amount_usd,amount_type").in("task_id",costTaskIds).range(offset,offset+999);if(chunk.error)throw chunk.error;costRows.push(...(chunk.data||[]));if((chunk.data||[]).length<1000)break}
      for(const cost of costRows){
        const parentId=costParentByTask.get(String(cost.task_id||""));
        if(!parentId)continue;
        const current=usageByTask.get(parentId)||{google_calls:0,openai_calls:0,total_tokens:0,openai_cost_usd:0,google_cost_usd:0,total_cost_usd:0};
        const quantity=Math.max(0,Number(cost.quantity||1));
        const amount=Number(cost.amount_usd||0);
        if(cost.provider==="GOOGLE_PLACES"){current.google_calls+=quantity;if(isActuallyIncurredCost(cost))current.google_cost_usd+=amount}
        if(cost.provider==="OPENAI"){current.openai_calls+=quantity;current.openai_cost_usd+=amount;current.total_tokens+=Number(cost.input_tokens||0)+Number(cost.output_tokens||0)}
        if(isActuallyIncurredCost(cost))current.total_cost_usd+=amount;
        usageByTask.set(parentId,current);
      }
    }
    const summaryRows: Array<{ id:string; status: string; accepted_count: number | null; review_count: number | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      let summaryQuery = admin.from("ai_acquisition_tasks").select("id,status,accepted_count,review_count");
      if (ownerId) summaryQuery = summaryQuery.eq("user_id", ownerId);
      if (["FREE_ONLY", "ADAPTIVE"].includes(costMode)) summaryQuery = summaryQuery.eq("cost_mode", costMode);
      if (countries.length) summaryQuery = summaryQuery.overlaps("countries", countries);
      if (industries.length) summaryQuery = summaryQuery.overlaps("industries", industries);
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) summaryQuery = summaryQuery.gte("created_at", `${from}T00:00:00.000+08:00`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) summaryQuery = summaryQuery.lte("created_at", `${to}T23:59:59.999+08:00`);
      if (search) summaryQuery = summaryQuery.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
      const chunk = await summaryQuery.order("created_at", { ascending: false }).range(offset, offset + 999);
      if (chunk.error) throw chunk.error;
      summaryRows.push(...(chunk.data || []));
      if ((chunk.data || []).length < 1000) break;
    }
    const sum = (key: "accepted_count" | "review_count") => summaryRows.reduce((total, row) => total + Number(row[key] || 0), 0);
    let totalAccepted = 0;
    let todayAccepted = 0;
    const summaryTaskIds = summaryRows.map((row) => row.id);
    for (let offset = 0; offset < summaryTaskIds.length; offset += 150) {
      const result = await admin.from("ai_acquisition_candidates").select("id", { count:"exact", head:true }).in("task_id", summaryTaskIds.slice(offset, offset + 150)).eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
      if (result.error) throw result.error;
      todayAccepted += result.count || 0;
      const allResult = await admin.from("ai_acquisition_candidates").select("id", { count:"exact", head:true }).in("task_id", summaryTaskIds.slice(offset, offset + 150)).eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
      if (allResult.error) throw allResult.error;
      totalAccepted += allResult.count || 0;
    }
    const summary = {
      tasks: summaryRows.length,
      active_tasks: summaryRows.filter((row) => ["QUEUED", "RUNNING", "PAUSING", "PAUSED"].includes(row.status)).length,
      completed_tasks: summaryRows.filter((row) => row.status === "COMPLETED").length,
      today_accepted: todayAccepted,
      accepted: totalAccepted,
      review: sum("review_count"),
      failed_tasks: summaryRows.filter((row) => row.status === "FAILED").length,
    };
    return NextResponse.json({ data: (result.data || []).map((row) => { const taskId=String(row.id);const progress=checkpointByTask.get(taskId); return presentTask({ ...row, search_completed_count:progress?.completed||0, search_raw_hits:progress?.rawHits||0, usage:usageByTask.get(taskId)||null, can_control:hasPermission(account,"ai.acquisition.control")&&(row.user_id===account.id||account.role==="ADMIN") }); }), count: result.count || 0, summary, filter_options:filterOptions, can_create: hasPermission(account, "ai.acquisition.create"), can_control: hasPermission(account, "ai.acquisition.control"), can_view_evidence: hasPermission(account, "ai.acquisition.evidence.view"), can_view_usage: hasPermission(account, "ai.acquisition.usage.view"), can_manage_settings: hasPermission(account, "ai.acquisition.settings.manage"), show_owner: hasPermission(account, "ai.acquisition.data_all") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客任务加载失败";
    console.error("[ai-acquisition/tasks] list failed", error);
    const publicMessage = message === "UNAUTHORIZED" ? "登录已失效，请重新登录" : message === "FORBIDDEN" ? "无权查看AI获客任务" : "AI获客任务加载失败，请稍后重试";
    return NextResponse.json({ error: publicMessage }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermission("ai.acquisition.create");
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name || "").trim().slice(0, 100);
    const validIndustry = (value: string) => value.length >= 2 && value.length <= 60 && !/[<>\r\n]/.test(value);
    const submittedIndustries = Array.isArray(body.industries)
      ? [...new Set(body.industries.map(String).map((value) => value.trim()).filter(validIndustry))]
      : validIndustry(String(body.industry || "").trim()) ? [String(body.industry).trim()] : [];
    if (submittedIndustries.length > MAX_ACQUISITION_INDUSTRIES) return NextResponse.json({ error: `目标行业最多选择${MAX_ACQUISITION_INDUSTRIES}个，请拆分任务后重试` }, { status: 400 });
    const industries = submittedIndustries;
    const industry = industries.join("、");
    const countries = normalizeAcquisitionCountries(body.countries);
    const submittedKeywords = Array.isArray(body.keywords) ? [...new Set(body.keywords.map(String).map((value) => value.trim()).filter((value) => value.length <= 80))] : [];
    if (submittedKeywords.length > MAX_ACQUISITION_KEYWORDS) return NextResponse.json({ error: `搜索关键词最多填写${MAX_ACQUISITION_KEYWORDS}个，请合并同义词或拆分任务后重试` }, { status: 400 });
    const keywords = submittedKeywords;
    const requestKey = String(body.request_key || "").trim();
    const requestedSchedule = body.scheduled_at ? new Date(String(body.scheduled_at)) : null;
    const scheduledAt = requestedSchedule && Number.isFinite(requestedSchedule.getTime()) && requestedSchedule.getTime() > Date.now()
      ? requestedSchedule.toISOString()
      : null;
    const targetCount = DEFAULT_ACQUISITION_DISCOVERY_CEILING;
    const costMode = body.cost_mode === "FREE_ONLY" ? "FREE_ONLY" : "ADAPTIVE";
    const rawTaskCostLimit = body.task_cost_limit_usd;
    const taskCostLimit = costMode === "FREE_ONLY"
      ? 0
      : rawTaskCostLimit === "" || rawTaskCostLimit == null
        ? null
        : Number(rawTaskCostLimit);
    if (!name) return NextResponse.json({ error: "请输入任务名称" }, { status: 400 });
    if (!industries.length) return NextResponse.json({ error: "请至少选择或输入一个明确的目标行业" }, { status: 400 });
    if (!keywords.length) return NextResponse.json({ error: "请至少选择或输入一个搜索关键词" }, { status: 400 });
    if (!countries.length || countries.length > 8) return NextResponse.json({ error: "请选择1至8个已支持的目标国家" }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(requestKey)) return NextResponse.json({ error: "任务请求标识无效，请刷新后重试" }, { status: 400 });
    if (body.scheduled_at && !scheduledAt) return NextResponse.json({ error: "请选择晚于当前时间的预约执行时间" }, { status: 400 });
    if (costMode === "ADAPTIVE" && taskCostLimit !== null && (!Number.isFinite(taskCostLimit) || taskCostLimit <= 0)) return NextResponse.json({ error: "单任务费用上限必须大于0；留空表示仅遵循AI获客全局费用限制" }, { status: 400 });
    const admin = createAdminClient();
    const numberPrefix = acquisitionTaskNumberPrefix(user.id, requestKey, costMode);
    const number = createAcquisitionTaskNumber(user.id, requestKey, costMode);
    const existing = await admin.from("ai_acquisition_tasks").select("*").eq("user_id", user.id).like("task_number", `${numberPrefix}-%`).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ task: presentTask(existing.data), reused: true });
    const task = await admin.from("ai_acquisition_tasks").insert({ user_id: user.id, task_number: number, name, cost_mode: costMode, countries, industry, industries, keywords, excluded_keywords: [], target_count: targetCount, task_cost_limit_usd: taskCostLimit }).select("*").single();
    if (task.error?.code === "23505") {
      const repeated = await admin.from("ai_acquisition_tasks").select("*").eq("user_id", user.id).like("task_number", `${numberPrefix}-%`).maybeSingle();
      if (!repeated.error && repeated.data) return NextResponse.json({ task: presentTask(repeated.data), reused: true });
    }
    if (task.error || !task.data) throw task.error || new Error("AI获客任务创建失败");
    try {
      const run = await start(aiAcquisitionWorkflow, [task.data.id, scheduledAt]);
      const updated = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: scheduledAt || new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", task.data.id).select("*").single();
      if (updated.error) throw updated.error;
      await admin.from("audit_logs").insert({ user_id: user.id, action: "AI_ACQUISITION_TASK_CREATE", target_type: "ai_acquisition_task", target_id: task.data.id, content: { task_number: task.data.task_number, cost_mode: costMode, countries, industries, keywords, scheduled_at: scheduledAt, search_policy: "ALL_QUALIFIED_WITHIN_SUPPORTED_SOURCES", task_cost_limit_usd: taskCostLimit } });
      return NextResponse.json({ task: presentTask(updated.data) }, { status: 201 });
    } catch (dispatchError) {
      await admin.from("ai_acquisition_tasks").update({ status: "FAILED", error_message: dispatchError instanceof Error ? dispatchError.message : "云端任务启动失败", updated_at: new Date().toISOString() }).eq("id", task.data.id);
      throw dispatchError;
    }
  } catch (error) {
    const normalized = normalizeError(error, { stage: "CREATE_AI_ACQUISITION_TASK" });
    console.error("[ai-acquisition/tasks] create failed", normalized);
    const message = /ai_acquisition_tasks_industries_check/i.test(`${normalized.error_message} ${normalized.details || ""}`)
      ? `目标行业最多选择${MAX_ACQUISITION_INDUSTRIES}个，请调整后重试`
      : normalized.error_message === "未返回可识别的错误信息"
        ? "AI获客任务创建失败，请稍后重试"
        : normalized.error_message;
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
