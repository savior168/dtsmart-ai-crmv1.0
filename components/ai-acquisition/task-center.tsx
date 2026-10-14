"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck2, Check, ChevronDown, CircleHelp, LoaderCircle, Plus, RefreshCw, Search, Settings2, TriangleAlert, UserRoundPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CostModeBadge,
  ConfirmDialog,
  ErrorState,
  Loading,
  PageHeader,
  Pagination,
  StatusBadge,
  button,
  effectiveElapsedMs,
  formatCost,
  formatDuration,
  formatNumber,
  formatTokens,
  input,
  panel,
  primaryButton,
  taskDetailButton,
  useToast,
} from "@/components/ai-screening/ui";
import type { AcquisitionTask } from "./types";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { UserScopeSelect } from "@/components/user-scope-select";
import { SearchableMultiSelectFilter, type SearchableFilterOption } from "@/components/ui/searchable-multi-select-filter";
import { TodayUsageLink } from "@/components/ai-usage/today-usage-link";
import { AppDialog } from "@/components/ui/app-dialog";
import { acquisitionErrorMessageZh, acquisitionFailureStage } from "@/lib/ai-acquisition/presentation";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";
import { countryInfo } from "@/lib/countries";
import { CountryLabel } from "@/components/country-label";

const COUNTRY_NAMES = { of: (value: string) => countryInfo(value).name };
type OutOfPoolCustomer = { id:string; company_name:string; reason:string; acquisition_scope:string|null; pool_status:string|null };
type TaskSummary = { tasks:number; active_tasks:number; completed_tasks:number; today_accepted:number; accepted:number; accepted_by_task:Record<string,number>; historical_accepted:number; removed_results:number; repeated_results:number; unique_linked_customers:number; out_of_pool_customers:number; out_of_pool_details:OutOfPoolCustomer[]; current_customers:number; available_customers:number; claimed_customers:number; review:number; review_by_task:Record<string,number>; failed_tasks:number };
const poolStatusLabels:Record<string,string> = { AVAILABLE:"可认领", CLAIMED:"已认领", PENDING_ALLOCATION:"待管理员分配", INVALID:"无效" };
type SummaryMetric = "" | "active" | "completed" | "today_accepted" | "accepted" | "review" | "failed";
type CostOverview = { todayCalls:number; todayCost:number; totalCost:number; accepted:number; processed:number; openaiCost:number; googleActualCost:number; googleCalls:number; freeCalls:number };
type GoogleSkuUsage = { key:string; label:string; usageCount:number; acquisitionSystemUsage:number; acquisitionSystemCostUsd:number; screeningSystemUsage:number; screeningSystemCostUsd:number; pendingSystemUsage:number; projectedUsage:number; freeLimit:number|null; projectedRemaining:number|null; projectedOverageCalls:number; projectedOverageCostUsd:number };
type GoogleBilling = { state:"NOT_CONFIGURED"|"CONNECTED"|"NO_DATA"|"ERROR"; message:string; skuUsage?:GoogleSkuUsage[] };
type AcquisitionAction = "PAUSE" | "RESUME" | "CANCEL" | "RETRY" | "RECHECK_EVIDENCE_GAPS";

const actionCopy:Record<AcquisitionAction,{title:string;description:string;confirm:string}> = {
  PAUSE:{title:"暂停AI获客任务？",description:"系统将在当前安全节点停止新的调用并保存执行进度；恢复后从检查点继续，不重复已完成的检索与核验。",confirm:"确认暂停"},
  RESUME:{title:"恢复AI获客任务？",description:"任务将从上次保存的检查点继续，仅执行未完成步骤，不重复采集已处理客户。",confirm:"确认恢复"},
  CANCEL:{title:"取消AI获客任务？",description:"任务将停止后续采集和核验；已产生的客户、公开来源、执行记录与费用台账会继续保留。",confirm:"确认取消"},
  RETRY:{title:"从检查点重试任务？",description:"只恢复失败或中断的步骤，保留已处理候选和原始发现依据，避免重复调用与重复入池。",confirm:"确认重试"},
  RECHECK_EVIDENCE_GAPS:{title:"重新校验证据缺口？",description:"只重新核验因Google详情预算降级而缺少主体锚点的候选；不重复搜索，不改动已正确入池、重复或人工复核结果。",confirm:"开始重新校验"},
};

function taskControl(status:string) {
  if(status==="RUNNING") return {action:"PAUSE" as const,label:"暂停任务",tone:"warning" as const};
  if(status==="PAUSED") return {action:"RESUME" as const,label:"恢复任务",tone:"default" as const};
  if(status==="FAILED") return {action:"RETRY" as const,label:"从检查点重试",tone:"default" as const};
  return null;
}

