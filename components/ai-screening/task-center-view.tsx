"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Activity, Archive, CalendarRange, ChevronDown, Plus, RefreshCw, RotateCcw, Settings2, Target, Users } from "lucide-react";
import type { AiTask } from "@/components/ai-screening/types";
import { ConfirmDialog, CostModeBadge, ErrorState, Loading, PageHeader, Pagination, StatusBadge, button, effectiveElapsedMs, formatCost, formatDuration, formatNumber, formatTokens, panel, primaryButton, input, useToast } from "@/components/ai-screening/ui";
import { UserScopeSelect } from "@/components/user-scope-select";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";
import { AppDialog } from "@/components/ui/app-dialog";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";
import { TodayUsageLink } from "@/components/ai-usage/today-usage-link";

function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}

type ResponseBody = {
  data: AiTask[]; count: number; counts: Record<string, number>; pending_customers: number; today_cost: number; today_completed_customers: number; today_failed_customers: number; retry_customers: number; show_owner?: boolean;
  show_historical_cost_summary?: boolean;
  show_ai_usage?: boolean;
  show_ai_settings?: boolean;
  can_archive_tasks?: boolean;
  historical_summary?: { processed_customers:number; openai_cost_usd:number; average_openai_cost_per_customer_usd:number; google_places_call_count:number };
};
type GoogleSkuUsage = { key:string; label:string; usageCount:number; acquisitionSystemUsage:number; acquisitionSystemCostUsd:number; screeningSystemUsage:number; screeningSystemCostUsd:number; pendingSystemUsage:number; projectedUsage:number; freeLimit:number|null; projectedRemaining:number|null; projectedOverageCalls:number; projectedOverageCostUsd:number };
type GoogleBilling = { state:"NOT_CONFIGURED"|"CONNECTED"|"NO_DATA"|"ERROR"; message:string; skuUsage?:GoogleSkuUsage[] };

const tabs = [
  ["", "全部任务", "all"], ["ACTIVE", "活动任务", "active"], ["RUNNING", "执行中", "running"],
  ["QUEUED", "排队中", "queued"], ["COMPLETED", "已完成", "completed"], ["FAILED", "失败", "failed"],
] as const;

const actionCopy: Record<string, { title: string; description: string; confirm: string }> = {
  pause: { title: "停止任务？", description: "停止后不再领取新的客户分析；当前单条客户完成后暂停。已完成结果永久保留，继续执行时只处理未完成客户。", confirm: "确认停止" },
  cancel: { title: "取消排队任务？", description: "任务尚未执行，取消后退出等待队列，不分析客户且不产生OpenAI费用。", confirm: "确认取消" },
  resume: { title: "继续执行任务？", description: "任务从停止位置继续，只分析未完成客户；已完成客户不会重复分析。", confirm: "继续执行" },
  retry: { title: "重试失败客户？", description: "仅重新分析失败客户，已完成结果不会重复分析或重复计费。", confirm: "确认重试" },
  reanalyze_invalid: { title: "复验本任务无效目标？", description: "将创建一个新的复验任务，仅重新采集本任务曾判为无效目标的客户；原任务、证据与费用台账会保留，不会覆盖旧结果。", confirm: "创建复验任务" },
  reanalyze: { title: "创建全量复核任务？", description: "将以本任务全部客户创建独立复核任务。原任务、证据与费用账本完整保留；已有充分且仍有效的历史证据可复用，其他客户会重新进入核验流程。", confirm: "创建全量复核" },
  archive: { title: "归档任务？", description: "任务将从任务中心隐藏，但客户分析结果、证据、完成统计、Token和费用账本全部保留。", confirm: "确认归档" },
};

function control(task: AiTask) {
  if (task.status === "RUNNING") return { action: "pause", label: "停止任务", className: "text-rose-600" };
  if (task.status === "PAUSING") return { action: "pause", label: "立即完成停止", className: "text-rose-600" };
  if (task.status === "QUEUED") return { action: "cancel", label: "取消任务", className: "text-rose-600" };
  if (task.status === "PAUSED") return { action: "resume", label: "继续执行", className: "text-emerald-600" };
  if (task.status === "FAILED") return { action: "retry", label: "重试失败项", className: "text-blue-600" };
  if (task.status === "COMPLETED" && Number(task.failed_count || 0) > 0) return { action: "retry", label: "重试失败项", className: "text-blue-600" };
  if (["COMPLETED", "CANCELLED"].includes(task.status)) return { action: "archive", label: "归档任务", className: "text-slate-500" };
  return null;
}

