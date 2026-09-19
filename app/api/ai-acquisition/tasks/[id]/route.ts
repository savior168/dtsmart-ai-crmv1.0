import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "workflow/api";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";
import { plannedDiscoveryScopeCount } from "@/lib/ai-acquisition/discovery";
import { canReadAiOwner } from "@/lib/ai/owner-scope";
import { actualCostUsd, isActuallyIncurredCost } from "@/lib/api-cost-actual";
import { requeueAcquisitionEvidenceGaps, requeueAcquisitionReviews, requeueCorrectedEarlyRejections } from "@/lib/ai-acquisition/requeue";

async function authorizedTask(id: string, account: Awaited<ReturnType<typeof requirePermission>>["account"]) {
  const result = await createAdminClient().from("ai_acquisition_tasks").select("*,owner:users!ai_acquisition_tasks_user_id_fkey(id,name,email)").eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("TASK_NOT_FOUND");
  if (result.data.user_id !== account.id && (!hasPermission(account, "ai.acquisition.data_all") || !await canReadAiOwner(account, result.data.user_id))) throw new Error("FORBIDDEN");
  return result.data;
}

function presentTask<T extends Record<string, unknown>>(task: T) {
  const scheduled = task.status === "QUEUED" && !task.started_at && task.last_dispatch_at && new Date(String(task.last_dispatch_at)).getTime() > Date.now()
    ? String(task.last_dispatch_at)
    : null;
  return { ...task, scheduled_at: scheduled };
}