export function AcquisitionTaskCenter({ canCreate, canViewUsage, canManageSettings, canViewGoogleBilling, canControl }:{ canCreate:boolean; canViewUsage:boolean; canManageSettings:boolean; canViewGoogleBilling:boolean; canControl:boolean }) {
  const router=useRouter();
  const [tasks, setTasks] = useState<AcquisitionTask[]>([]),
    [count, setCount] = useState(0),
    [summary, setSummary] = useState<TaskSummary | null>(null),
    [summaryLoading, setSummaryLoading] = useState(true),
    [summaryError, setSummaryError] = useState(""),
    [pageUsageError, setPageUsageError] = useState(false),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(30),
    [status, setStatus] = useState(""),
    [metric, setMetric] = useState<SummaryMetric>(""),
    [industries, setIndustries] = useState<string[]>([]),
    [countries, setCountries] = useState<string[]>([]),
    [filterOptions, setFilterOptions] = useState<{countries:SearchableFilterOption[];industries:SearchableFilterOption[]}>({countries:[],industries:[]}),
    [costMode, setCostMode] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [costOverview, setCostOverview] = useState<CostOverview | null>(null),
    [costOverviewLoading, setCostOverviewLoading] = useState(canViewUsage),
    [costOverviewError, setCostOverviewError] = useState(""),
    [costRetry, setCostRetry] = useState(0),
    [costSummaryOpen, setCostSummaryOpen] = useState(false),
    [googleDetailsOpen, setGoogleDetailsOpen] = useState(false),
    [googleBilling, setGoogleBilling] = useState<GoogleBilling | null>(null),
    [googleBillingLoading, setGoogleBillingLoading] = useState(false),
    [outOfPoolOpen, setOutOfPoolOpen] = useState(false),
    [outOfPoolPage, setOutOfPoolPage] = useState(1),
    [outOfPoolPageSize, setOutOfPoolPageSize] = useState(20),
    [showOwner, setShowOwner] = useState(false),
    [scopeUserId, setScopeUserId] = useState(""),
    [pendingAction, setPendingAction] = useState<{task:AcquisitionTask;action:AcquisitionAction}|null>(null),
    [actionBusy, setActionBusy] = useState(false);
  const {toast,node:toastNode}=useToast();
  const loadRequestRef=useRef(0);
  const loadControllerRef=useRef<AbortController|null>(null);
  const costLoadedScopeRef=useRef<string|null>(null);
  const summaryScopeRef=useRef<string|null>(null);
  const tasksRef=useRef(tasks);
  useEffect(()=>{tasksRef.current=tasks},[tasks]);
  const taskParams=useCallback(()=>{
    const p = new URLSearchParams({page:String(page),pageSize:String(pageSize)});
    if (scopeUserId) p.set("user_id", scopeUserId);
    if (status) p.set("status", status);
    if (metric) p.set("metric", metric);
    if (search) p.set("search", search);
    for (const industry of industries) p.append("industry", industry);
    for (const country of countries) p.append("country", country);
    if (costMode) p.set("cost_mode", costMode);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  },[page,pageSize,scopeUserId,status,metric,search,industries,countries,costMode,from,to]);
  const load = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller=new AbortController();
    loadControllerRef.current=controller;
    const requestId=++loadRequestRef.current;
    setLoading(true);
    setError("");
    setPageUsageError(false);
    try {
      const p = taskParams();
      const summaryScope=JSON.stringify({scopeUserId,costMode,countries,industries,from,to,search});
      const refreshSummary=summaryScopeRef.current!==summaryScope;
      setSummaryLoading(true);
      setSummaryError("");
      if(refreshSummary){
        summaryScopeRef.current=summaryScope;
        setSummary(null);
      }
      const coreParams = new URLSearchParams(p);
      coreParams.set("core", "1");
      // Independent metrics must not wait for the task list or each other.
      const backgroundRequests:Promise<void>[]=[];
      backgroundRequests.push((async()=>{
        try {
          const summaryParams=new URLSearchParams(p);
          summaryParams.set("mode","summary");
          const response=await fetch(`/api/ai-acquisition/tasks?${summaryParams}`,{cache:"no-store",signal:controller.signal});
          const body=await response.json().catch(()=>({}));
          if (!response.ok || !body.summary) throw new Error(body.error||"获客统计加载失败");
          if(requestId===loadRequestRef.current)setSummary(body.summary);
        } catch (caught) {
          if(requestId===loadRequestRef.current&&!controller.signal.aborted)setSummaryError(caught instanceof Error?caught.message:"获客统计加载失败");
        } finally {
          if(requestId===loadRequestRef.current&&!controller.signal.aborted)setSummaryLoading(false);
        }
      })());
      let pageResolved=false;
      backgroundRequests.push((async()=>{
        try {
          const pageParams=new URLSearchParams(p);
          pageParams.set("mode","page");
          const response=await fetch(`/api/ai-acquisition/tasks?${pageParams}`,{cache:"no-store",signal:controller.signal});
          const body=await response.json().catch(()=>({}));
          if(requestId===loadRequestRef.current){
            if(response.ok&&Array.isArray(body.data)){pageResolved=true;setTasks(body.data)}
            setPageUsageError(!response.ok||Boolean(body.usage_error));
          }
        } catch { if(requestId===loadRequestRef.current&&!controller.signal.aborted)setPageUsageError(true); }
      })());
      backgroundRequests.push((async()=>{
        try {
          const filterParams=new URLSearchParams(p);
          filterParams.set("mode","filters");
          const response=await fetch(`/api/ai-acquisition/tasks?${filterParams}`,{cache:"no-store",signal:controller.signal});
          const body=await response.json().catch(()=>({}));
          if(response.ok&&requestId===loadRequestRef.current&&body.filter_options)setFilterOptions(body.filter_options);
        } catch { /* Existing selections remain available after a facet error. */ }
      })());
      void Promise.all(backgroundRequests);
      const r = await fetch(`/api/ai-acquisition/tasks?${coreParams}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const b = await r.json();
      if(requestId!==loadRequestRef.current)return;
      if (!r.ok) throw new Error(b.error || "加载失败");
      if(!pageResolved)setTasks(b.data || []);
      setCount(b.count || 0);
      setShowOwner(Boolean(b.show_owner));
    } catch (e) {
      if(requestId===loadRequestRef.current&&!controller.signal.aborted){
        setError(e instanceof Error ? e.message : "加载失败");
      }
    } finally {
      if(requestId===loadRequestRef.current&&!controller.signal.aborted)setLoading(false);
    }
  }, [taskParams, scopeUserId, costMode, countries, industries, from, to, search]);
  useEffect(() => {
    void load();
    return () => loadControllerRef.current?.abort();
  }, [load]);
  useEffect(() => {
    let active=true;
    let inFlight=false;
    let controller:AbortController|null=null;
    const refresh=async()=>{
      if(!active||inFlight||loading||document.visibilityState!=="visible")return;
      inFlight=true;
      controller=new AbortController();
      const timeout=window.setTimeout(()=>controller?.abort(),12000);
      const requestId=loadRequestRef.current;
      const p=taskParams();
      p.set("core","1");
      try{
        const response=await fetch(`/api/ai-acquisition/tasks?${p}`,{cache:"no-store",signal:controller.signal});
        const body=await response.json().catch(()=>({}));
        if(!active||requestId!==loadRequestRef.current||!response.ok||!Array.isArray(body.data))return;
        const previous=new Map(tasksRef.current.map((task)=>[task.id,task.status]));
        const changed=body.data.some((task:AcquisitionTask)=>previous.has(task.id)&&previous.get(task.id)!==task.status);
        setTasks(body.data.map((task:AcquisitionTask)=>{
          const prior=tasksRef.current.find((item)=>item.id===task.id);
          return prior?{...task,usage:prior.usage,search_completed_count:prior.search_completed_count,search_raw_hits:prior.search_raw_hits}:task;
        }));
        setCount(Number(body.count||0));
        setError("");
        if(changed){
          const summaryParams=taskParams();
          summaryParams.set("mode","summary");
          const summaryResponse=await fetch(`/api/ai-acquisition/tasks?${summaryParams}`,{cache:"no-store",signal:controller.signal});
          const summaryBody=await summaryResponse.json().catch(()=>({}));
          if(active&&requestId===loadRequestRef.current&&summaryResponse.ok&&summaryBody.summary)setSummary(summaryBody.summary);
        }
      }catch{/* Keep the last verified state; the next poll or manual refresh retries. */}
      finally{window.clearTimeout(timeout);inFlight=false;controller=null}
    };
    const timer=window.setInterval(()=>void refresh(),15000);
    const onVisible=()=>{if(document.visibilityState==="visible")void refresh()};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{active=false;controller?.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisible)};
  },[taskParams,loading]);
  useEffect(() => {
    // Fetch once per owner scope on entry, independently of the task summary
    // and the collapsed detail panel.
    if (!canViewUsage || costLoadedScopeRef.current===scopeUserId) return;
    costLoadedScopeRef.current=scopeUserId;
    let active = true;
    let settled = false;
    setCostOverview(null);
    setCostOverviewLoading(true);
    setCostOverviewError("");
    const historyParams = new URLSearchParams({ all_time:"1", overview:"1", page:"1", pageSize:"10" });
    if (scopeUserId) historyParams.set("user_id", scopeUserId);
    void (async()=>{
      const historyResponse=await fetch(`/api/ai-acquisition/usage?${historyParams}`, { cache:"no-store" });
      const historyBody=await historyResponse.json().catch(()=>({}));
      if (!historyResponse.ok) throw new Error(historyBody.error||"获客成本数据加载失败");
      if (!active) return;
      setCostOverview({
        todayCalls:Number(historyBody.today_summary?.calls||0),
        todayCost:Number(historyBody.today_summary?.total_cost_usd||0),
        totalCost:Number(historyBody.summary?.total_cost_usd||0),
        accepted:Number(historyBody.summary?.accepted||0),
        processed:Number(historyBody.summary?.processed||0),
        openaiCost:Number(historyBody.summary?.openai_cost_usd||0),
        googleActualCost:Number(historyBody.summary?.google_cost_usd||0),
        googleCalls:Number(historyBody.summary?.google_calls||0),
        freeCalls:Number(historyBody.summary?.google_free_calls||0),
      });
    })().catch((caught)=>{if(active)setCostOverviewError(caught instanceof Error?caught.message:"获客成本数据加载失败")}).finally(()=>{settled=true;if(active)setCostOverviewLoading(false)});
    return ()=>{active=false;if(!settled&&costLoadedScopeRef.current===scopeUserId)costLoadedScopeRef.current=null};
  }, [canViewUsage, scopeUserId, costRetry]);
  const refreshAll=()=>{
    costLoadedScopeRef.current=null;
    summaryScopeRef.current=null;
    setCostRetry(value=>value+1);
    void load();
  };
  async function openGoogleDetails() {
    setGoogleDetailsOpen(true);
    if (googleBilling || googleBillingLoading) return;
    setGoogleBillingLoading(true);
    try {
      const response = await fetch("/api/cost-center/google-billing", { cache:"no-store" });
      const body = await response.json().catch(()=>({}));
      setGoogleBilling(response.ok ? body : { state:"ERROR", message:body.error||"Google Places 明细读取失败" });
    } catch {
      setGoogleBilling({ state:"ERROR", message:"Google Places 明细读取失败，请稍后重试" });
    } finally {
      setGoogleBillingLoading(false);
    }
  }
  async function runAction(){
    if(!pendingAction)return;
    setActionBusy(true);
    try{
      const response=await fetch(`/api/ai-acquisition/tasks/${pendingAction.task.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:pendingAction.action})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"任务操作失败");
      toast({PAUSE:"任务正在安全暂停",RESUME:"任务已从检查点恢复",CANCEL:"任务已取消，历史结果与费用已保留",RETRY:"任务已从检查点重新排队",RECHECK_EVIDENCE_GAPS:"证据缺口已重新进入核验，不会重复搜索"}[pendingAction.action]);
      setPendingAction(null);
      refreshAll();
    }catch(actionError){
      toast(actionError instanceof Error?actionError.message:"任务操作失败","error");
    }finally{setActionBusy(false)}
  }
  const resultScopeParams = new URLSearchParams();
  if (scopeUserId) resultScopeParams.set("user_id", scopeUserId);
  if (costMode) resultScopeParams.set("task_cost_mode", costMode);
  if (search) resultScopeParams.set("task_search", search);
  if (from) resultScopeParams.set("task_from", from);
  if (to) resultScopeParams.set("task_to", to);
  for (const country of countries) resultScopeParams.append("task_country", country);
  for (const industry of industries) resultScopeParams.append("task_industry", industry);
  const resultScopeQuery = resultScopeParams.toString();
  const ownerQuery = scopeUserId ? `&user_id=${encodeURIComponent(scopeUserId)}` : "";
  const outOfPoolDetails = summary?.out_of_pool_details || [];
  const visibleOutOfPoolDetails = outOfPoolDetails.slice((outOfPoolPage - 1) * outOfPoolPageSize, outOfPoolPage * outOfPoolPageSize);
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title="AI获客任务中心"
        description="发现、核验并沉淀可直接跟进的目标客户；每条结果均保留来源、判断依据和成本记录。"
        actions={
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            {canViewUsage ? <TodayUsageLink module="acquisition"/> : null}
            {canManageSettings ? <Link href="/ai-acquisition/settings" className={`${button} shrink-0`}><Settings2 size={16}/>AI获客设置</Link> : null}
            {canCreate ? (
              <Link href="/ai-acquisition/new" className={`${primaryButton} shrink-0`}>
                <Plus size={17} />
                创建AI获客任务
              </Link>
            ) : null}
          </div>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {[
          { key:"today_accepted" as const, label:"今日获客", value:summary?.today_accepted, note:"今日核验通过并成功入池", icon:CalendarCheck2, tone:"bg-blue-50 text-blue-700" },
          { key:"accepted" as const, label:"有效入池结果", value:summary?.accepted, note:`当前有关联；历史累计 ${summary?formatNumber(summary.historical_accepted):"—"}`, icon:UserRoundPlus, tone:"bg-emerald-50 text-emerald-700" },
          { key:"review" as const, label:"待人工复核", value:summary?.review, note:"需核对证据后处理", icon:CircleHelp, tone:"bg-amber-50 text-amber-700" },
          { key:"active" as const, label:"进行中", value:summary?.active_tasks, note:"排队、执行或暂停处理中", icon:LoaderCircle, tone:"bg-violet-50 text-violet-700" },
          { key:"completed" as const, label:"已完成任务", value:summary?.completed_tasks, note:"已完成全部处理流程", icon:Check, tone:"bg-cyan-50 text-cyan-700" },
          { key:"failed" as const, label:"异常任务", value:summary?.failed_tasks, note:"需要检查或重试", icon:TriangleAlert, tone:"bg-rose-50 text-rose-700" },
        ].map((item)=>{
          const customerScope=item.key==="today_accepted"?"today":item.key==="accepted"?"accepted":item.key==="review"?"review":null;
          const className=`${panel} relative flex min-w-0 items-center gap-3 p-[15px] text-left transition hover:-translate-y-0.5 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 ${!customerScope&&metric===item.key?"border-blue-400 ring-1 ring-blue-100":""}`;
          const content=<><span className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] ${item.tone}`}><item.icon size={20}/></span><span className="min-w-0"><span className="block truncate text-sm text-[#6f7b8f]">{item.label}</span><b className="mt-[3px] block text-2xl font-semibold" aria-busy={summaryLoading}>{summary?Number(item.value||0).toLocaleString("zh-CN"):summaryLoading?<span className="block h-7 w-16 animate-pulse rounded bg-slate-100" aria-label="正在加载"/>:"—"}</b><small className="block truncate text-[#8b96a7]" title={`${item.note}；点击查看对应${customerScope?"客户":"任务"}`}>{item.note}</small></span><span aria-hidden="true" className="absolute right-4 text-xl text-slate-400">›</span></>;
          return customerScope?<Link key={item.label} href={`/ai-acquisition/customers?scope=${customerScope}${resultScopeQuery?`&${resultScopeQuery}`:""}`} className={className}>{content}</Link>:<button type="button" key={item.label} aria-pressed={metric===item.key} onClick={()=>{setMetric(item.key);setStatus("");setPage(1)}} className={className}>{content}</button>;
        })}
      </section>
      {summaryError?<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>获客统计暂不可用：{summaryError}。下方任务列表仍可查看。</span><button type="button" className="font-medium underline" onClick={()=>void load()}>重试统计</button></div>:null}
      <section className={`${panel} flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-xs text-slate-600`} aria-label="AI获客关联客户统计">
        <b className="cursor-help text-slate-800" title="统计口径：仅统计获客任务关联客户，不代表全系统公海库存。历史入池结果、历史结果差额、仍关联客户的结果、重复关联记录、获客关联的当前公海客户、已关联但不在当前公海、获客关联待认领、获客关联已认领均按当前筛选计算。">关联公海统计 <CircleHelp size={13} className="inline align-[-2px] text-slate-400"/></b>
        <span title={`当前仍关联客户的入池结果 ${summary?formatNumber(summary.accepted):"—"} 条，减去重复关联记录 ${summary?formatNumber(summary.repeated_results):"—"} 条，再减去不在公海的客户 ${summary?formatNumber(summary.out_of_pool_customers):"—"} 位。`}>当前公海客户 <b>{summary?formatNumber(summary.current_customers):"—"}</b></span>
        <span title="当前筛选范围内获客任务关联、且公海状态为可认领的客户；并非全系统待认领总数。">待认领 <b>{summary?formatNumber(summary.available_customers):"—"}</b></span>
        <span title="当前筛选范围内获客任务关联、且公海状态为已认领的客户。">已认领 <b>{summary?formatNumber(summary.claimed_customers):"—"}</b></span>
        <button type="button" disabled={!summary} onClick={()=>{setOutOfPoolPage(1);setOutOfPoolOpen(true)}} title="仍有关联入池结果，但客户不在当前公海；点击查看逐项原因。" className="font-medium text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline">不在公海 {summary?formatNumber(summary.out_of_pool_customers):"—"} · 查看</button>
      </section>
      {outOfPoolOpen?<AppDialog title="已关联但不在当前公海的客户" description="按当前任务筛选范围统计：这些客户有成功入池结果关联，但客户资料不存在，或当前状态不是可认领／已认领的公海客户；不会计入当前公海唯一客户。" onClose={()=>setOutOfPoolOpen(false)} width="max-w-4xl">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["客户名称","客户ID","不在当前公海的原因","当前公海状态"].map((label)=><th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{visibleOutOfPoolDetails.map((row)=><tr key={row.id} className="border-t"><td className="px-3 py-3 font-medium text-slate-800">{row.company_name}</td><td className="px-3 py-3 font-mono text-xs text-slate-500">{row.id}</td><td className="px-3 py-3 text-amber-700">{row.reason}</td><td className="px-3 py-3 text-slate-500">{row.pool_status?poolStatusLabels[row.pool_status]||"其他状态":"—"}</td></tr>)}</tbody></table>{!outOfPoolDetails.length?<p className="p-8 text-center text-sm text-slate-500">当前筛选范围没有此类客户</p>:null}</div><Pagination page={outOfPoolPage} pageSize={outOfPoolPageSize} total={outOfPoolDetails.length} onPage={setOutOfPoolPage} onPageSize={(size)=>{setOutOfPoolPageSize(size);setOutOfPoolPage(1)}} itemLabel="位客户"/>
      </AppDialog>:null}
      {toastNode}
      <ConfirmDialog open={Boolean(pendingAction)} title={pendingAction?actionCopy[pendingAction.action].title:"任务操作确认"} description={pendingAction?actionCopy[pendingAction.action].description:""} confirmLabel={pendingAction?actionCopy[pendingAction.action].confirm:"确认"} busy={actionBusy} onClose={()=>!actionBusy&&setPendingAction(null)} onConfirm={()=>void runAction()}/>
      {canViewUsage ? <section className={`${panel} overflow-hidden`}>
        <button type="button" aria-expanded={costSummaryOpen} aria-controls="acquisition-cost-summary" onClick={()=>setCostSummaryOpen(open=>!open)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50">
          <span className="min-w-0"><b className="block font-semibold">获客成效与实际成本</b>{costOverviewLoading?<span className="mt-2 block h-3 w-48 animate-pulse rounded bg-slate-100" aria-label="正在加载费用"/>:<span className="mt-1 block truncate text-xs text-slate-500">{costOverviewError?"费用统计暂不可用":`今日实际 ${costOverview?formatCost(costOverview.todayCost):"—"} · 历史实际 ${costOverview?formatCost(costOverview.totalCost):"—"} · 历史入池率 ${costOverview&&costOverview.processed?`${(costOverview.accepted/costOverview.processed*100).toFixed(1)}%`:"—"}`}</span>}</span>
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-blue-600">{costSummaryOpen?"收起":"查看成效与成本"}<ChevronDown size={16} className={`transition ${costSummaryOpen?"rotate-180":""}`}/></span>
        </button>
        {costSummaryOpen?<div id="acquisition-cost-summary" className="border-t p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">实际费用仅包含OpenAI已完成调用与Google平台已确认金额；Google价目估算、共享免费额度和预计超额费用不计入实际费用。</p>{canViewGoogleBilling?<button type="button" onClick={()=>void openGoogleDetails()} className="text-xs font-medium text-blue-600 hover:underline">查看Google调用与账号额度</button>:null}</div>{costOverviewLoading?<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">正在汇总真实调用、费用与入池数据…</p>:costOverviewError?<div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span>{costOverviewError}</span><button type="button" className="font-medium underline" onClick={()=>{costLoadedScopeRef.current=null;setCostRetry(value=>value+1)}}>重新加载</button></div>:<><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/ai-usage?business_type=acquisition" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"><small className="flex items-center justify-between text-slate-500"><span>今日实际费用</span><span className="text-blue-600">查看今日明细</span></small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.todayCost):"—"}</b><span className="text-xs text-slate-400">今日 {costOverview?formatNumber(costOverview.todayCalls):"—"} 次API调用</span></Link>
          <Link href="/ai-usage?business_type=acquisition" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"><small className="flex items-center justify-between text-slate-500"><span>历史累计实际费用</span><span className="text-blue-600">查看用量明细</span></small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.totalCost):"—"}</b><span className="text-xs text-slate-400">OpenAI {costOverview?formatCost(costOverview.openaiCost):"—"} · Google已确认 {costOverview?formatCost(costOverview.googleActualCost):"—"}</span></Link>
          <Link href={`/ai-acquisition/customers?scope=accepted${ownerQuery}`} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"><small className="flex items-center justify-between text-slate-500"><span>平均入池客户实际成本</span><span className="text-blue-600">查看入池客户</span></small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.accepted?costOverview.totalCost/costOverview.accepted:0):"—"}</b><span className="text-xs text-slate-400">历史实际费用 ÷ {costOverview?formatNumber(costOverview.accepted):"—"} 位成功入池客户</span></Link>
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><small className="text-slate-500">历史核验入池率</small><b className="mt-1 block text-xl">{costOverview&&costOverview.processed?`${(costOverview.accepted/costOverview.processed*100).toFixed(1)}%`:"—"}</b><span className="text-xs text-slate-400">成功入池 {costOverview?formatNumber(costOverview.accepted):"—"} ÷ 已核验 {costOverview?formatNumber(costOverview.processed):"—"}</span></article>
        </div><p className="mt-3 text-xs text-slate-400">历史Google Places调用 {costOverview?formatNumber(costOverview.googleCalls):"—"} 次，其中系统记录免费调用 {costOverview?formatNumber(costOverview.freeCalls):"—"} 次；详细额度以Google结算账号为准。</p></>}</div>:null}
      </section> : null}
      <section className={`${panel} overflow-hidden`}>
        <div className="border-b border-slate-100 px-5 pt-5">
          <h2 className="text-lg font-semibold">AI获客任务</h2>
          <p className="mt-1 pb-4 text-sm text-slate-500">集中查看获客进度、客户核验结果、目标范围、调用用量与实际费用；点击关键结果可直接进入对应明细。</p>
        </div>
        <form
          className="space-y-3 border-b p-[14px_16px]"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(draft.trim());
          }}
        >
          <div className={`grid gap-3 md:grid-cols-2 ${showOwner ? "xl:grid-cols-[minmax(230px,1.5fr)_repeat(5,minmax(145px,1fr))_auto]" : "xl:grid-cols-[minmax(260px,1.7fr)_repeat(4,minmax(145px,1fr))_auto]"}`}>
          <label className="relative min-w-[240px]">
            <Search
              size={16}
              className="absolute left-3 top-3 text-slate-400"
            />
            <input
              className={`${input} w-full pl-9`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="搜索任务名称或任务编号"
            />
          </label>
          <select
            aria-label="任务状态"
            className={`${input} w-full`}
            value={status}
            onChange={(e) => {
              setPage(1);
              setMetric("");
              setStatus(e.target.value);
            }}
          >
            <option value="">全部状态</option>
            <option value="QUEUED">排队中</option>
            <option value="RUNNING">执行中</option>
            <option value="PAUSING">暂停中</option>
            <option value="PAUSED">已暂停</option>
            <option value="COMPLETED">已完成</option>
            <option value="FAILED">失败</option>
            <option value="CANCELLED">已取消</option>
          </select>
          <SearchableMultiSelectFilter label="国家/地区" value={countries} options={filterOptions.countries.map((item)=>({...item,label:COUNTRY_NAMES.of(item.value)||item.value}))} onChange={(value)=>{setPage(1);setCountries(value)}}/>
          <SearchableMultiSelectFilter label="所属行业" value={industries} options={filterOptions.industries} onChange={(value)=>{setPage(1);setIndustries(value)}}/>
          <select aria-label="获客模式" className={`${input} w-full`} value={costMode} onChange={(event)=>{setPage(1);setCostMode(event.target.value)}}><option value="">全部获客模式</option><option value="FREE_ONLY">标准获客</option><option value="ADAPTIVE">智能获客</option></select>
          {showOwner ? <UserScopeSelect permission="ai.acquisition.data_all" value={scopeUserId} initializeDefault={false} onChange={(value)=>{setScopeUserId(value);setPage(1)}} allLabel="全部归属人" filterLabel="归属人" className={`${input} w-full`}/> : null}
          <div className="flex gap-2"><button type="submit" className={primaryButton}>查询</button><button type="button" className={button} onClick={refreshAll}><RefreshCw size={16}/>刷新</button></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <CompactDateRange label="创建日期" fromLabel="创建开始日期" toLabel="创建结束日期" from={from} to={to} onFromChange={(value)=>{setPage(1);setFrom(value)}} onToChange={(value)=>{setPage(1);setTo(value)}}/>
            {(search || status || metric || industries.length || countries.length || costMode || from || to || scopeUserId) ? <button type="button" className={button} onClick={()=>{setDraft("");setSearch("");setStatus("");setMetric("");setIndustries([]);setCountries([]);setCostMode("");setFrom("");setTo("");setScopeUserId("");setPage(1)}}>重置</button> : null}
          </div>
        </form>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} reload={() => void load()} />
        ) : tasks.length ? (
          <div className="overflow-x-auto">
            <table className={`w-full table-fixed text-left text-sm ${showOwner ? "min-w-[2160px]" : "min-w-[1980px]"}`}>
              <colgroup>
                <col className="w-[260px]" />
                <col className="w-[115px]" />
                <col className="w-[170px]" />
                <col className="w-[105px]" />
                <col className="w-[90px]" />
                <col className="w-[120px]" />
                <col className="w-[145px]" />
                <col className="w-[220px]" />
                <col className="w-[145px]" />
                {canViewUsage ? <><col className="w-[125px]" /><col className="w-[210px]" /></> : null}
                <col className="w-[110px]" />
                {showOwner ? <col className="w-[180px]" /> : null}
                <col className="w-[185px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "任务名称 / 编号",
                    "状态",
                    "候选核验进度",
                    "成功入池",
                    "待复核",
                    "去重后候选",
                    "目标国家/地区",
                    "目标行业",
                    "获客模式",
                    ...(canViewUsage?["Google调用","Token / 实际费用"]:[]),
                    "任务耗时",
                    ...(showOwner ? ["归属人"] : []),
                    "创建时间",
                    "操作",
                  ].map((x,index,headers) => (
                    <th key={x} className={`whitespace-nowrap px-4 py-3 font-medium ${index===0?"sticky left-0 z-20 bg-slate-50 shadow-[1px_0_0_#e2e8f0]":""} ${index===headers.length-1?"sticky right-0 z-20 bg-slate-50 shadow-[-1px_0_0_#e2e8f0]":""}`}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="group cursor-pointer border-t border-slate-100 align-middle hover:bg-blue-50/30">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 shadow-[1px_0_0_#e2e8f0]">
                      <Link
                        className="line-clamp-2 font-medium leading-5 text-slate-900 hover:text-blue-700 hover:underline"
                        href={`/ai-acquisition/tasks/${t.id}`}
                        title={t.name}
                      >
                        {t.name}
                      </Link>
                      <small className="mt-1 block truncate whitespace-nowrap text-slate-400" title={t.task_number}>
                        {t.task_number}
                      </small>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                      {t.error_message ? (
                        <small title={acquisitionErrorMessageZh(t.error_message)} className={`mt-2 block line-clamp-2 ${["QUEUED","RUNNING","PAUSING"].includes(t.status)?"text-amber-700":"text-rose-600"}`}>
                          {["QUEUED","RUNNING","PAUSING"].includes(t.status)?"此前异常：":""}{acquisitionFailureStage(t.error_message)}
                        </small>
                      ) : null}
                    </td>
                    <td className="w-44 px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}#customer-results`} className="group/progress block rounded-md hover:bg-blue-50" title="查看本任务全部候选及核验详情"><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${Math.min(100,t.discovered_count?Number(t.processed_count||0)/Number(t.discovered_count)*100:t.status==="COMPLETED"?100:0)}%`}}/></div><span className="mt-1 block text-xs text-slate-400 group-hover/progress:text-blue-700">{formatNumber(t.processed_count)} / {formatNumber(t.discovered_count)} 条</span></Link></td>
                    <td className="px-4 py-3"><Link href={`/ai-acquisition/customers?scope=accepted&task_id=${t.id}`} className="font-medium text-emerald-700 hover:underline" title="查看本任务仍关联客户的入池结果">{summary?formatNumber(summary.accepted_by_task[t.id]||0):"—"} 条</Link></td>
                    <td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}?decision=REVIEW`} className="font-medium text-amber-700 hover:underline">{summary?formatNumber(summary.review_by_task[t.id]||0):"—"} 条</Link></td>
                    <td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}#customer-results`} className="font-medium text-slate-800 hover:text-blue-700 hover:underline">{formatNumber(t.discovered_count)} 条</Link></td>
                    <td className="px-4 py-3"><span className="flex max-w-44 flex-col gap-1" title={t.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、")}>{t.countries.slice(0,2).map((code)=><CountryLabel key={code} value={code}/>)}{t.countries.length>2?<span className="text-xs text-slate-500">另有 {t.countries.length-2} 个</span>:null}</span></td>
                    <td className="px-4 py-3"><span className="block max-w-52 truncate" title={(t.industries?.length?t.industries:[t.industry]).join("、")}>{(t.industries?.length?t.industries:[t.industry]).slice(0,2).join("、")}{(t.industries?.length||1)>2?` +${(t.industries?.length||1)-2}`:""}</span></td>
                    <td className="px-4 py-3"><CostModeBadge mode={t.cost_mode} context="acquisition" />{t.task_cost_limit_usd!=null?<small className="mt-1 block text-slate-400">任务上限 {formatCost(t.task_cost_limit_usd)}</small>:null}</td>
                    {canViewUsage?<><td className="px-4 py-3 whitespace-nowrap"><Link href={`/ai-acquisition/tasks/${t.id}#usage-details`} className="group/usage block" title="查看本任务Google Places调用明细"><b className="font-medium text-slate-800">{t.usage?`${formatNumber(t.usage.google_calls)} 次`:pageUsageError?"暂不可用":"统计中…"}</b><small className="mt-1 block text-blue-600 group-hover/usage:underline">查看明细</small></Link></td><td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}#usage-details`} className="group/usage block" title="查看本任务Token与实际费用明细"><b className="whitespace-nowrap font-medium text-slate-800">{t.usage?formatCost(t.usage.total_cost_usd):pageUsageError?"暂不可用":"统计中…"}</b><small className="mt-1 block whitespace-nowrap text-slate-500">{t.usage?`${formatTokens(t.usage.total_tokens)} Token · OpenAI ${formatNumber(t.usage.openai_calls)} 次`:pageUsageError?"用量查询失败，请刷新重试":"正在读取真实台账"}</small><small className="mt-1 block text-blue-600 group-hover/usage:underline">查看明细</small></Link></td></>:null}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDuration(effectiveElapsedMs(t))}</td>
                    {showOwner ? <td className="px-4 py-4"><b className="block truncate font-medium text-slate-800" title={t.owner?.name?.trim()?t.owner?.email||t.owner.name:t.owner?.email||"未命名用户"}>{t.owner?.name?.trim() || t.owner?.email || "未命名用户"}</b></td> : null}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(t.created_at).toLocaleString("zh-CN",{hour12:false})}{t.scheduled_at?<small className="mt-1 block text-blue-600">预约 {new Date(t.scheduled_at).toLocaleString("zh-CN",{hour12:false})}</small>:null}</td>
                    <td className="sticky right-0 z-10 bg-white px-4 py-4 shadow-[-1px_0_0_#e2e8f0]"><div className="flex items-center gap-2 whitespace-nowrap">
                      <Link className={taskDetailButton} href={`/ai-acquisition/tasks/${t.id}`}>查看详情</Link>
                      {t.status==="COMPLETED"||(canControl&&t.can_control&&["QUEUED","RUNNING","PAUSING","PAUSED","FAILED"].includes(t.status))?<RowActionMenu ariaLabel={`${t.name}操作菜单`}>
                        {t.status==="COMPLETED"?<><RowActionItem onClick={()=>router.push(`/ai-acquisition/tasks/${t.id}/report`)}>查看任务报告</RowActionItem>{canControl&&t.can_control?<RowActionItem onClick={()=>setPendingAction({task:t,action:"RECHECK_EVIDENCE_GAPS"})}>校验证据缺口</RowActionItem>:null}</>:null}
                      {canControl&&t.can_control&&["QUEUED","RUNNING","PAUSING","PAUSED","FAILED"].includes(t.status)?<>
                        {taskControl(t.status)?<RowActionItem tone={taskControl(t.status)!.tone} onClick={()=>setPendingAction({task:t,action:taskControl(t.status)!.action})}>{taskControl(t.status)!.label}</RowActionItem>:null}
                        {["QUEUED","RUNNING","PAUSING","PAUSED"].includes(t.status)?<RowActionItem tone="danger" onClick={()=>setPendingAction({task:t,action:"CANCEL"})}>取消任务</RowActionItem>:null}
                      </>:null}
                      </RowActionMenu>:null}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center text-sm text-slate-500">
            暂无AI获客任务
          </div>
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={count}
          onPage={setPage}
          onPageSize={(s) => {
            setPage(1);
            setPageSize(s);
          }}
          itemLabel="个任务"
        />
      </section>
    </div>{googleDetailsOpen?<AppDialog title="Google Places 结算月调用明细" description="AI获客与AI筛选按系统调用账本独立统计；平台已确认和免费额度属于同一Google结算账号，仅用于判断共享额度及超额风险，最终费用以Google账单为准。" onClose={()=>setGoogleDetailsOpen(false)} width="max-w-7xl">{googleBillingLoading?<Loading/>:googleBilling?.state==="CONNECTED"?<div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["SKU","AI获客记录","AI筛选记录","平台已确认总量","待平台同步","预计账号总量","免费上限","剩余 / 已超","超额预计费用"].map(item=><th key={item} className="px-3 py-3 font-medium">{item}</th>)}</tr></thead><tbody>{googleBilling.skuUsage?.map(item=>{const exceeded=Number(item.projectedOverageCalls||0)>0;return <tr key={item.key} className="border-t"><td className="px-3 py-3 font-medium">{item.label}</td><td className="bg-blue-50/50 px-3 py-3 font-semibold text-blue-700">{formatNumber(item.acquisitionSystemUsage)} 次<small className="mt-1 block font-normal text-blue-500">系统记账 {formatCost(item.acquisitionSystemCostUsd)}</small></td><td className="px-3 py-3">{formatNumber(item.screeningSystemUsage)} 次<small className="mt-1 block text-slate-400">系统记账 {formatCost(item.screeningSystemCostUsd)}</small></td><td className="px-3 py-3">{formatNumber(item.usageCount)} 次</td><td className="px-3 py-3">{formatNumber(item.pendingSystemUsage)} 次</td><td className="px-3 py-3 font-medium">{formatNumber(item.projectedUsage)} 次</td><td className="px-3 py-3">{item.freeLimit==null?"不限量":formatNumber(item.freeLimit)}</td><td className={`px-3 py-3 font-medium ${exceeded?"text-rose-600":"text-emerald-700"}`}>{item.freeLimit==null?"不限量":exceeded?`已超 ${formatNumber(item.projectedOverageCalls)} 次`:`剩余 ${formatNumber(item.projectedRemaining)} 次`}</td><td className={`px-3 py-3 font-medium ${Number(item.projectedOverageCostUsd||0)>0?"text-rose-600":"text-slate-500"}`}>{formatCost(item.projectedOverageCostUsd)}</td></tr>})}</tbody></table></div>:<p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{googleBilling?.message||"正在读取 Google Places 明细"}</p>}<div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">AI获客记录包含目标商家搜索，以及由获客候选触发的后续Google核验；不会计入普通AI筛选任务。</div><div className="mt-5 flex justify-end border-t pt-4"><button type="button" onClick={()=>setGoogleDetailsOpen(false)} className={button}>关闭</button></div></AppDialog>:null}</main>
  );
}
