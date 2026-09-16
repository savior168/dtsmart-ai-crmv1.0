import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "workflow/api";
import { aiAcquisitionWorkflow } from "@/workflows/ai-acquisition";
import { localizedSearchTerms, type AcquisitionCountry } from "@/lib/ai-acquisition/config";
import { canReadAiOwner } from "@/lib/ai/owner-scope";

async function authorizedTask(id: string, account: Awaited<ReturnType<typeof requirePermission>>["account"]) {
  const result = await createAdminClient().from("ai_acquisition_tasks").select("*").eq("id", id).maybeSingle();
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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const { id } = await context.params;
    const task = await authorizedTask(id, account);
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const decision = request.nextUrl.searchParams.get("decision") || "";
    const search = (request.nextUrl.searchParams.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const country = request.nextUrl.searchParams.get("country") || "";
    const industry = request.nextUrl.searchParams.get("industry")?.trim() || "";
    const level = request.nextUrl.searchParams.get("level") || "";
    const readiness = request.nextUrl.searchParams.get("readiness") || "";
    const lightweight = request.nextUrl.searchParams.get("lightweight") === "1";
    const report = request.nextUrl.searchParams.get("report") === "1";
    let query = createAdminClient().from("ai_acquisition_candidates").select("*", { count: "exact" }).eq("task_id", id);
    if (decision) query = query.eq("decision", decision);
    if (search) query = query.or(`company_name.ilike.%${search}%,address.ilike.%${search}%`);
    if (country) query = query.eq("country", country);
    if (industry) {
      const [industryMatches,categoryMatches]=await Promise.all([
        createAdminClient().from("customers").select("id").eq("industry",industry).limit(5000),
        createAdminClient().from("customers").select("id").eq("category",industry).limit(5000),
      ]);
      if(industryMatches.error||categoryMatches.error)throw industryMatches.error||categoryMatches.error;
      const matchingCustomerIds=[...new Set([...(industryMatches.data||[]),...(categoryMatches.data||[])].map((row)=>String(row.id)))];
      query=matchingCustomerIds.length?query.or(`staging_customer_id.in.(${matchingCustomerIds.join(",")}),imported_customer_id.in.(${matchingCustomerIds.join(",")})`):query.eq("id","00000000-0000-0000-0000-000000000000");
    }
    if (["A","B","C","D"].includes(level)) query = query.eq("ai_level", level);
    if (readiness === "ACTIONABLE") query = query.eq("has_actionable_contact", true).eq("evidence_complete", true);
    if (readiness === "NO_CONTACT") query = query.eq("has_actionable_contact", false);
    if (readiness === "EVIDENCE_GAP") query = query.eq("evidence_complete", false);
    const candidates = await query.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (candidates.error) throw candidates.error;
    const candidateRows = candidates.data || [];
    const customerIds = [...new Set(candidateRows.flatMap((row) => [row.staging_customer_id, row.imported_customer_id]).filter(Boolean).map(String))];
    const [customerProfiles, verifiedContacts] = await Promise.all([
      customerIds.length
        ? createAdminClient().from("customers").select("id,industry,category,phone,whatsapp,email,website,google_url,facebook_url,instagram_url,linkedin_url,tiktok_url,other_public_urls,business_scope,company_scale_evidence,customer_value,followup_suggestion,acquisition_match_keywords").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      customerIds.length
        ? createAdminClient().from("customer_contacts").select("customer_id,type,value_raw,source_channel,exact_source_url,verification_status,contact_status,captured_at").in("customer_id", customerIds).in("verification_status", ["MATCHED_ORIGINAL","NEW_VERIFIED","SOURCE_CONFIRMED"]).not("exact_source_url", "is", null).order("captured_at", { ascending: false })
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
      return { ...row, customer_profile: profileById.get(customerId) || null, verified_contacts: contactsByCustomer.get(customerId) || [] };
    });
    const [screeningTaskRows, acquisitionChild] = await Promise.all([
      createAdminClient().from("ai_acquisition_candidates").select("screening_task_id").eq("task_id", id).not("screening_task_id", "is", null).limit(500),
      createAdminClient().from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${id}`).maybeSingle(),
    ]);
    if (screeningTaskRows.error || acquisitionChild.error) throw screeningTaskRows.error || acquisitionChild.error;
    const screeningIds = [...new Set([...(screeningTaskRows.data || []).map((row) => String(row.screening_task_id || "")),String(acquisitionChild.data?.id||"")].filter(Boolean))];
    const taskIds = [id, ...screeningIds];
    const canViewUsage = hasPermission(account, "ai.acquisition.usage.view");
    const discoveryCheckpoints = await createAdminClient().from("ai_acquisition_discovery_checkpoints").select("country,query_text,status,stop_reason,result_count,updated_at").eq("task_id",id).order("updated_at",{ascending:false});
    const [costs, usageSummary, budgetEvents] = canViewUsage ? await Promise.all([
      lightweight ? Promise.resolve({ data: [], error: null }) : createAdminClient().from("api_cost_ledger").select("provider,model_or_sku,operation,amount_usd,amount_type,quantity,input_tokens,output_tokens,occurred_at,metadata").in("task_id", taskIds).order("occurred_at", { ascending: false }).limit(200),
      createAdminClient().rpc("get_ai_acquisition_usage_summary", { p_task_id: id }),
      lightweight ? Promise.resolve({ data: [], error: null }) : createAdminClient().from("api_cost_budget_events").select("blocked_period").in("task_id", taskIds),
    ]) : [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }];
    if (costs.error || budgetEvents.error || discoveryCheckpoints.error) throw costs.error || budgetEvents.error || discoveryCheckpoints.error;
    if (usageSummary.error) throw usageSummary.error;
    const checkpoints=discoveryCheckpoints.data||[];
    const checkpointBlocks=checkpoints.filter((row)=>row.status==="BUDGET_LIMITED").map((row)=>String(row.stop_reason||"BUDGET"));
    const blockedPeriods=[...new Set([...(budgetEvents.data||[]).map((row)=>String(row.blocked_period||"")),...checkpointBlocks].filter(Boolean))];
    const industries=Array.isArray(task.industries)&&task.industries.length?task.industries:[task.industry].filter(Boolean);
    const plannedSearches=(task.countries||[]).reduce((total:number,code:string)=>total+localizedSearchTerms(code as AcquisitionCountry,industries,task.keywords||[]).length,0);
    const completedSearches=checkpoints.filter((row)=>["COMPLETED","BUDGET_LIMITED","SKIPPED_RECENT","SKIPPED_ACTIVE"].includes(String(row.status))).length;
    const incrementalSkipped=checkpoints.filter((row)=>row.status==="SKIPPED_RECENT").length;
    const concurrentlySkipped=checkpoints.filter((row)=>row.status==="SKIPPED_ACTIVE").length;
    const activeCheckpoint=checkpoints.find((row)=>["RUNNING","PAUSED"].includes(String(row.status)))||null;
    const discoveryActive=Boolean(activeCheckpoint)||(["QUEUED","RUNNING","PAUSING","PAUSED"].includes(String(task.status))&&completedSearches<plannedSearches&&Number(task.discovered_count||0)===0);
    const stage=String(task.current_stage||"")|| (discoveryActive?"DISCOVERY":["QUEUED"].includes(String(task.status))?"WAITING":["RUNNING","PAUSING","PAUSED"].includes(String(task.status))?"VERIFYING":"FINISHED");
    const discoveryProgress={stage,stage_detail:task.current_stage_detail||null,total:plannedSearches,completed:Math.min(completedSearches,plannedSearches),raw_hits:checkpoints.reduce((sum,row)=>sum+Number(row.result_count||0),0),incremental_skipped:incrementalSkipped,concurrently_skipped:concurrentlySkipped,current_query:activeCheckpoint?.query_text||null,current_country:activeCheckpoint?.country||null,updated_at:activeCheckpoint?.updated_at||task.updated_at};
    const traceRows=lightweight?{data:[],error:null}:await createAdminClient().from("ai_acquisition_candidates").select("source_query,decision,staging_customer_id,imported_customer_id").eq("task_id",id).limit(1000);
    if(traceRows.error)throw traceRows.error;
    const traceCustomerIds=[...new Set((traceRows.data||[]).flatMap((row)=>[row.imported_customer_id,row.staging_customer_id]).filter(Boolean).map(String))];
    const customerStates=traceCustomerIds.length?await createAdminClient().from("customers").select("id,owner_id,status").in("id",traceCustomerIds):{data:[],error:null};
    if(customerStates.error)throw customerStates.error;
    const metricCostRows:Array<{customer_id:string|null;provider:string;amount_usd:number;input_tokens:number;output_tokens:number;metadata:Record<string,unknown>|null}>=[];
    if(canViewUsage&&!lightweight)for(let offset=0;;offset+=1000){const chunk=await createAdminClient().from("api_cost_ledger").select("customer_id,provider,amount_usd,input_tokens,output_tokens,metadata").in("task_id",taskIds).range(offset,offset+999);if(chunk.error)throw chunk.error;metricCostRows.push(...(chunk.data||[]));if((chunk.data||[]).length<1000)break}
    const stateByCustomer=new Map((customerStates.data||[]).map((row)=>[String(row.id),row]));
    const queryByCustomer=new Map<string,string>();
    const stats=new Map<string,{query:string;candidates:number;duplicates:number;rejected:number;review:number;accepted:number;claimed:number;progressed:number;cost_usd:number}>();
    const metric=(query:string)=>{const key=query||"未记录检索表达";if(!stats.has(key))stats.set(key,{query:key,candidates:0,duplicates:0,rejected:0,review:0,accepted:0,claimed:0,progressed:0,cost_usd:0});return stats.get(key)!};
    for(const row of traceRows.data||[]){const item=metric(String(row.source_query||""));item.candidates+=1;if(row.decision==="DUPLICATE")item.duplicates+=1;else if(row.decision==="REJECTED")item.rejected+=1;else if(row.decision==="REVIEW")item.review+=1;else if(row.decision==="ACCEPTED")item.accepted+=1;const customerId=String(row.imported_customer_id||row.staging_customer_id||"");if(customerId){queryByCustomer.set(customerId,item.query);const state=stateByCustomer.get(customerId);if(state?.owner_id)item.claimed+=1;if(["FOLLOWING","QUOTE","DEAL"].includes(String(state?.status||"")))item.progressed+=1;}}
    for(const row of metricCostRows){const metadata=row.metadata&&typeof row.metadata==="object"?row.metadata as Record<string,unknown>:{};const query=row.provider==="GOOGLE_PLACES"?String(metadata.query||""):queryByCustomer.get(String(row.customer_id||""))||"";if(query)metric(query).cost_usd+=Number(row.amount_usd||0);}
    const searchStats=[...stats.values()].sort((left,right)=>right.accepted-left.accepted||right.candidates-left.candidates||left.query.localeCompare(right.query));
    const usageData=usageSummary.data&&typeof usageSummary.data==="object"?usageSummary.data as Record<string,unknown>:{};
    const totalTokens=metricCostRows.reduce((sum,row)=>sum+Number(row.input_tokens||0)+Number(row.output_tokens||0),0);
    const reportCandidates=report?await createAdminClient().from("ai_acquisition_candidates").select("id,imported_customer_id,company_name,decision,ai_score,ai_level,country,matched_keywords").eq("task_id",id).eq("decision","ACCEPTED").order("ai_score",{ascending:false,nullsFirst:false}).limit(10):{data:[],error:null};
    if(reportCandidates.error)throw reportCandidates.error;
    return NextResponse.json({ task: presentTask(task), candidates: enrichedCandidates, count: candidates.count || 0, ...(lightweight?{}:{costs:costs.data||[],search_stats:searchStats,completion:{budget_limited:blockedPeriods.length>0,blocked_periods:blockedPeriods,incremental_skipped:incrementalSkipped,concurrently_skipped:concurrentlySkipped,no_new_search_units:plannedSearches>0&&completedSearches>=plannedSearches&&checkpoints.every((row)=>["SKIPPED_RECENT","SKIPPED_ACTIVE"].includes(String(row.status)))}}), ...(report?{report_candidates:reportCandidates.data||[]}:{}), usage_summary:{...usageData,...(!lightweight?{total_tokens:totalTokens}:{})}, discovery_progress:discoveryProgress, can_view_evidence: hasPermission(account, "ai.acquisition.evidence.view"), can_view_usage: canViewUsage, can_control: hasPermission(account, "ai.acquisition.control") && (task.user_id === account.id || account.role === "ADMIN") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务详情加载失败";
    const publicMessage = message === "UNAUTHORIZED" ? "登录已失效，请重新登录"
      : message === "FORBIDDEN" ? "无权查看该AI获客任务"
        : message === "TASK_NOT_FOUND" ? "AI获客任务不存在或已删除"
          : "AI获客任务详情暂时无法加载，请稍后重试";
    if (!["UNAUTHORIZED", "FORBIDDEN", "TASK_NOT_FOUND"].includes(message)) console.error("[ai-acquisition-task] detail load failed", { message });
    return NextResponse.json({ error: publicMessage }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "TASK_NOT_FOUND" ? 404 : 400 });
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
      if (task.status !== "PAUSED") return NextResponse.json({ error: "只有已暂停任务可以恢复" }, { status: 409 });
      const now = new Date();
      const pauseStarted = task.pause_started_at ? new Date(task.pause_started_at).getTime() : now.getTime();
      const pausedDuration = Number(task.paused_duration_ms || 0) + Math.max(0, now.getTime() - pauseStarted);
      const result = await admin.from("ai_acquisition_tasks").update({ status: "RUNNING", started_at: now.toISOString(), pause_started_at: null, paused_duration_ms: pausedDuration, executor_heartbeat_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", id).eq("status", "PAUSED");
      if (result.error) throw result.error;
      await admin.from("ai_screening_tasks").update({ status: "RUNNING", updated_at: now.toISOString() }).eq("request_key", `acquisition:${id}`).in("status", ["PAUSING","PAUSED"]);
    } else if (action === "RETRY") {
      if (task.status !== "FAILED") return NextResponse.json({ error: "只有失败任务可以重试" }, { status: 409 });
      const child = await admin.from("ai_screening_tasks").select("id").eq("request_key", `acquisition:${id}`).maybeSingle();
      if (child.error) throw child.error;
      if (child.data) {
        const failedItems = await admin.from("ai_screening_task_items").select("id").eq("task_id", child.data.id).in("status", ["FAILED","RUNNING"]);
        if (failedItems.error) throw failedItems.error;
        const itemIds = (failedItems.data || []).map((row) => String(row.id));
        if (itemIds.length) {
          const invalidated = await admin.from("ai_screening_results").update({ is_latest_valid: false }).in("task_item_id", itemIds);
          if (invalidated.error) throw invalidated.error;
          const resetItems = await admin.from("ai_screening_task_items").update({ status: "PENDING", analysis_status: "PENDING", writeback_status: "PENDING", automation_status: null, result_id: null, progress: 0, current_step: "WAITING", error_message: null, error_code: null, completed_at: null, updated_at: new Date().toISOString() }).in("id", itemIds);
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
