"use client";
import Link from "next/link";
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
  useToast,
} from "@/components/ai-screening/ui";
import type { AcquisitionTask } from "./types";
import { ACQUISITION_COUNTRY_GROUPS, ACQUISITION_INDUSTRY_TERMS } from "@/lib/ai-acquisition/config";
import { UserScopeSelect } from "@/components/user-scope-select";
import { TodayUsageLink } from "@/components/ai-usage/today-usage-link";
import { quickCostDateRange } from "@/lib/cost-center";
import { AppDialog } from "@/components/ui/app-dialog";
import { acquisitionErrorMessageZh, acquisitionFailureStage } from "@/lib/ai-acquisition/presentation";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";

const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const ACQUISITION_INDUSTRY_OPTIONS = Object.keys(ACQUISITION_INDUSTRY_TERMS);
type TaskSummary = { tasks:number; active_tasks:number; completed_tasks:number; today_accepted:number; accepted:number; review:number; failed_tasks:number };
type SummaryMetric = "" | "active" | "completed" | "today_accepted" | "accepted" | "review" | "failed";
type CostOverview = { todayCalls:number; todayCost:number; totalCost:number; accepted:number; googleCalls:number; freeCalls:number };
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

function IndustryFilter({ value, onChange }:{ value:string; onChange:(value:string)=>void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = ACQUISITION_INDUSTRY_OPTIONS;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = options.filter((item) => item.toLowerCase().includes(normalizedQuery));
  const canUseCustom = Boolean(query.trim()) && !options.some((item) => item.toLowerCase() === normalizedQuery);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event:MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event:KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const select = (next:string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return <div ref={rootRef} className="relative min-w-0">
    <button
      type="button"
      aria-label="目标行业"
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      className={`${input} flex w-full items-center justify-between gap-2 text-left`}
    >
      <span className={`truncate ${value ? "text-slate-700" : "text-slate-400"}`}>{value || "全部目标行业"}</span>
      <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}/>
    </button>
    {open ? <div className="absolute left-0 top-full z-50 mt-1 w-[320px] max-w-[min(320px,calc(100vw-3rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" role="listbox" aria-label="选择目标行业">
      <div className="border-b border-slate-100 p-2">
        <label className="relative block">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400"/>
          <input ref={searchRef} value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&query.trim()){event.preventDefault();select(query.trim())}}} className={`${input} h-9 w-full pl-9`} placeholder="搜索或输入任意行业"/>
        </label>
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        <button type="button" onClick={()=>select("")} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${!value ? "bg-blue-50 text-blue-700" : "text-slate-600"}`}><span>全部目标行业</span>{!value?<Check size={15}/>:null}</button>
        {canUseCustom ? <button type="button" onClick={()=>select(query.trim())} className="mt-1 flex w-full items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-700 hover:bg-blue-100"><span className="min-w-0 truncate">按“{query.trim()}”筛选</span><Check size={15} className="shrink-0"/></button> : null}
        {filtered.map((item)=><button type="button" role="option" aria-selected={value===item} key={item} onClick={()=>select(item)} className={`mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${value===item?"bg-blue-50 text-blue-700":"text-slate-700"}`}><span className="min-w-0 truncate">{item}</span>{value===item?<Check size={15} className="shrink-0"/>:null}</button>)}
        {!filtered.length && !canUseCustom ? <p className="px-3 py-6 text-center text-sm text-slate-400">没有匹配的行业</p> : null}
      </div>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">可选择常用行业，也可输入任务中使用的其他行业</p>
    </div> : null}
  </div>;
}

export function AcquisitionTaskCenter({ canCreate, canViewUsage, canManageSettings, canViewGoogleBilling, canControl }:{ canCreate:boolean; canViewUsage:boolean; canManageSettings:boolean; canViewGoogleBilling:boolean; canControl:boolean }) {
  const [tasks, setTasks] = useState<AcquisitionTask[]>([]),
    [count, setCount] = useState(0),
    [summary, setSummary] = useState<TaskSummary>({ tasks:0, active_tasks:0, completed_tasks:0, today_accepted:0, accepted:0, review:0, failed_tasks:0 }),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [status, setStatus] = useState(""),
    [metric, setMetric] = useState<SummaryMetric>(""),
    [industry, setIndustry] = useState(""),
    [country, setCountry] = useState(""),
    [costMode, setCostMode] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [costOverview, setCostOverview] = useState<CostOverview | null>(null),
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
        user_id: scopeUserId || "all",
      });
      if (status) p.set("status", status);
      if (metric) p.set("metric", metric);
      if (search) p.set("search", search);
      if (industry) p.set("industry", industry);
      if (country) p.set("country", country);
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
      setShowOwner(Boolean(b.show_owner));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, metric, search, industry, country, costMode, from, to, scopeUserId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!canViewUsage) return;
    let active = true;
    setCostOverview(null);
    const today = quickCostDateRange("TODAY");
    const scope = scopeUserId || "all";
    const todayParams = new URLSearchParams({ from:today.from, to:today.to, user_id:scope, page:"1", pageSize:"10" });
    const historyParams = new URLSearchParams({ all_time:"1", user_id:scope, page:"1", pageSize:"10" });
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
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title="AI获客任务中心"
        description="低成本发现 → 非目标早停 → 主体与在营核验 → 联系方式和依据补全 → 系统去重 → 仅高可信目标客户进入客户公海"
        actions={
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            {canViewUsage ? <TodayUsageLink module="acquisition" scopeUserId={scopeUserId || "all"} todayUsage={costOverview?{calls:costOverview.todayCalls,cost:costOverview.todayCost}:null}/> : null}
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
          { key:"active" as const, label:"进行中", value:summary.active_tasks, note:"排队、执行或暂停处理中", icon:LoaderCircle, tone:"bg-violet-50 text-violet-700" },
          { key:"review" as const, label:"待人工复核", value:summary.review, note:"需核对证据后处理", icon:CircleHelp, tone:"bg-amber-50 text-amber-700" },
          { key:"completed" as const, label:"已完成任务", value:summary.completed_tasks, note:"已完成全部处理流程", icon:Check, tone:"bg-cyan-50 text-cyan-700" },
          { key:"failed" as const, label:"异常任务", value:summary.failed_tasks, note:"需要检查或重试", icon:TriangleAlert, tone:"bg-rose-50 text-rose-700" },
        ].map((item)=><button type="button" key={item.label} aria-pressed={metric===item.key} onClick={()=>{setMetric(item.key);setStatus("");setPage(1)}} className={`${panel} relative flex min-w-0 items-center gap-3 p-[15px] text-left transition hover:-translate-y-0.5 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 ${metric===item.key?"border-blue-400 ring-1 ring-blue-100":""}`}><span className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] ${item.tone}`}><item.icon size={20}/></span><span className="min-w-0"><span className="block truncate text-sm text-[#6f7b8f]">{item.label}</span><b className="mt-[3px] block text-2xl font-semibold">{Number(item.value||0).toLocaleString("zh-CN")}</b><small className="block truncate text-[#8b96a7]" title={`${item.note}；点击筛选任务`}>{item.note}</small></span><span aria-hidden="true" className="absolute right-4 text-xl text-slate-400">›</span></button>)}
      </section>
      {toastNode}
      <ConfirmDialog open={Boolean(pendingAction)} title={pendingAction?actionCopy[pendingAction.action].title:"任务操作确认"} description={pendingAction?actionCopy[pendingAction.action].description:""} confirmLabel={pendingAction?actionCopy[pendingAction.action].confirm:"确认"} busy={actionBusy} onClose={()=>!actionBusy&&setPendingAction(null)} onConfirm={()=>void runAction()}/>
      {canViewUsage ? <section className={`${panel} p-4`}>
        <div className="mb-3"><h2 className="font-semibold">获客成本总览</h2><p className="mt-1 text-xs text-slate-500">费用来自可核验调用账本；平均成本仅以成功核验并进入系统的有效目标客户为分母。</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><small className="text-slate-500">今日费用</small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.todayCost):"—"}</b><span className="text-xs text-slate-400">今日实际记账费用</span></article>
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><small className="text-slate-500">历史累计费用</small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.totalCost):"—"}</b><span className="text-xs text-slate-400">Google Places 与 OpenAI 合计</span></article>
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><small className="text-slate-500">平均每位有效客户成本</small><b className="mt-1 block text-xl">{costOverview?formatCost(costOverview.accepted?costOverview.totalCost/costOverview.accepted:0):"—"}</b><span className="text-xs text-slate-400">累计费用 ÷ 成功入池客户</span></article>
          <button type="button" disabled={!canViewGoogleBilling} onClick={()=>void openGoogleDetails()} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-slate-50"><small className="flex items-center justify-between text-slate-500"><span>Google Places累计调用</span>{canViewGoogleBilling?<span className="text-blue-600">查看明细</span>:null}</small><b className="mt-1 block text-xl">{costOverview?`${formatNumber(costOverview.googleCalls)} 次`:"—"}</b><span className="text-xs text-slate-400">累计免费调用 {costOverview?formatNumber(costOverview.freeCalls):"—"} 次</span></button>
        </div>
      </section> : null}
      <section className={`${panel} p-4`}>
        <form
          className="space-y-3"
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
          <select aria-label="目标国家/地区" className={`${input} w-full`} value={country} onChange={(event)=>{setPage(1);setCountry(event.target.value)}}><option value="">全部国家/地区</option>{ACQUISITION_COUNTRY_GROUPS.map((group)=><optgroup key={group.key} label={group.label}>{group.countries.map((item)=><option key={item} value={item}>{COUNTRY_NAMES.of(item)} · {item}</option>)}</optgroup>)}</select>
          <IndustryFilter value={industry} onChange={(value)=>{setPage(1);setIndustry(value)}}/>
          <select aria-label="获客模式" className={`${input} w-full`} value={costMode} onChange={(event)=>{setPage(1);setCostMode(event.target.value)}}><option value="">全部获客模式</option><option value="FREE_ONLY">全免费获客</option><option value="ADAPTIVE">智能增强获客</option></select>
          {showOwner ? <UserScopeSelect permission="ai.acquisition.data_all" value={scopeUserId} onChange={(value)=>{setScopeUserId(value);setPage(1)}} allLabel="全部归属人" filterLabel="归属人" className={`${input} w-full`}/> : null}
          <div className="flex gap-2"><button type="submit" className={primaryButton}>查询</button><button type="button" className={button} onClick={()=>void load()}><RefreshCw size={16}/>刷新</button></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">创建时间</span>
            <input type="date" aria-label="创建开始日期" className={`${input} w-40`} value={from} onChange={(event)=>{setPage(1);setFrom(event.target.value)}}/>
            <span className="text-slate-300">—</span>
            <input type="date" aria-label="创建结束日期" className={`${input} w-40`} value={to} onChange={(event)=>{setPage(1);setTo(event.target.value)}}/>
            {(search || status || metric || industry || country || costMode || from || to || scopeUserId) ? <button type="button" className={button} onClick={()=>{setDraft("");setSearch("");setStatus("");setMetric("");setIndustry("");setCountry("");setCostMode("");setFrom("");setTo("");setScopeUserId("");setPage(1)}}>重置</button> : null}
          </div>
        </form>
      </section>
      <section className={panel}>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} reload={() => void load()} />
        ) : tasks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1480px] table-fixed text-left text-sm">
              <colgroup><col className="w-[250px]"/>{showOwner?<col className="w-[170px]"/>:null}<col className="w-[180px]"/><col className="w-[220px]"/><col className="w-[180px]"/><col className="w-[190px]"/>{canViewUsage?<><col className="w-[190px]"/><col className="w-[160px]"/></>:null}<col className="w-[180px]"/><col className="w-[150px]"/></colgroup>
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "任务",
                    ...(showOwner ? ["归属人"] : []),
                    "状态 / 执行进度",
                    "目标范围 / 获客模式",
                    "搜索发现",
                    "客户核验结果",
                    ...(canViewUsage?["API / Token用量","实际费用"]:[]),
                    "耗时 / 创建时间",
                    "操作",
                  ].map((x) => (
                    <th key={x} className="px-4 py-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t align-top">
                    <td className="px-4 py-4">
                      <Link
                        className="font-semibold text-blue-700 hover:underline"
                        href={`/ai-acquisition/tasks/${t.id}`}
                      >
                        {t.name}
                      </Link>
                      <small className="mt-1 block text-slate-400">
                        {t.task_number}
                      </small>
                    </td>
                    {showOwner ? <td className="px-4 py-4"><b className="block font-medium text-slate-800">{t.owner?.name?.trim() || "未命名用户"}</b><small className="mt-1 block text-slate-400">{t.owner?.email || "—"}</small></td> : null}
                    <td className="px-4 py-4">
                      <StatusBadge status={t.status} />
                      <small className="mt-2 block text-slate-500">已执行 {formatNumber(t.search_completed_count||0)} 组检索</small>
                      {t.error_message ? (
                        <small title={acquisitionErrorMessageZh(t.error_message)} className="mt-2 block line-clamp-2 text-rose-600">
                          {acquisitionFailureStage(t.error_message)}
                        </small>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <div className="max-w-52 truncate font-medium text-slate-700" title={(t.industries?.length ? t.industries : [t.industry]).join("、")}>{(t.industries?.length ? t.industries : [t.industry]).slice(0, 2).join("、")}{(t.industries?.length || 1) > 2 ? ` +${(t.industries?.length || 1) - 2}` : ""}</div>
                      <small className="mt-1 block text-slate-500">{t.countries.slice(0, 2).map((code)=>COUNTRY_NAMES.of(code) || code).join("、")}{t.countries.length > 2 ? ` +${t.countries.length - 2}` : ""}</small>
                      <div className="mt-2"><CostModeBadge mode={t.cost_mode} context="acquisition" /></div>
                    </td>
                    <td className="px-4 py-4"><b className="text-slate-800">原始命中 {formatNumber(t.search_raw_hits||0)}</b><small className="mt-1 block text-slate-500">去重后候选 {formatNumber(t.discovered_count)}</small></td>
                    <td className="px-4 py-4"><b className="text-emerald-700">成功入池 {formatNumber(t.accepted_count)}</b><small className="mt-1 block text-amber-700">待复核 {formatNumber(t.review_count)}</small><small className="mt-1 block text-slate-400">未通过 {formatNumber(t.rejected_count)} · 重复 {formatNumber(t.duplicate_count)}</small></td>
                    {canViewUsage?<><td className="px-4 py-4"><b className="block font-medium text-slate-700">Google {formatNumber(t.usage?.google_calls)} 次</b><small className="mt-1 block text-slate-500">大模型 {formatNumber(t.usage?.openai_calls)} 次</small><small className="mt-1 block text-slate-500">{formatTokens(t.usage?.total_tokens)} Token</small></td><td className="px-4 py-4"><b className="block font-medium text-slate-800">{formatCost(t.usage?.total_cost_usd)}</b><small className="mt-1 block text-slate-500">OpenAI {formatCost(t.usage?.openai_cost_usd)}</small><small className="mt-1 block text-slate-500">Google {formatCost(t.usage?.google_cost_usd)}</small></td></>:null}
                    <td className="px-4 py-4 text-slate-500"><b className="block font-medium text-slate-700">{formatDuration(effectiveElapsedMs(t))}</b>
                      {t.scheduled_at ? <small className="mb-1 block font-medium text-blue-600">预约 {new Date(t.scheduled_at).toLocaleString("zh-CN", { hour12: false })}</small> : null}
                      <small className="mt-1 block">{new Date(t.created_at).toLocaleString("zh-CN", {
                        hour12: false,
                      })}</small>
                    </td>
                    <td className="px-4 py-4"><div className="flex items-center gap-2 whitespace-nowrap">
                      <Link className="font-medium text-blue-700 hover:underline" href={t.status==="FAILED"?`/ai-acquisition/tasks/${t.id}`:`/ai-acquisition/tasks/${t.id}?decision=${metric==="review"?"REVIEW":"ACCEPTED"}`}>{t.status==="FAILED"?"查看详情":metric==="review"?"查看待复核":"查看客户"}</Link>
                      {canControl&&t.can_control&&["QUEUED","RUNNING","PAUSING","PAUSED","FAILED"].includes(t.status)?<RowActionMenu ariaLabel={`${t.name}操作菜单`}>
                        {taskControl(t.status)?<RowActionItem tone={taskControl(t.status)!.tone} onClick={()=>setPendingAction({task:t,action:taskControl(t.status)!.action})}>{taskControl(t.status)!.label}</RowActionItem>:null}
                        {["QUEUED","RUNNING","PAUSING","PAUSED"].includes(t.status)?<RowActionItem tone="danger" onClick={()=>setPendingAction({task:t,action:"CANCEL"})}>取消任务</RowActionItem>:null}
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
