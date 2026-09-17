"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck2, Check, ChevronDown, CircleHelp, LoaderCircle, Plus, RefreshCw, Search, Settings2, TriangleAlert, UserRoundPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  useToast,
} from "@/components/ai-screening/ui";
import type { AcquisitionTask } from "./types";
import { UserScopeSelect } from "@/components/user-scope-select";
import { SearchableMultiSelectFilter, type SearchableFilterOption } from "@/components/ui/searchable-multi-select-filter";
import { quickCostDateRange } from "@/lib/cost-center";
import { AppDialog } from "@/components/ui/app-dialog";
import { acquisitionErrorMessageZh, acquisitionFailureStage } from "@/lib/ai-acquisition/presentation";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";
import { countryInfo } from "@/lib/countries";

const COUNTRY_NAMES = { of: (value: string) => countryInfo(value).name };
type TaskSummary = { tasks:number; active_tasks:number; completed_tasks:number; today_accepted:number; accepted:number; review:number; failed_tasks:number };
type SummaryMetric = "" | "active" | "completed" | "today_accepted" | "accepted" | "review" | "failed";
type CostOverview = { todayCalls:number; todayCost:number; totalCost:number; accepted:number; processed:number; openaiCost:number; googleActualCost:number; googleCalls:number; freeCalls:number };
type GoogleSkuUsage = { key:string; label:string; usageCount:number; acquisitionSystemUsage:number; acquisitionSystemCostUsd:number; screeningSystemUsage:number; screeningSystemCostUsd:number; pendingSystemUsage:number; projectedUsage:number; freeLimit:number|null; projectedRemaining:number|null; projectedOverageCalls:number; projectedOverageCostUsd:number };
type GoogleBilling = { state:"NOT_CONFIGURED"|"CONNECTED"|"NO_DATA"|"ERROR"; message:string; skuUsage?:GoogleSkuUsage[] };
type AcquisitionAction = "PAUSE" | "RESUME" | "CANCEL" | "RETRY";