async function loadCustomerStates(customerIds: string[]) {
  const rows: Array<{id:string;owner_id:string|null;status:string|null}> = [];
  // A single PostgREST `in` filter containing hundreds of UUIDs can exceed
  // the gateway request-line limit. Keep analytics optional and bounded.
  for (let offset = 0; offset < customerIds.length; offset += 100) {
    const chunk = await createAdminClient().from("customers")
      .select("id,owner_id,status")
      .in("id", customerIds.slice(offset, offset + 100));
    if (chunk.error) return { data: rows, error: chunk.error };
    rows.push(...(chunk.data || []));
  }
  return { data: rows, error: null };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const { id } = await context.params;
    const task = await authorizedTask(id, account);
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const decision = request.nextUrl.searchParams.get("decision") || "";
    const search = (request.nextUrl.searchParams.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const countries = [...new Set(request.nextUrl.searchParams.getAll("country").map((value) => value.trim()).filter(Boolean))];
    const industries = [...new Set(request.nextUrl.searchParams.getAll("industry").map((value) => value.trim()).filter(Boolean))];
    const level = request.nextUrl.searchParams.get("level") || "";
    const readiness = request.nextUrl.searchParams.get("readiness") || "";
    const evidenceStatus = request.nextUrl.searchParams.get("evidence_status") || "";
    const sort = request.nextUrl.searchParams.get("sort") || "SALES_PRIORITY";
    const lightweight = request.nextUrl.searchParams.get("lightweight") === "1";
    const report = request.nextUrl.searchParams.get("report") === "1";
    let query = createAdminClient().from("ai_acquisition_candidates").select("*", { count: "exact" }).eq("task_id", id);
    if (decision) query = query.eq("decision", decision);
    if (search) query = query.or(`company_name.ilike.%${search}%,address.ilike.%${search}%`);
    if (countries.length) query = query.in("country", countries);
    if (industries.length) {
      const [industryMatches,categoryMatches]=await Promise.all([
        createAdminClient().from("customers").select("id").in("industry",industries).limit(5000),
        createAdminClient().from("customers").select("id").in("category",industries).limit(5000),
      ]);
      if(industryMatches.error||categoryMatches.error)throw industryMatches.error||categoryMatches.error;
      const matchingCustomerIds=[...new Set([...(industryMatches.data||[]),...(categoryMatches.data||[])].map((row)=>String(row.id)))];
      query=matchingCustomerIds.length?query.or(`staging_customer_id.in.(${matchingCustomerIds.join(",")}),imported_customer_id.in.(${matchingCustomerIds.join(",")})`):query.eq("id","00000000-0000-0000-0000-000000000000");
    }
    if (["A","B","C","D"].includes(level)) query = query.eq("ai_level", level);
    if (readiness === "ACTIONABLE") query = query.eq("has_actionable_contact", true);
    if (readiness === "NO_CONTACT") query = query.eq("has_actionable_contact", false);
    if (evidenceStatus === "COMPLETE") query = query.eq("evidence_complete", true);
    if (evidenceStatus === "GAP") query = query.eq("evidence_complete", false);
    const candidates = lightweight
      ? { data: [], count: 0, error: null }
      : await (sort === "RECENT"
          ? query.order("updated_at", { ascending: false })
          : sort === "SCORE"
            ? query.order("ai_score", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false })
            : query.order("has_actionable_contact", { ascending: false }).order("evidence_complete", { ascending: false }).order("ai_score", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }))
        .range((page - 1) * pageSize, page * pageSize - 1);
    if (candidates.error) throw candidates.error;
    const candidateRows = candidates.data || [];
    const customerIds = [...new Set(candidateRows.flatMap((row) => [row.staging_customer_id, row.imported_customer_id]).filter(Boolean).map(String))];
    const [customerProfiles, verifiedContacts] = await Promise.all([
      customerIds.length
        ? createAdminClient().from("customers").select("id,industry,category,phone,whatsapp,email,website,google_url,facebook_url,instagram_url,linkedin_url,tiktok_url,other_public_urls,business_scope,company_scale_evidence,customer_value,followup_suggestion,acquisition_match_keywords").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      customerIds.length
        ? createAdminClient().from("customer_contacts").select("customer_id,type,value_raw,source_channel,exact_source_url,verification_status,contact_status,captured_at").in("customer_id", customerIds).not("exact_source_url", "is", null).order("captured_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (customerProfiles.error || verifiedContacts.error) throw customerProfiles.error || verifiedContacts.error;
    const profileById = new Map((customerProfiles.data || []).map((row) => [String(row.id), row]));
    const contactsByCustomer = new Map<string, Record<string, unknown>[]>();
    for (const contact of verifiedContacts.data || []) {
      const key = String(contact.customer_id);
      contactsByCustomer.set(key, [...(contactsByCustomer.get(key) || []), contact]);
    }
    const enrichedCandidates = candidateRows.map((row) => {
      const customerId = String(row.staging_customer_id || row.imported_customer_id || "");
      const customerContacts=contactsByCustomer.get(customerId)||[];
      const sourceWebsite=customerContacts.find((contact)=>contact.type==="WEBSITE"&&contact.source_channel==="google_maps"&&String(contact.value_raw||"").trim());
      return { ...row, customer_profile: profileById.get(customerId) || null, verified_contacts: customerContacts, source_website:sourceWebsite?.value_raw||null, source_website_status:sourceWebsite?.verification_status||null };
    });
    const acquisitionChild = await createAdminClient().from("ai_screening_tasks").select("id,status,total_count,pending_count,success_count,failed_count,processed_count,updated_at").eq("request_key", `acquisition:${id}`).maybeSingle();
    if (acquisitionChild.error) {
      console.error("[ai-acquisition-task] optional screening progress unavailable", { task_id: id, child_error: acquisitionChild.error?.code });
    }
    // Cost ownership follows the task's immutable child request_key. Candidate
    // rows may reference historical results for provenance and must never pull
    // another task's usage into this task.
    const screeningIds = [String(acquisitionChild.data?.id||"")].filter(Boolean);
    const taskIds = [id, ...screeningIds];
    const canViewUsage = hasPermission(account, "ai.acquisition.usage.view");
    const discoveryProgressResult = await createAdminClient().rpc("get_ai_acquisition_discovery_progress", { p_task_ids: [id] });
    const [costs, usageSummary, budgetEvents] = canViewUsage ? await Promise.all([
      lightweight ? Promise.resolve({ data: [], error: null }) : createAdminClient().from("api_cost_ledger").select("provider,model_or_sku,operation,amount_usd,amount_type,quantity,input_tokens,output_tokens,occurred_at,metadata").in("task_id", taskIds).order("occurred_at", { ascending: false }).limit(200),
      createAdminClient().rpc("get_ai_acquisition_usage_summary", { p_task_id: id }),
      lightweight ? Promise.resolve({ data: [], error: null }) : createAdminClient().from("api_cost_budget_events").select("blocked_period").in("task_id", taskIds),
    ]) : [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }];
    if (costs.error || budgetEvents.error || discoveryProgressResult.error || usageSummary.error) {
      console.error("[ai-acquisition-task] optional telemetry unavailable", { task_id: id, costs_error: costs.error?.code, budget_error: budgetEvents.error?.code, progress_error: discoveryProgressResult.error?.code, usage_error: usageSummary.error?.code });
    }
    const checkpointProgress=(discoveryProgressResult.data||[])[0]||null;
    const checkpointBlocks=Array.isArray(checkpointProgress?.blocked_periods)?checkpointProgress.blocked_periods.map(String):[];
    const blockedPeriods=[...new Set([...(budgetEvents.data||[]).map((row)=>String(row.blocked_period||"")),...checkpointBlocks].filter(Boolean))];
    const taskIndustries=Array.isArray(task.industries)&&task.industries.length?task.industries:[task.industry];
    const plannedSearches=Math.max(1,(task.countries||[]).reduce((sum:number,country:string)=>sum+plannedDiscoveryScopeCount(country as Parameters<typeof plannedDiscoveryScopeCount>[0],taskIndustries,task.keywords||[]),0));
    const totalCheckpoints=Number(checkpointProgress?.total_count||0);
    const completedSearches=Number(checkpointProgress?.terminal_count||0);
    const completedFreshSearches=Number(checkpointProgress?.fresh_completed_count||0);
    const incrementalSkipped=Number(checkpointProgress?.skipped_recent_count||0);
    const concurrentlySkipped=Number(checkpointProgress?.skipped_active_count||0);
    const reusedSearches=Number(checkpointProgress?.reused_count||0);
    const activeCheckpoint=checkpointProgress&&["RUNNING","PAUSED"].includes(String(checkpointProgress.current_status))?checkpointProgress:null;
    const discoveryActive=Boolean(activeCheckpoint)||(["QUEUED","RUNNING","PAUSING","PAUSED"].includes(String(task.status))&&completedSearches<plannedSearches&&Number(task.discovered_count||0)===0);
    const stage=String(task.current_stage||"")|| (discoveryActive?"DISCOVERY":["QUEUED"].includes(String(task.status))?"WAITING":["RUNNING","PAUSING","PAUSED"].includes(String(task.status))?"VERIFYING":"FINISHED");
    const discoveryProgress={stage,stage_detail:task.current_stage_detail||null,total:plannedSearches,completed:task.status==="COMPLETED"?plannedSearches:Math.min(completedFreshSearches,plannedSearches),raw_hits:Number(checkpointProgress?.raw_hit_count||0),incremental_skipped:incrementalSkipped,concurrently_skipped:concurrentlySkipped,current_query:activeCheckpoint?.current_query||null,current_country:activeCheckpoint?.current_country||null,updated_at:activeCheckpoint?.current_updated_at||task.updated_at};
    const verificationTask=acquisitionChild.data;
    const verificationTotal=Number(verificationTask?.total_count||0);
    const verificationCompleted=Math.min(verificationTotal,Number(verificationTask?.processed_count||0)||Number(verificationTask?.success_count||0)+Number(verificationTask?.failed_count||0));
    const earlyProcessed=Math.max(0,Number(task.discovered_count||0)-verificationTotal);
    const verificationProgress=verificationTask?{status:verificationTask.status,total:verificationTotal,completed:verificationCompleted,pending:Math.max(0,Number(verificationTask.pending_count||0)),success:Number(verificationTask.success_count||0),failed:Number(verificationTask.failed_count||0),early_processed:earlyProcessed,updated_at:verificationTask.updated_at}:null;
    const traceRows=lightweight?{data:[],error:null}:await createAdminClient().from("ai_acquisition_candidates").select("source_query,decision,decision_reason,staging_customer_id,imported_customer_id").eq("task_id",id).limit(1000);
    if(traceRows.error) console.error("[ai-acquisition-task] optional search analytics unavailable", { task_id:id, code:traceRows.error.code });
    const traceCustomerIds=[...new Set((traceRows.data||[]).flatMap((row)=>[row.imported_customer_id,row.staging_customer_id]).filter(Boolean).map(String))];
    const customerStates=traceCustomerIds.length?await loadCustomerStates(traceCustomerIds):{data:[],error:null};
    if(customerStates.error) console.warn("[ai-acquisition-task] optional customer state analytics unavailable", { task_id:id, code:customerStates.error.code, message:customerStates.error.message });
    const metricCostRows:Array<{customer_id:string|null;provider:string;model_or_sku:string|null;operation:string|null;amount_usd:number;amount_type:string;quantity:number;input_tokens:number;output_tokens:number;metadata:Record<string,unknown>|null}>=[];
    if(canViewUsage&&!lightweight)for(let offset=0;;offset+=1000){const chunk=await createAdminClient().from("api_cost_ledger").select("customer_id,provider,model_or_sku,operation,amount_usd,amount_type,quantity,input_tokens,output_tokens,metadata").in("task_id",taskIds).range(offset,offset+999);if(chunk.error){console.error("[ai-acquisition-task] optional cost analytics unavailable", { task_id:id, code:chunk.error.code });break}metricCostRows.push(...(chunk.data||[]));if((chunk.data||[]).length<1000)break}
    const stateByCustomer=new Map((customerStates.data||[]).map((row)=>[String(row.id),row]));
    const queryByCustomer=new Map<string,string>();
    const stats=new Map<string,{query:string;candidates:number;duplicates:number;rejected:number;review:number;accepted:number;claimed:number;progressed:number;cost_usd:number}>();
    const metric=(query:string)=>{const key=query||"未记录检索表达";if(!stats.has(key))stats.set(key,{query:key,candidates:0,duplicates:0,rejected:0,review:0,accepted:0,claimed:0,progressed:0,cost_usd:0});return stats.get(key)!};
    for(const row of traceRows.data||[]){const item=metric(String(row.source_query||""));item.candidates+=1;if(row.decision==="DUPLICATE")item.duplicates+=1;else if(row.decision==="REJECTED")item.rejected+=1;else if(row.decision==="REVIEW")item.review+=1;else if(row.decision==="ACCEPTED")item.accepted+=1;const customerId=String(row.imported_customer_id||row.staging_customer_id||"");if(customerId){queryByCustomer.set(customerId,item.query);const state=stateByCustomer.get(customerId);if(state?.owner_id)item.claimed+=1;if(["FOLLOWING","QUOTE","DEAL"].includes(String(state?.status||"")))item.progressed+=1;}}
    for(const row of metricCostRows){const metadata=row.metadata&&typeof row.metadata==="object"?row.metadata as Record<string,unknown>:{};const query=row.provider==="GOOGLE_PLACES"?String(metadata.query||""):queryByCustomer.get(String(row.customer_id||""))||"";if(query&&isActuallyIncurredCost(row))metric(query).cost_usd+=Number(row.amount_usd||0);}
    const searchStats=[...stats.values()].sort((left,right)=>right.accepted-left.accepted||right.candidates-left.candidates||left.query.localeCompare(right.query));
    const usageData=usageSummary.data&&typeof usageSummary.data==="object"?usageSummary.data as Record<string,unknown>:{};
    const totalTokens=metricCostRows.reduce((sum,row)=>sum+Number(row.input_tokens||0)+Number(row.output_tokens||0),0);
    const reportCandidates=report?await createAdminClient().from("ai_acquisition_candidates").select("id,imported_customer_id,company_name,decision,ai_score,ai_level,country,matched_keywords").eq("task_id",id).eq("decision","ACCEPTED").order("ai_score",{ascending:false,nullsFirst:false}).limit(10):{data:[],error:null};
    if(reportCandidates.error) console.error("[ai-acquisition-task] optional report candidates unavailable", { task_id:id, code:reportCandidates.error.code });
    const actualCost=actualCostUsd(metricCostRows);
    const confirmedGoogleCost=actualCostUsd(metricCostRows.filter((row)=>row.provider==="GOOGLE_PLACES"));
    const skuTotals=new Map<string,{provider:string;model_or_sku:string;operation:string;calls:number;free_calls:number;quantity:number;amount_usd:number}>();
    for(const row of metricCostRows){const provider=String(row.provider||"未标记");const model=String(row.model_or_sku||"未标记");const operation=String(row.operation||"未标记");const key=`${provider}\u0000${model}\u0000${operation}`;const current=skuTotals.get(key)||{provider,model_or_sku:model,operation,calls:0,free_calls:0,quantity:0,amount_usd:0};current.calls+=1;current.free_calls+=row.amount_type==="FREE"?1:0;current.quantity+=Number(row.quantity||0);current.amount_usd+=isActuallyIncurredCost(row)?Number(row.amount_usd||0):0;skuTotals.set(key,current);}
    const localUsageSummary={total_calls:metricCostRows.length,free_calls:metricCostRows.filter((row)=>row.amount_type==="FREE").length,google_calls:metricCostRows.filter((row)=>row.provider==="GOOGLE_PLACES").length,openai_calls:metricCostRows.filter((row)=>row.provider==="OPENAI").length,sku_breakdown:[...skuTotals.values()].sort((left,right)=>right.amount_usd-left.amount_usd||right.calls-left.calls)};
    const decisions=["ACCEPTED","REVIEW","REJECTED","DUPLICATE","ANALYZING"] as const;
    const decisionCounts=await Promise.all(decisions.map(async(decisionName)=>{const result=await createAdminClient().from("ai_acquisition_candidates").select("id",{count:"exact",head:true}).eq("task_id",id).eq("decision",decisionName);if(result.error)throw result.error;return [decisionName,Number(result.count||0)] as const;}));
    const liveDecisionCounts=Object.fromEntries(decisionCounts) as Record<(typeof decisions)[number],number>;
    const liveDiscovered=Object.values(liveDecisionCounts).reduce((sum,count)=>sum+count,0);
    const liveTerminal=liveDecisionCounts.ACCEPTED+liveDecisionCounts.REVIEW+liveDecisionCounts.REJECTED+liveDecisionCounts.DUPLICATE;
    const liveTask={...task,discovered_count:liveDiscovered,processed_count:liveTerminal,accepted_count:liveDecisionCounts.ACCEPTED,review_count:liveDecisionCounts.REVIEW,rejected_count:liveDecisionCounts.REJECTED,duplicate_count:liveDecisionCounts.DUPLICATE};
    const reusedCandidates=(traceRows.data||[]).filter((row)=>String(row.decision_reason||"").startsWith("复用近14天历史核验结论")).length;
    const noNewSearchUnits=totalCheckpoints>0&&completedFreshSearches===0&&completedSearches===totalCheckpoints&&incrementalSkipped+concurrentlySkipped+reusedSearches>=totalCheckpoints;
    return NextResponse.json({ task: presentTask(liveTask), candidates: enrichedCandidates, count: candidates.count || 0, ...(lightweight?{}:{costs:costs.data||[],search_stats:searchStats,completion:{budget_limited:blockedPeriods.length>0,blocked_periods:blockedPeriods,incremental_skipped:incrementalSkipped,concurrently_skipped:concurrentlySkipped,reused_searches:reusedSearches,reused_candidates:reusedCandidates,no_new_search_units:noNewSearchUnits},usage_summary:{...usageData,...localUsageSummary,total_cost_usd:actualCost,actual_cost_usd:actualCost,google_actual_cost_usd:confirmedGoogleCost,total_tokens:totalTokens}}), ...(report?{report_candidates:reportCandidates.data||[]}:{}), discovery_progress:discoveryProgress, verification_progress:verificationProgress, can_view_evidence: hasPermission(account, "ai.acquisition.evidence.view"), can_view_usage: canViewUsage, can_control: hasPermission(account, "ai.acquisition.control") && (task.user_id === account.id || account.role === "ADMIN") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务详情加载失败";
    const publicMessage = message === "UNAUTHORIZED" ? "登录已失效，请重新登录"
      : message === "FORBIDDEN" ? "无权查看该AI获客任务"
        : message === "TASK_NOT_FOUND" ? "AI获客任务不存在或已删除"
          : "AI获客任务详情暂时无法加载，请稍后重试";
    if (!["UNAUTHORIZED", "FORBIDDEN", "TASK_NOT_FOUND"].includes(message)) {
      const detail=error&&typeof error==="object"?error as {code?:string;details?:string;hint?:string}:{};
      console.error("[ai-acquisition-task] detail load failed", { message, code:detail.code, details:detail.details, hint:detail.hint });
    }
    return NextResponse.json({ error: publicMessage }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "TASK_NOT_FOUND" ? 404 : 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.control");
    const { id } = await context.params;
    const task = await authorizedTask(id, account);
    if (task.user_id !== account.id && account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const action = String((await request.json()).action || "");
    const admin = createAdminClient();
    if (action === "CANCEL") {
      const result = await admin.from("ai_acquisition_tasks").update({ cancel_requested: true, status: ["QUEUED","PAUSED"].includes(task.status) ? "CANCELLED" : task.status, updated_at: new Date().toISOString() }).eq("id", id).in("status", ["QUEUED","RUNNING","PAUSING","PAUSED"]);
      if (result.error) throw result.error;
    } else if (action === "PAUSE") {
      const result = await admin.from("ai_acquisition_tasks").update({ status: "PAUSING", pause_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "RUNNING");
      if (result.error) throw result.error;
    } else if (action === "RESUME") {
      const maintenancePaused = String(task.current_stage_detail || "").includes("系统维护暂停");
      if (task.status !== "PAUSED" && !maintenancePaused) return NextResponse.json({ error: "只有已暂停任务可以恢复" }, { status: 409 });
      const child = await admin.from("ai_screening_tasks").select("id,status,active_executor,workflow_run_id,executor_heartbeat_at").eq("request_key", `acquisition:${id}`).maybeSingle();
      if (child.error) throw child.error;
      if (child.data) await requeueCorrectedEarlyRejections(task, String(child.data.id));
      const now = new Date();
      const heartbeatAt = task.executor_heartbeat_at ? new Date(task.executor_heartbeat_at).getTime() : NaN;
      const liveExecutor = task.active_executor === "VERCEL_WORKFLOW"
        && Boolean(task.workflow_run_id)
        && Number.isFinite(heartbeatAt)
        && now.getTime() - heartbeatAt < 120_000;
      const childHeartbeatAt = child.data?.executor_heartbeat_at ? new Date(child.data.executor_heartbeat_at).getTime() : NaN;
      const liveChildExecutor = child.data?.active_executor === "VERCEL_WORKFLOW"
        && Boolean(child.data.workflow_run_id)
        && Number.isFinite(childHeartbeatAt)
        && now.getTime() - childHeartbeatAt < 120_000;
      const pauseStarted = task.pause_started_at ? new Date(task.pause_started_at).getTime() : now.getTime();
      const pausedDuration = Number(task.paused_duration_ms || 0) + Math.max(0, now.getTime() - pauseStarted);
      if (child.data && !liveChildExecutor) {
        const resetLeases = await admin.from("ai_screening_task_items").update({
          status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", progress: 0,
          current_step: "WAITING_FOR_MANUAL_RESUME", pipeline_stage: "NORMALIZED", lease_owner: null,
          lease_token: null, lease_expires_at: null, executor_heartbeat_at: null, error_message: null,
          error_code: null, completed_at: null, updated_at: now.toISOString(),
        }).eq("task_id", child.data.id).eq("status", "RUNNING").neq("analysis_status", "COMPLETED");
        if (resetLeases.error) throw resetLeases.error;
        const resetChild = await admin.from("ai_screening_tasks").update({
          status: "QUEUED", cancel_requested: false, active_executor: null, workflow_run_id: null,
          last_dispatch_at: null, executor_heartbeat_at: null, error_message: null, finished_at: null,
          completed_at: null, updated_at: now.toISOString(),
        }).eq("id", child.data.id);
        if (resetChild.error) throw resetChild.error;
      }
      const result = await admin.from("ai_acquisition_tasks").update({
        status: "RUNNING", current_stage_detail: "用户已手动继续执行，正在从已保存检查点恢复",
        cancel_requested: false, started_at: now.toISOString(), pause_started_at: null,
        paused_duration_ms: pausedDuration, active_executor: liveExecutor ? task.active_executor : "VERCEL_DISPATCHING",
        workflow_run_id: liveExecutor ? task.workflow_run_id : null, last_dispatch_at: liveExecutor ? task.last_dispatch_at : now.toISOString(),
        executor_heartbeat_at: liveExecutor ? now.toISOString() : null, error_message: null, updated_at: now.toISOString(),
      }).eq("id", id).in("status", maintenancePaused ? ["PAUSED", "RUNNING"] : ["PAUSED"]).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "任务状态已变化，请刷新后重试" }, { status: 409 });
      if (liveExecutor) {
        const resumedChild = await admin.from("ai_screening_tasks").update({ status: "RUNNING", cancel_requested: false, updated_at: now.toISOString() }).eq("request_key", `acquisition:${id}`).in("status", ["QUEUED","PAUSING","PAUSED"]);
        if (resumedChild.error) throw resumedChild.error;
      } else {
        try {
          const run = await start(aiAcquisitionWorkflow, [id]);
          const dispatched = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", last_dispatch_at: now.toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("active_executor", "VERCEL_DISPATCHING");
          if (dispatched.error) throw dispatched.error;
        } catch (dispatchError) {
          await admin.from("ai_acquisition_tasks").update({
            status: "PAUSED", active_executor: null, workflow_run_id: null, last_dispatch_at: null,
            executor_heartbeat_at: null, current_stage_detail: "继续执行启动失败，任务仍保持暂停，可稍后重试",
            error_message: (dispatchError instanceof Error ? dispatchError.message : "继续执行启动失败").slice(0, 1000),
            updated_at: new Date().toISOString(),
          }).eq("id", id).eq("active_executor", "VERCEL_DISPATCHING");
          throw dispatchError;
        }
      }
    } else if (action === "REASSESS_REVIEWS") {
      if (!["COMPLETED", "FAILED"].includes(task.status)) return NextResponse.json({ error: "只有已完成或失败的任务可以重新核验待复核客户" }, { status: 409 });
      const child = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${id}`).maybeSingle();
      if (child.error) throw child.error;
      if (!child.data) return NextResponse.json({ error: "该任务没有可重新核验的记录" }, { status: 409 });
      const recovery = await requeueAcquisitionReviews(task, String(child.data.id));
      if (!recovery.requeued) return NextResponse.json({ error: "该任务没有待复核客户" }, { status: 409 });
      const now = new Date().toISOString();
      const resetChild = await admin.from("ai_screening_tasks").update({ status: "QUEUED", cancel_requested: false, error_message: null, completed_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: now }).eq("id", child.data.id);
      if (resetChild.error) throw resetChild.error;
      const resetTask = await admin.from("ai_acquisition_tasks").update({
        status: "QUEUED", current_stage: "VERIFYING", current_stage_detail: `正在重新分析、补证并评分 ${recovery.requeued} 条待复核客户`,
        cancel_requested: false, error_message: null, started_at: null, finished_at: null, active_executor: null,
        workflow_run_id: null, last_dispatch_at: now, executor_heartbeat_at: null, updated_at: now,
      }).eq("id", id).in("status", ["COMPLETED", "FAILED"]);
      if (resetTask.error) throw resetTask.error;
      const run = await start(aiAcquisitionWorkflow, [id]);
      const saved = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", updated_at: new Date().toISOString() }).eq("id", id);
      if (saved.error) throw saved.error;
      await admin.from("audit_logs").insert({ user_id: account.id, action: "AI_ACQUISITION_REVIEWS_REASSESSMENT_STARTED", target_type: "ai_acquisition_task", target_id: id, content: { task_number: task.task_number, old_scores_invalidated: true, quality_gate_bypassed: false, ...recovery } });
      return NextResponse.json({ ok: true, recovery });
    } else if (action === "RECHECK_EVIDENCE_GAPS") {
      if (task.status !== "COMPLETED") return NextResponse.json({ error: "只有已完成任务可以重新校验证据缺口" }, { status: 409 });
      const child = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${id}`).maybeSingle();
      if (child.error) throw child.error;
      if (!child.data) return NextResponse.json({ error: "该任务没有可恢复的核验记录" }, { status: 409 });
      const recovery = await requeueAcquisitionEvidenceGaps(task, String(child.data.id));
      if (!recovery.requeued) return NextResponse.json({ error: "没有发现需要重新校验的证据缺口" }, { status: 409 });
      const now = new Date().toISOString();
      const resetChild = await admin.from("ai_screening_tasks").update({ status: "QUEUED", cancel_requested: false, error_message: null, completed_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: now }).eq("id", child.data.id);
      if (resetChild.error) throw resetChild.error;
      const resetTask = await admin.from("ai_acquisition_tasks").update({ status: "QUEUED", current_stage: "VERIFYING", current_stage_detail: `正在重新校验 ${recovery.requeued} 条受Google详情预算降级影响的候选`, cancel_requested: false, error_message: null, started_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: now, executor_heartbeat_at: null, updated_at: now }).eq("id", id).eq("status", "COMPLETED");
      if (resetTask.error) throw resetTask.error;
      const run = await start(aiAcquisitionWorkflow, [id]);
      const saved = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", updated_at: new Date().toISOString() }).eq("id", id);
      if (saved.error) throw saved.error;
      await admin.from("audit_logs").insert({ user_id: account.id, action: "AI_ACQUISITION_EVIDENCE_GAPS_REQUEUED", target_type: "ai_acquisition_task", target_id: id, content: { task_number: task.task_number, ...recovery } });
      return NextResponse.json({ ok: true, recovery });
    } else if (action === "RETRY") {
      if (task.status !== "FAILED") return NextResponse.json({ error: "只有失败任务可以重试" }, { status: 409 });
      const child = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${id}`).maybeSingle();
      if (child.error) throw child.error;
      if (child.data) {
        const failedItems = await admin.from("ai_screening_task_items").select("id,status,analysis_status,writeback_status,result_id").eq("task_id", child.data.id).in("status", ["FAILED","RUNNING"]);
        if (failedItems.error) throw failedItems.error;
        const durableItemIds = (failedItems.data || [])
          .filter((row) => row.analysis_status === "COMPLETED" && row.writeback_status === "COMPLETED" && row.result_id)
          .map((row) => String(row.id));
        const itemIds = (failedItems.data || [])
          .filter((row) => !(row.analysis_status === "COMPLETED" && row.writeback_status === "COMPLETED" && row.result_id))
          .map((row) => String(row.id));
        if (durableItemIds.length) {
          const repaired = await admin.from("ai_screening_task_items").update({
            status: "COMPLETED", progress: 100, current_step: "COMPLETED", pipeline_stage: "COMPLETED",
            lease_owner: null, lease_token: null, lease_expires_at: null, executor_heartbeat_at: null,
            error_message: null, error_code: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).in("id", durableItemIds);
          if (repaired.error) throw repaired.error;
        }
        if (itemIds.length) {
          const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", itemIds);
          if (invalidated.error) throw invalidated.error;
          const resetItems = await admin.from("ai_screening_task_items").update({
            status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null,
            result_id: null, progress: 0, current_step: "WAITING", pipeline_stage: "NORMALIZED",
            lease_owner: null, lease_token: null, lease_expires_at: null, executor_heartbeat_at: null,
            started_at: null, retry_at: null, error_message: null, error_code: null, completed_at: null,
            updated_at: new Date().toISOString(),
          }).in("id", itemIds);
          if (resetItems.error) throw resetItems.error;
        }
        await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: child.data.id });
        const resetChild = await admin.from("ai_screening_tasks").update({ status: "QUEUED", cancel_requested: false, error_message: null, completed_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: null, executor_heartbeat_at: null, updated_at: new Date().toISOString() }).eq("id", child.data.id);
        if (resetChild.error) throw resetChild.error;
      }
      const now = new Date().toISOString();
      const resetTask = await admin.from("ai_acquisition_tasks").update({ status: "QUEUED", cancel_requested: false, error_message: null, started_at: null, finished_at: null, active_executor: null, workflow_run_id: null, last_dispatch_at: now, executor_heartbeat_at: null, updated_at: now }).eq("id", id).eq("status", "FAILED");
      if (resetTask.error) throw resetTask.error;
      const run = await start(aiAcquisitionWorkflow, [id]);
      const saved = await admin.from("ai_acquisition_tasks").update({ workflow_run_id: run.runId, active_executor: "VERCEL_WORKFLOW", updated_at: new Date().toISOString() }).eq("id", id);
      if (saved.error) throw saved.error;
    } else return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
    await admin.from("audit_logs").insert({ user_id: account.id, action: `AI_ACQUISITION_TASK_${action}`, target_type: "ai_acquisition_task", target_id: id, content: { task_number: task.task_number } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务操作失败";
    console.error("[ai-acquisition-task] control failed", error);
    const publicMessage = message === "UNAUTHORIZED" ? "登录已失效，请重新登录" : message === "FORBIDDEN" ? "无权操作该AI获客任务" : "任务操作失败，请稍后重试";
    return NextResponse.json({ error: publicMessage }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