export function TaskCenterView({ canViewUsage, canManageSettings, canCreate }:{ canViewUsage:boolean; canManageSettings:boolean; canCreate:boolean }) {
  const router = useRouter();
  const [data, setData] = useState<ResponseBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [pendingAction, setPendingAction] = useState<{ task: AiTask; action: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveSelection,setArchiveSelection]=useState<Set<string>>(new Set());
  const [batchArchiveOpen,setBatchArchiveOpen]=useState(false);
  const [googleDetailsOpen, setGoogleDetailsOpen] = useState(false);
  const [costSummaryOpen, setCostSummaryOpen] = useState(false);
  const [googleBilling, setGoogleBilling] = useState<GoogleBilling | null>(null);
  const [googleBillingLoading, setGoogleBillingLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRequest = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const latestRequest = useRef(0);
  const { toast, node: toastNode } = useToast();
  const load = useCallback(async (quiet = false) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status, search, date_from: dateFrom, date_to: dateTo });
    if (scopeUserId) params.set("user_id", scopeUserId);
    const key = params.toString();
    if (inFlightRequest.current?.key === key) return inFlightRequest.current.promise;
    const requestId = ++latestRequest.current;
    const promise = (async () => {
      if (!quiet) setLoading(true);
      try {
        const response = await fetch(`/api/ai/tasks?${params}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (requestId !== latestRequest.current) return;
        if (!response.ok) { setError(body.error || "任务列表查询失败"); return; }
        setData(body); setError("");
      } catch {
        if (requestId === latestRequest.current) setError("任务列表查询失败，请稍后重试");
      } finally {
        if (requestId === latestRequest.current && !quiet) setLoading(false);
      }
    })();
    inFlightRequest.current = { key, promise };
    try { await promise; } finally {
      if (inFlightRequest.current?.promise === promise) inFlightRequest.current = null;
    }
  }, [page, pageSize, status, search, dateFrom, dateTo, scopeUserId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!Number(data?.counts?.active || 0)) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [load, data?.counts?.active]);
  useEffect(() => {
    if (!Number(data?.counts?.active || 0)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [data?.counts?.active]);
  useEffect(() => {
    setArchiveSelection(new Set());
    setBatchArchiveOpen(false);
  }, [page, pageSize, status, search, dateFrom, dateTo, scopeUserId]);

  async function runAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await fetch(`/api/ai/tasks/${pendingAction.task.id}`, pendingAction.action === "archive" ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: pendingAction.action }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return toast(body.error || "任务操作失败", "error");
    if (["reanalyze_invalid", "reanalyze"].includes(pendingAction.action) && body.task?.id) { toast(pendingAction.action === "reanalyze" ? "全量复核任务已创建，正在进入任务详情" : "复验任务已创建，正在进入任务详情"); router.push(`/ai-screening/tasks/${body.task.id}`); return; }
    toast({ pause: "任务已停止", cancel: "排队任务已取消", resume: "任务已继续执行", retry: "失败客户已重新排队", archive: "任务已归档，历史结果与费用均已保留" }[pendingAction.action] || "操作成功");
    setPendingAction(null); await load(true);
  }

  async function runBatchArchive(){
    if(!archiveSelection.size)return;
    setBusy(true);
    const response=await fetch("/api/ai/tasks/batch",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"archive",task_ids:[...archiveSelection]})});
    const body=await response.json().catch(()=>({}));
    setBusy(false);
    if(!response.ok)return toast(body.error||"批量归档失败","error");
    toast(`已归档 ${body.archived_count||archiveSelection.size} 个任务，历史结果与费用均已保留`);
    setBatchArchiveOpen(false);setArchiveSelection(new Set());await load(true);
  }

  async function openGoogleDetails() {
    setGoogleDetailsOpen(true);
    if (googleBilling || googleBillingLoading) return;
    setGoogleBillingLoading(true);
    try {
      const response = await fetch("/api/cost-center/google-billing", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      setGoogleBilling(response.ok ? body : { state: "ERROR", message: body.error || "Google Places 明细读取失败" });
    } catch { setGoogleBilling({ state: "ERROR", message: "Google Places 明细读取失败，请稍后重试" }); }
    finally { setGoogleBillingLoading(false); }
  }

  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="AI筛选任务中心" description="创建、监控和处理AI筛选任务，查看客户结果与失败重试。" actions={<div className="flex max-w-full flex-wrap items-center justify-end gap-2">
      {canViewUsage ? <TodayUsageLink module="screening" scopeUserId={scopeUserId}/> : null}
      {canManageSettings ? <Link href="/ai-screening/settings" className={`${button} shrink-0`}><Settings2 size={16}/>AI筛选设置</Link> : null}
      {canCreate ? <Link href="/ai-screening/new" className={`${primaryButton} shrink-0`}><Plus size={17}/>创建AI筛选任务</Link> : null}
    </div>}/>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/ai-screening/new" className={`${panel} relative flex items-center gap-3 p-[15px] transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-[#edf4ff] text-[#1763e8]"><Target size={20}/></span><div><p className="text-sm text-[#6f7b8f]">待AI筛选客户</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.pending_customers)}</b><small className="text-[#8b96a7]">条 · 创建筛选任务</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></Link>
      <button onClick={() => { setStatus("ACTIVE"); setPage(1); }} className={`${panel} relative flex items-center gap-3 p-[15px] text-left transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-violet-50 text-violet-600"><Activity size={20}/></span><div><p className="text-sm text-[#6f7b8f]">活动任务</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.counts?.active)}</b><small className="text-[#8b96a7]">执行中 {formatNumber(data?.counts?.running)} · 排队中 {formatNumber(data?.counts?.queued)}</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></button>
      <Link href="/ai-screening/results" className={`${panel} relative flex items-center gap-3 p-[15px] transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-emerald-50 text-emerald-600"><Users size={20}/></span><div><p className="text-sm text-[#6f7b8f]">今日完成客户</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.today_completed_customers)}</b><small className="text-[#8b96a7]">独立历史账本 · 删除客户不变</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></Link>
      <Link href="/ai-screening/failures" className={`${panel} relative flex items-center gap-3 p-[15px] transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-rose-50 text-rose-600"><RotateCcw size={20}/></span><div><p className="text-sm text-[#6f7b8f]">待重试客户</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.retry_customers)}</b><small className="text-[#8b96a7]">查看失败原因并重试</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></Link>
    </section>
    {data?.show_historical_cost_summary ? <section className={`${panel} overflow-hidden`}>
      <button type="button" aria-expanded={costSummaryOpen} aria-controls="screening-cost-summary" onClick={()=>setCostSummaryOpen(open=>!open)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50">
        <span className="min-w-0"><b className="block font-semibold">历史筛选成本</b><span className="mt-1 block truncate text-xs text-slate-500">累计分析 {formatNumber(data?.historical_summary?.processed_customers)} 次 · OpenAI {formatCost(data?.historical_summary?.openai_cost_usd)} · Google {formatNumber(data?.historical_summary?.google_places_call_count)} 次</span></span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-blue-600">{costSummaryOpen?"收起":"查看成本明细"}<ChevronDown size={16} className={`transition ${costSummaryOpen?"rotate-180":""}`}/></span>
      </button>
      {costSummaryOpen?<div id="screening-cost-summary" className="border-t p-4"><p className="mb-3 text-xs text-slate-500">系统全历史累计，不受当前任务列表日期筛选影响；同一客户每完成一次分析计一次。OpenAI仅展示本系统可核验的OpenAI Token费用，最终以服务商账单为准。</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><article className="rounded-lg border bg-slate-50 px-4 py-3"><small className="text-slate-500">累计完成分析</small><b className="mt-1 block text-xl">{formatNumber(data?.historical_summary?.processed_customers)} 次</b><span className="text-xs text-slate-400">按完成的任务客户项计次</span></article><article className="rounded-lg border bg-slate-50 px-4 py-3"><small className="text-slate-500">OpenAI累计费用</small><b className="mt-1 block text-xl">{formatCost(data?.historical_summary?.openai_cost_usd)}</b><span className="text-xs text-slate-400">仅本系统AI筛选Token台账</span></article><article className="rounded-lg border bg-slate-50 px-4 py-3"><small className="text-slate-500">单次分析平均OpenAI费用</small><b className="mt-1 block text-xl">{formatCost(data?.historical_summary?.average_openai_cost_per_customer_usd)}</b><span className="text-xs text-slate-400">OpenAI费用 ÷ 完成分析次数</span></article><button type="button" onClick={()=>void openGoogleDetails()} className="rounded-lg border bg-slate-50 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200"><small className="flex items-center justify-between text-slate-500"><span>Google Places累计调用</span><span className="text-blue-600">查看明细</span></small><b className="mt-1 block text-xl">{formatNumber(data?.historical_summary?.google_places_call_count)} 次</b><span className="text-xs text-slate-400">已使用、剩余、超额与预计费用</span></button></div></div>:null}
    </section> : null}

    <section className={`${panel} overflow-hidden`}>
      <div className="border-b px-5 pt-5"><h2 className="text-lg font-semibold">AI筛选任务</h2><p className="mt-1 text-sm text-slate-500">集中查看当前用户有权限访问的全部历史任务；任务状态通过下方页签切换，避免重复筛选。</p><nav className="mt-4 flex gap-6 overflow-x-auto">{tabs.map(([value, label, key]) => <button key={key} onClick={() => { setStatus(value); setPage(1); }} className={`whitespace-nowrap border-b-2 pb-3 text-sm ${status === value ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-slate-500"}`}>{label} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{formatNumber(data?.counts?.[key])}</span></button>)}</nav></div>
      <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }} className={`grid items-end gap-[10px] border-b p-[14px_16px] ${data?.show_owner ? "xl:grid-cols-[minmax(240px,1.1fr)_minmax(210px,.8fr)_minmax(420px,1.5fr)_auto]" : "xl:grid-cols-[minmax(280px,1.4fr)_minmax(360px,1fr)_auto]"}`}>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-500">任务名称 / 编号</span><input className={`${input} w-full`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索任务名称或任务编号"/></label>
        {data?.show_owner ? <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-500">数据范围</span><UserScopeSelect permission="ai.data_all" value={scopeUserId} initializeDefault={false} onChange={(value) => { setScopeUserId(value); setPage(1); }} className={`${input} w-full`}/></label> : null}
        <fieldset className="min-w-0"><legend className="mb-1.5 text-xs font-medium text-slate-500">创建日期范围</legend><div className="flex h-[38px] items-center overflow-hidden rounded-[7px] border border-[#d8dfe9] bg-white focus-within:border-[#1763e8] focus-within:ring-2 focus-within:ring-blue-100"><CalendarRange className="ml-3 shrink-0 text-slate-400" size={16}/><span className="ml-2 shrink-0 text-xs text-slate-500">开始</span><input type="date" className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none" aria-label="开始日期" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)}/><span className="shrink-0 text-slate-400">至</span><span className="ml-2 shrink-0 text-xs text-slate-500">结束</span><input type="date" className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none" aria-label="结束日期" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)}/></div></fieldset>
        <div className="flex gap-2"><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => void load()}><RefreshCw size={16}/>刷新</button><button type="button" className={button} onClick={() => { setSearchDraft(""); setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setScopeUserId(""); setPage(1); }}>重置</button></div>
      </form>
      {data?.can_archive_tasks&&(data.data||[]).some(task=>["COMPLETED","CANCELLED","FAILED"].includes(task.status))?<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50/70 px-4 py-3"><details className="relative"><summary className={`${button} cursor-pointer list-none`}>勾选指定归档任务（已选 {archiveSelection.size} 个）</summary><div className="absolute left-0 top-11 z-20 max-h-72 w-[min(420px,calc(100vw-3rem))] overflow-y-auto rounded-lg border bg-white p-2 shadow-xl">{(data.data||[]).filter(task=>["COMPLETED","CANCELLED","FAILED"].includes(task.status)).map(task=><label key={task.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-slate-50"><input type="checkbox" className="mt-1 accent-blue-600" checked={archiveSelection.has(task.id)} onChange={event=>setArchiveSelection(current=>{const next=new Set(current);if(event.target.checked)next.add(task.id);else next.delete(task.id);return next})}/><span className="min-w-0"><b className="block truncate text-sm">{task.name}</b><small className="text-slate-400">{task.task_number} · {task.status}</small></span></label>)}</div></details><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>setArchiveSelection(new Set((data.data||[]).filter(task=>["COMPLETED","CANCELLED","FAILED"].includes(task.status)).map(task=>task.id)))}>全选本页可归档任务</button><button type="button" disabled={!archiveSelection.size} className={button} onClick={()=>setBatchArchiveOpen(true)}><Archive size={16}/>批量归档（{archiveSelection.size}）</button></div></div>:null}
      {error ? <ErrorState message={error} reload={() => void load()}/> : loading ? <Loading/> : <div className="overflow-x-auto"><table className="w-full min-w-[1580px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["任务名称 / 编号",...(data?.show_owner?["归属人"]:[]),"分析模式","筛选客户","状态","进度","成功 / 失败","任务耗时","总Token","OpenAI费用","Google调用","平均每位客户","创建时间","操作"].map((value) => <th key={value} className="px-4 py-3 font-medium">{value}</th>)}</tr></thead><tbody>{(data?.data || []).map((task) => { const itemControl = control(task); const processed = Number(task.processed_count || task.success_count + task.failed_count); const openAiCost = Number(task.openai_cost_usd ?? task.total_cost_usd); const avgTokens = processed ? task.total_tokens / processed : 0; const avgOpenAiCost = processed ? openAiCost / processed : 0; const progress = task.total_count ? Math.min(100, processed / task.total_count * 100) : 0; const hasSecondaryActions = task.status === "COMPLETED" || ["COMPLETED", "CANCELLED", "FAILED"].includes(task.status) || Boolean(itemControl); return <tr key={task.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/ai-screening/tasks/${task.id}`)}} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/30"><td className="px-4 py-3"><b className="block font-medium text-slate-900">{task.name}</b><span className="mt-1 block text-xs text-slate-400">{task.task_number}</span></td>{data?.show_owner?<td className="px-4 py-3"><b className="block font-medium">{task.owner?.name||"未命名用户"}</b><small className="text-slate-400">{task.owner?.email||"—"}</small></td>:null}<td className="px-4 py-3"><CostModeBadge mode={task.cost_mode}/>{task.task_cost_limit_usd!=null?<small className="mt-1 block text-slate-400">任务上限 {formatCost(task.task_cost_limit_usd)}</small>:null}</td><td className="px-4 py-3">{formatNumber(task.total_count)} 条</td><td className="px-4 py-3"><StatusBadge status={task.status}/></td><td className="w-40 px-4 py-3"><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }}/></div><span className="mt-1 block text-xs text-slate-400">{formatNumber(processed)} / {formatNumber(task.total_count)}</span></td><td className="px-4 py-3 whitespace-nowrap"><b className="font-medium text-emerald-600">{formatNumber(task.success_count)}</b><span className="mx-1.5 text-slate-300">/</span><b className="font-medium text-rose-600">{formatNumber(task.failed_count)}</b></td><td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDuration(effectiveElapsedMs(task, now))}</td><td className="px-4 py-3">{formatTokens(task.total_tokens)}</td><td className="px-4 py-3">{formatCost(openAiCost)}</td><td className="px-4 py-3 whitespace-nowrap">{formatNumber(task.google_places_call_count)} 次</td><td className="px-4 py-3"><span className="block">{formatTokens(avgTokens)} Token</span><small className="text-slate-400">OpenAI {formatCost(avgOpenAiCost)}</small></td><td className="px-4 py-3 text-slate-500">{new Date(task.created_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><div className="flex items-center gap-2 whitespace-nowrap"><Link href={`/ai-screening/tasks/${task.id}`} className="font-medium text-blue-600">查看详情</Link>{hasSecondaryActions ? <RowActionMenu ariaLabel={`${task.name}操作菜单`}><>{task.status === "COMPLETED" ? <RowActionItem onClick={() => router.push(`/ai-screening/tasks/${task.id}/report`)}>查看报告</RowActionItem> : null}{["COMPLETED","CANCELLED","FAILED"].includes(task.status) ? <RowActionItem onClick={() => setPendingAction({ task, action: "reanalyze_invalid" })}>复验无效目标</RowActionItem> : null}{["COMPLETED","FAILED"].includes(task.status) ? <RowActionItem onClick={() => setPendingAction({ task, action: "reanalyze" })}>全量复核</RowActionItem> : null}{itemControl ? <RowActionItem tone={itemControl.className.includes("rose") ? "danger" : "default"} onClick={() => setPendingAction({ task, action: itemControl.action })}>{itemControl.label}</RowActionItem> : null}</></RowActionMenu> : null}</div></td></tr>; })}</tbody></table>{!data?.data.length ? <div className="p-14 text-center text-sm text-slate-400">暂无符合条件的AI筛选任务</div> : null}</div>}
      <Pagination page={page} pageSize={pageSize} total={data?.count || 0} itemLabel="个任务" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
    </section>
  </div>{toastNode}{googleDetailsOpen?<AppDialog title="Google Places 结算月调用明细" description="AI筛选与AI获客按系统调用账本独立统计；平台已确认和免费额度属于同一Google结算账号，仅用于判断共享额度及超额风险，最终费用以Google账单为准。" onClose={()=>setGoogleDetailsOpen(false)} width="max-w-7xl">{googleBillingLoading?<Loading/>:googleBilling?.state==="CONNECTED"?<div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["SKU","AI筛选记录","AI获客记录","平台已确认总量","待平台同步","预计账号总量","免费上限","剩余 / 已超","超额预计费用"].map(item=><th key={item} className="px-3 py-3 font-medium">{item}</th>)}</tr></thead><tbody>{googleBilling.skuUsage?.map(item=>{const exceeded=Number(item.projectedOverageCalls||0)>0;return <tr key={item.key} className="border-t"><td className="px-3 py-3 font-medium">{item.label}</td><td className="bg-blue-50/50 px-3 py-3 font-semibold text-blue-700">{formatNumber(item.screeningSystemUsage)} 次<small className="mt-1 block font-normal text-blue-500">系统记账 {formatCost(item.screeningSystemCostUsd)}</small></td><td className="px-3 py-3">{formatNumber(item.acquisitionSystemUsage)} 次<small className="mt-1 block text-slate-400">系统记账 {formatCost(item.acquisitionSystemCostUsd)}</small></td><td className="px-3 py-3">{formatNumber(item.usageCount)} 次</td><td className="px-3 py-3">{formatNumber(item.pendingSystemUsage)} 次</td><td className="px-3 py-3 font-medium">{formatNumber(item.projectedUsage)} 次</td><td className="px-3 py-3">{item.freeLimit==null?"不限量":formatNumber(item.freeLimit)}</td><td className={`px-3 py-3 font-medium ${exceeded?"text-rose-600":"text-emerald-700"}`}>{item.freeLimit==null?"不限量":exceeded?`已超 ${formatNumber(item.projectedOverageCalls)} 次`:`剩余 ${formatNumber(item.projectedRemaining)} 次`}</td><td className={`px-3 py-3 font-medium ${Number(item.projectedOverageCostUsd||0)>0?"text-rose-600":"text-slate-500"}`}>{formatCost(item.projectedOverageCostUsd)}</td></tr>})}</tbody></table></div>:<p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{googleBilling?.message||"正在读取 Google Places 明细"}</p>}<div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">AI筛选记录只统计普通筛选任务；由AI获客候选触发的后续Google核验归入AI获客。</div><div className="mt-5 flex justify-end border-t pt-4"><button type="button" onClick={()=>setGoogleDetailsOpen(false)} className={button}>关闭</button></div></AppDialog>:null}<ConfirmDialog open={Boolean(pendingAction)} title={pendingAction ? actionCopy[pendingAction.action]?.title || "确认操作" : ""} description={pendingAction ? actionCopy[pendingAction.action]?.description || "" : ""} confirmLabel={pendingAction ? actionCopy[pendingAction.action]?.confirm || "确认" : "确认"} busy={busy} onClose={() => setPendingAction(null)} onConfirm={() => void runAction()}/><ConfirmDialog open={batchArchiveOpen} title={`归档 ${archiveSelection.size} 个任务？`} description="归档后任务从任务中心隐藏，但客户结果、分析依据、Token及费用账本全部保留。任一任务不符合条件时整批不会执行。" confirmLabel="确认批量归档" busy={busy} onClose={()=>setBatchArchiveOpen(false)} onConfirm={()=>void runBatchArchive()}/></main>;
}