const actionCopy:Record<AcquisitionAction,{title:string;description:string;confirm:string}> = {
  PAUSE:{title:"暂停AI获客任务？",description:"系统将在当前安全节点停止新的调用并保存执行进度；恢复后从检查点继续，不重复已完成的检索与核验。",confirm:"确认暂停"},
  RESUME:{title:"恢复AI获客任务？",description:"任务将从上次保存的检查点继续，仅执行未完成步骤，不重复采集已处理客户。",confirm:"确认恢复"},
  CANCEL:{title:"取消AI获客任务？",description:"任务将停止后续采集和核验；已产生的客户、公开来源、执行记录与费用台账会继续保留。",confirm:"确认取消"},
  RETRY:{title:"从检查点重试任务？",description:"只恢复失败或中断的步骤，保留已处理候选和原始发现依据，避免重复调用与重复入池。",confirm:"确认重试"},
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
    [summary, setSummary] = useState<TaskSummary>({ tasks:0, active_tasks:0, completed_tasks:0, today_accepted:0, accepted:0, review:0, failed_tasks:0 }),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
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
    [costSummaryOpen, setCostSummaryOpen] = useState(false),
    [googleDetailsOpen, setGoogleDetailsOpen] = useState(false),
    [googleBilling, setGoogleBilling] = useState<GoogleBilling | null>(null),
    [googleBillingLoading, setGoogleBillingLoading] = useState(false),
    [showOwner, setShowOwner] = useState(false),
    [scopeUserId, setScopeUserId] = useState(""),
    [pendingAction, setPendingAction] = useState<{task:AcquisitionTask;action:AcquisitionAction}|null>(null),
    [actionBusy, setActionBusy] = useState(false);
  const {toast,node:toastNode}=useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (scopeUserId) p.set("user_id", scopeUserId);
      if (status) p.set("status", status);
      if (metric) p.set("metric", metric);
      if (search) p.set("search", search);
      for (const industry of industries) p.append("industry", industry);
      for (const country of countries) p.append("country", country);
      if (costMode) p.set("cost_mode", costMode);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/ai-acquisition/tasks?${p}`, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "加载失败");
      setTasks(b.data || []);
      setCount(b.count || 0);
      setSummary(b.summary || { tasks:0, active_tasks:0, completed_tasks:0, today_accepted:0, accepted:0, review:0, failed_tasks:0 });
      setFilterOptions(b.filter_options || {countries:[],industries:[]});
      setShowOwner(Boolean(b.show_owner));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, metric, search, industries, countries, costMode, from, to, scopeUserId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!canViewUsage) return;
    let active = true;
    setCostOverview(null);
    const today = quickCostDateRange("TODAY");
    const todayParams = new URLSearchParams({ from:today.from, to:today.to, page:"1", pageSize:"10" });
    const historyParams = new URLSearchParams({ all_time:"1", page:"1", pageSize:"10" });
    if (scopeUserId) { todayParams.set("user_id", scopeUserId); historyParams.set("user_id", scopeUserId); }
    void Promise.all([
      fetch(`/api/ai-acquisition/usage?${todayParams}`, { cache:"no-store" }).then(async (response)=>response.ok?response.json():null),
      fetch(`/api/ai-acquisition/usage?${historyParams}`, { cache:"no-store" }).then(async (response)=>response.ok?response.json():null),
    ]).then(([todayBody, historyBody])=>{
      if (!active || !todayBody || !historyBody) return;
      setCostOverview({
        todayCalls:Number(todayBody.summary?.calls||0),
        todayCost:Number(todayBody.summary?.total_cost_usd||0),
        totalCost:Number(historyBody.summary?.total_cost_usd||0),
        accepted:Number(historyBody.summary?.accepted||0),
        processed:Number(historyBody.summary?.processed||0),
        openaiCost:Number(historyBody.summary?.openai_cost_usd||0),
        googleActualCost:Number(historyBody.summary?.google_cost_usd||0),
        googleCalls:Number(historyBody.summary?.google_calls||0),
        freeCalls:Number(historyBody.summary?.google_free_calls||0),
      });
    }).catch(()=>undefined);
    return ()=>{active=false};
  }, [canViewUsage, scopeUserId]);
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
      toast({PAUSE:"任务正在安全暂停",RESUME:"任务已从检查点恢复",CANCEL:"任务已取消，历史结果与费用已保留",RETRY:"任务已从检查点重新排队"}[pendingAction.action]);
      setPendingAction(null);
      await load();
    }catch(actionError){
      toast(actionError instanceof Error?actionError.message:"任务操作失败","error");
    }finally{setActionBusy(false)}
  }
  const ownerQuery = scopeUserId ? `&user_id=${encodeURIComponent(scopeUserId)}` : "";
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title="AI获客任务中心"
        description="发现、核验并沉淀可直接跟进的目标客户；每条结果均保留来源、判断依据和成本记录。"
        actions={
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            {canViewUsage ? <Link href="/ai-usage?business_type=acquisition" className={`${button} shrink-0`}>AI用量与费用</Link> : null}
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
          { key:"today_accepted" as const, label:"今日获客", value:summary.today_accepted, note:"今日核验通过并成功入池", icon:CalendarCheck2, tone:"bg-blue-50 text-blue-700" },
          { key:"accepted" as const, label:"历史总获客", value:summary.accepted, note:"累计核验通过并成功入池", icon:UserRoundPlus, tone:"bg-emerald-50 text-emerald-700" },
          { key:"review" as const, label:"待人工复核", value:summary.review, note:"需核对证据后处理", icon:CircleHelp, tone:"bg-amber-50 text-amber-700" },
          { key:"active" as const, label:"进行中", value:summary.active_tasks, note:"排队、执行或暂停处理中", icon:LoaderCircle, tone:"bg-violet-50 text-violet-700" },
          { key:"completed" as const, label:"已完成任务", value:summary.completed_tasks, note:"已完成全部处理流程", icon:Check, tone:"bg-cyan-50 text-cyan-700" },
          { key:"failed" as const, label:"异常任务", value:summary.failed_tasks, note:"需要检查或重试", icon:TriangleAlert, tone:"bg-rose-50 text-rose-700" },
        ].map((item)=>{
          const customerScope=item.key==="today_accepted"?"today":item.key==="accepted"?"accepted":item.key==="review"?"review":null;
          const className=`${panel} relative flex min-w-0 items-center gap-3 p-[15px] text-left transition hover:-translate-y-0.5 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 ${!customerScope&&metric===item.key?"border-blue-400 ring-1 ring-blue-100":""}`;
          const content=<><span className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] ${item.tone}`}><item.icon size={20}/></span><span className="min-w-0"><span className="block truncate text-sm text-[#6f7b8f]">{item.label}</span><b className="mt-[3px] block text-2xl font-semibold">{Number(item.value||0).toLocaleString("zh-CN")}</b><small className="block truncate text-[#8b96a7]" title={`${item.note}；点击查看对应${customerScope?"客户":"任务"}`}>{item.note}</small></span><span aria-hidden="true" className="absolute right-4 text-xl text-slate-400">›</span></>;
          return customerScope?<Link key={item.label} href={`/ai-acquisition/customers?scope=${customerScope}${ownerQuery}`} className={className}>{content}</Link>:<button type="button" key={item.label} aria-pressed={metric===item.key} onClick={()=>{setMetric(item.key);setStatus("");setPage(1)}} className={className}>{content}</button>;
        })}
      </section>
      {toastNode}
      <ConfirmDialog open={Boolean(pendingAction)} title={pendingAction?actionCopy[pendingAction.action].title:"任务操作确认"} description={pendingAction?actionCopy[pendingAction.action].description:""} confirmLabel={pendingAction?actionCopy[pendingAction.action].confirm:"确认"} busy={actionBusy} onClose={()=>!actionBusy&&setPendingAction(null)} onConfirm={()=>void runAction()}/>
      {canViewUsage ? <section className={`${panel} overflow-hidden`}>
        <button type="button" aria-expanded={costSummaryOpen} aria-controls="acquisition-cost-summary" onClick={()=>setCostSummaryOpen(open=>!open)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50">
          <span className="min-w-0"><b className="block font-semibold">获客成效与实际成本</b><span className="mt-1 block truncate text-xs text-slate-500">今日实际 {costOverview?formatCost(costOverview.todayCost):"—"} · 历史实际 {costOverview?formatCost(costOverview.totalCost):"—"} · 历史入池率 {costOverview&&costOverview.processed?`${(costOverview.accepted/costOverview.processed*100).toFixed(1)}%`:"—"}</span></span>
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-blue-600">{costSummaryOpen?"收起":"查看成效与成本"}<ChevronDown size={16} className={`transition ${costSummaryOpen?"rotate-180":""}`}/></span>
        </button>
        {costSummaryOpen?<div id="acquisition-cost-summary" className="border-t p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">实际费用仅包含OpenAI已完成调用与Google平台已确认金额；Google价目估算、共享免费额度和预计超额费用不计入实际费用。</p>{canViewGoogleBilling?<button type="button" onClick={()=>void openGoogleDetails()} className="text-xs font-medium text-blue-600 hover:underline">查看Google调用与账号额度</button>:null}</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/ai-usage?business_type=acquisition" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"><small className="flex items-center justify-between text-slate-500"><span>今日实际费用</span><span className="text-blue-600">查看今日明细</span></small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.todayCost):"—"}</b><span className="text-xs text-slate-400">今日 {costOverview?formatNumber(costOverview.todayCalls):"—"} 次API调用</span></Link>
          <Link href="/ai-usage?business_type=acquisition" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"><small className="flex items-center justify-between text-slate-500"><span>历史累计实际费用</span><span className="text-blue-600">查看用量明细</span></small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.totalCost):"—"}</b><span className="text-xs text-slate-400">OpenAI {costOverview?formatCost(costOverview.openaiCost):"—"} · Google已确认 {costOverview?formatCost(costOverview.googleActualCost):"—"}</span></Link>
          <Link href={`/ai-acquisition/customers?scope=accepted${ownerQuery}`} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"><small className="flex items-center justify-between text-slate-500"><span>平均入池客户实际成本</span><span className="text-blue-600">查看入池客户</span></small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.accepted?costOverview.totalCost/costOverview.accepted:0):"—"}</b><span className="text-xs text-slate-400">历史实际费用 ÷ {costOverview?formatNumber(costOverview.accepted):"—"} 位成功入池客户</span></Link>
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><small className="text-slate-500">历史核验入池率</small><b className="mt-1 block text-xl">{costOverview&&costOverview.processed?`${(costOverview.accepted/costOverview.processed*100).toFixed(1)}%`:"—"}</b><span className="text-xs text-slate-400">成功入池 {costOverview?formatNumber(costOverview.accepted):"—"} ÷ 已核验 {costOverview?formatNumber(costOverview.processed):"—"}</span></article>
        </div><p className="mt-3 text-xs text-slate-400">历史Google Places调用 {costOverview?formatNumber(costOverview.googleCalls):"—"} 次，其中系统记录免费调用 {costOverview?formatNumber(costOverview.freeCalls):"—"} 次；详细额度以Google结算账号为准。</p></div>:null}
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
          <select aria-label="获客模式" className={`${input} w-full`} value={costMode} onChange={(event)=>{setPage(1);setCostMode(event.target.value)}}><option value="">全部获客模式</option><option value="FREE_ONLY">全免费获客</option><option value="ADAPTIVE">智能增强获客</option></select>
          {showOwner ? <UserScopeSelect permission="ai.acquisition.data_all" value={scopeUserId} initializeDefault={false} onChange={(value)=>{setScopeUserId(value);setPage(1)}} allLabel="全部归属人" filterLabel="归属人" className={`${input} w-full`}/> : null}
          <div className="flex gap-2"><button type="submit" className={primaryButton}>查询</button><button type="button" className={button} onClick={()=>void load()}><RefreshCw size={16}/>刷新</button></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">创建时间</span>
            <input type="date" aria-label="创建开始日期" className={`${input} w-40`} value={from} onChange={(event)=>{setPage(1);setFrom(event.target.value)}}/>
            <span className="text-slate-300">—</span>
            <input type="date" aria-label="创建结束日期" className={`${input} w-40`} value={to} onChange={(event)=>{setPage(1);setTo(event.target.value)}}/>
            {(search || status || metric || industries.length || countries.length || costMode || from || to || scopeUserId) ? <button type="button" className={button} onClick={()=>{setDraft("");setSearch("");setStatus("");setMetric("");setIndustries([]);setCountries([]);setCostMode("");setFrom("");setTo("");setScopeUserId("");setPage(1)}}>重置</button> : null}
          </div>
        </form>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} reload={() => void load()} />
        ) : tasks.length ? (
          <div className="overflow-x-auto">
            <table className={`w-full table-fixed text-left text-sm ${showOwner ? "min-w-[2260px]" : "min-w-[2080px]"}`}>
              <colgroup>
                <col className="w-[260px]" />
                {showOwner ? <col className="w-[180px]" /> : null}
                <col className="w-[145px]" />
                <col className="w-[115px]" />
                <col className="w-[170px]" />
                <col className="w-[105px]" />
                <col className="w-[90px]" />
                <col className="w-[190px]" />
                <col className="w-[145px]" />
                <col className="w-[220px]" />
                {canViewUsage ? <><col className="w-[115px]" /><col className="w-[115px]" /><col className="w-[175px]" /></> : null}
                <col className="w-[110px]" />
                <col className="w-[185px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "任务名称 / 编号",
                    ...(showOwner ? ["归属人"] : []),
                    "获客模式",
                    "状态",
                    "候选核验进度",
                    "成功入池",
                    "待复核",
                    "去重后候选",
                    "目标国家/地区",
                    "目标行业",
                    ...(canViewUsage?["Google调用","总Token","实际费用"]:[]),
                    "任务耗时",
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
                  <tr key={t.id} className="group cursor-pointer border-t border-slate-100 align-top hover:bg-blue-50/30">
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
                    {showOwner ? <td className="px-4 py-4"><b className="block truncate font-medium text-slate-800" title={t.owner?.name?.trim()?t.owner?.email||t.owner.name:t.owner?.email||"未命名用户"}>{t.owner?.name?.trim() || t.owner?.email || "未命名用户"}</b></td> : null}
                    <td className="px-4 py-3"><CostModeBadge mode={t.cost_mode} context="acquisition" />{t.task_cost_limit_usd!=null?<small className="mt-1 block text-slate-400">任务上限 {formatCost(t.task_cost_limit_usd)}</small>:null}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                      {t.error_message ? (
                        <small title={acquisitionErrorMessageZh(t.error_message)} className="mt-2 block line-clamp-2 text-rose-600">
                          {acquisitionFailureStage(t.error_message)}
                        </small>
                      ) : null}
                    </td>
                    <td className="w-44 px-4 py-3"><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${Math.min(100,t.discovered_count?Number(t.processed_count||0)/Number(t.discovered_count)*100:t.status==="COMPLETED"?100:0)}%`}}/></div><span className="mt-1 block text-xs text-slate-400">{formatNumber(t.processed_count)} / {formatNumber(t.discovered_count)} 条</span></td>
                    <td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}?decision=ACCEPTED`} className="font-medium text-emerald-700 hover:underline">{formatNumber(t.accepted_count)} 条</Link></td>
                    <td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}?decision=REVIEW`} className="font-medium text-amber-700 hover:underline">{formatNumber(t.review_count)} 条</Link></td>
                    <td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}#customer-results`} className="font-medium text-slate-800 hover:text-blue-700 hover:underline">{formatNumber(t.discovered_count)} 条</Link></td>
                    <td className="px-4 py-3"><span className="block max-w-44 truncate" title={t.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、")}>{t.countries.slice(0,2).map((code)=>COUNTRY_NAMES.of(code)||code).join("、")}{t.countries.length>2?` +${t.countries.length-2}`:""}</span></td>
                    <td className="px-4 py-3"><span className="block max-w-52 truncate" title={(t.industries?.length?t.industries:[t.industry]).join("、")}>{(t.industries?.length?t.industries:[t.industry]).slice(0,2).join("、")}{(t.industries?.length||1)>2?` +${(t.industries?.length||1)-2}`:""}</span></td>
                    {canViewUsage?<><td className="px-4 py-3 whitespace-nowrap"><Link href={`/ai-acquisition/tasks/${t.id}#usage-details`} className="font-medium text-slate-700 hover:text-blue-700 hover:underline">{formatNumber(t.usage?.google_calls)} 次</Link></td><td className="px-4 py-3 whitespace-nowrap"><Link href={`/ai-acquisition/tasks/${t.id}#usage-details`} className="font-medium text-slate-700 hover:text-blue-700 hover:underline">{formatTokens(t.usage?.total_tokens)}</Link></td><td className="px-4 py-3"><Link href={`/ai-acquisition/tasks/${t.id}#usage-details`} className="block font-semibold text-slate-800 hover:text-blue-700 hover:underline">{formatCost(t.usage?.total_cost_usd)}</Link><small className="mt-1 block whitespace-nowrap text-slate-500">OpenAI {formatCost(t.usage?.openai_cost_usd)}</small><small className="mt-0.5 block whitespace-nowrap text-slate-500">Google已确认 {formatCost(t.usage?.google_cost_usd)}</small></td></>:null}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDuration(effectiveElapsedMs(t))}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(t.created_at).toLocaleString("zh-CN",{hour12:false})}{t.scheduled_at?<small className="mt-1 block text-blue-600">预约 {new Date(t.scheduled_at).toLocaleString("zh-CN",{hour12:false})}</small>:null}</td>
                    <td className="sticky right-0 z-10 bg-white px-4 py-4 shadow-[-1px_0_0_#e2e8f0]"><div className="flex items-center gap-2 whitespace-nowrap">
                      <Link className="font-medium text-blue-700 hover:underline" href={`/ai-acquisition/tasks/${t.id}`}>查看详情</Link>
                      {t.status==="COMPLETED"||(canControl&&t.can_control&&["QUEUED","RUNNING","PAUSING","PAUSED","FAILED"].includes(t.status))?<RowActionMenu ariaLabel={`${t.name}操作菜单`}>
                        {t.status==="COMPLETED"?<RowActionItem onClick={()=>router.push(`/ai-acquisition/tasks/${t.id}/report`)}>查看任务报告</RowActionItem>:null}
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
