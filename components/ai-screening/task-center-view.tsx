"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { Activity, BarChart3, CalendarRange, ChevronRight, Plus, RefreshCw, RotateCcw, Target, Users } from "lucide-react";
import type { AiTask } from "@/components/ai-screening/types";
import { ConfirmDialog, ErrorState, Loading, PageHeader, Pagination, StatusBadge, StrategyBadge, button, effectiveElapsedMs, formatCost, formatDuration, formatNumber, formatTokens, panel, primaryButton, input, useToast } from "@/components/ai-screening/ui";
import { UserScopeSelect } from "@/components/user-scope-select";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";

function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}

type ResponseBody = {
  data: AiTask[]; count: number; counts: Record<string, number>; pending_customers: number; today_cost: number; today_completed_customers: number; today_failed_customers: number; retry_customers: number; show_owner?: boolean;
  historical_summary?: { processed_customers:number; total_third_party_cost_usd:number; average_cost_per_customer_usd:number; provider_costs:Record<string,number> };
};

const tabs = [
  ["", "全部任务", "all"], ["ACTIVE", "活动任务", "active"], ["RUNNING", "执行中", "running"],
  ["QUEUED", "排队中", "queued"], ["COMPLETED", "已完成", "completed"], ["FAILED", "失败", "failed"],
] as const;

const actionCopy: Record<string, { title: string; description: string; confirm: string }> = {
  pause: { title: "停止任务？", description: "停止后不再领取新的客户分析；当前单条客户完成后暂停。已完成结果永久保留，继续执行时只处理未完成客户。", confirm: "确认停止" },
  cancel: { title: "取消排队任务？", description: "任务尚未执行，取消后退出等待队列，不分析客户且不产生OpenAI费用。", confirm: "确认取消" },
  resume: { title: "继续执行任务？", description: "任务从停止位置继续，只分析未完成客户；已完成客户不会重复分析。", confirm: "继续执行" },
  retry: { title: "重试失败客户？", description: "仅重新分析失败客户，已完成结果不会重复分析或重复计费。", confirm: "确认重试" },
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

export function TaskCenterView() {
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
  const [now, setNow] = useState(() => Date.now());
  const { toast, node: toastNode } = useToast();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status, search, date_from: dateFrom, date_to: dateTo });
    if (scopeUserId) params.set("user_id", scopeUserId);
    const response = await fetch(`/api/ai/tasks?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!quiet) setLoading(false);
    if (!response.ok) { setError(body.error || "任务列表查询失败"); return; }
    setData(body); setError("");
  }, [page, pageSize, status, search, dateFrom, dateTo, scopeUserId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!Number(data?.counts?.active || 0)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [data?.counts?.active]);

  async function runAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await fetch(`/api/ai/tasks/${pendingAction.task.id}`, pendingAction.action === "archive" ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: pendingAction.action }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return toast(body.error || "任务操作失败", "error");
    toast({ pause: "任务已停止", cancel: "排队任务已取消", resume: "任务已继续执行", retry: "失败客户已重新排队", archive: "任务已归档，历史结果与费用均已保留" }[pendingAction.action] || "操作成功");
    setPendingAction(null); await load(true);
  }

  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="AI筛选任务中心" description="创建、监控和处理AI筛选任务，查看客户结果与失败重试。" actions={<>
      <Link href="/ai-screening/usage" className="group inline-flex h-[42px] items-center gap-3 rounded-[8px] border border-blue-200 bg-blue-50 px-3.5 text-left text-blue-700 transition hover:border-blue-400 hover:bg-blue-100" title="查看AI筛选Token与费用明细"><span className="grid h-7 w-7 place-items-center rounded-md bg-white text-blue-600 shadow-sm"><BarChart3 size={16}/></span><span className="leading-tight"><b className="block text-[13px] font-semibold">查看AI筛选用量</b><small className="text-[11px] text-blue-500">今日 {formatCost(data?.today_cost)}</small></span><ChevronRight size={15} className="transition group-hover:translate-x-0.5"/></Link>
      <button className={button} onClick={() => void load()}><RefreshCw size={16}/>刷新状态</button>
      <Link href="/ai-screening/new" className={primaryButton}><Plus size={17}/>创建AI筛选任务</Link>
    </>}/>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/ai-screening/new" className={`${panel} relative flex items-center gap-3 p-[15px] transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-[#edf4ff] text-[#1763e8]"><Target size={20}/></span><div><p className="text-sm text-[#6f7b8f]">待AI筛选客户</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.pending_customers)}</b><small className="text-[#8b96a7]">条 · 创建筛选任务</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></Link>
      <button onClick={() => { setStatus("ACTIVE"); setPage(1); }} className={`${panel} relative flex items-center gap-3 p-[15px] text-left transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-violet-50 text-violet-600"><Activity size={20}/></span><div><p className="text-sm text-[#6f7b8f]">活动任务</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.counts?.active)}</b><small className="text-[#8b96a7]">执行中 {formatNumber(data?.counts?.running)} · 排队中 {formatNumber(data?.counts?.queued)}</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></button>
      <Link href="/ai-screening/results" className={`${panel} relative flex items-center gap-3 p-[15px] transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-emerald-50 text-emerald-600"><Users size={20}/></span><div><p className="text-sm text-[#6f7b8f]">今日完成客户</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.today_completed_customers)}</b><small className="text-[#8b96a7]">独立历史账本 · 删除客户不变</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></Link>
      <Link href="/ai-screening/failures" className={`${panel} relative flex items-center gap-3 p-[15px] transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-rose-50 text-rose-600"><RotateCcw size={20}/></span><div><p className="text-sm text-[#6f7b8f]">待重试客户</p><b className="mt-[3px] block text-2xl font-semibold">{formatNumber(data?.retry_customers)}</b><small className="text-[#8b96a7]">查看失败原因并重试</small></div><span className="absolute right-4 text-xl text-slate-400">›</span></Link>
    </section>
    <section className={`${panel} p-4`}><div className="mb-3"><h2 className="font-semibold">历史筛选成本总览</h2><p className="mt-1 text-xs text-slate-500">来自不可变第三方API费用台账，包含OpenAI、Google Places及后续接入的分析服务。</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["累计完成分析",`${formatNumber(data?.historical_summary?.processed_customers)} 条`,"历史客户分析次数"],["第三方总费用",formatCost(data?.historical_summary?.total_third_party_cost_usd),"全部分析API"],["单客户平均费用",formatCost(data?.historical_summary?.average_cost_per_customer_usd),"总费用 ÷ 完成数"],["OpenAI费用",formatCost(data?.historical_summary?.provider_costs?.OPENAI),"模型分析"],["Google Places费用",formatCost(data?.historical_summary?.provider_costs?.GOOGLE_PLACES),"Google各SKU合计"]].map(([label,value,sub])=><article key={label} className="rounded-lg border bg-slate-50 px-4 py-3"><small className="text-slate-500">{label}</small><b className="mt-1 block text-xl">{value}</b><span className="text-xs text-slate-400">{sub}</span></article>)}</div></section>

    <section className={`${panel} overflow-hidden`}>
      <div className="border-b px-5 pt-5"><h2 className="text-lg font-semibold">AI筛选任务</h2><p className="mt-1 text-sm text-slate-500">集中查看当前用户有权限访问的全部历史任务；任务状态通过下方页签切换，避免重复筛选。</p><nav className="mt-4 flex gap-6 overflow-x-auto">{tabs.map(([value, label, key]) => <button key={key} onClick={() => { setStatus(value); setPage(1); }} className={`whitespace-nowrap border-b-2 pb-3 text-sm ${status === value ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-slate-500"}`}>{label} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{formatNumber(data?.counts?.[key])}</span></button>)}</nav></div>
      <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }} className={`grid items-end gap-[10px] border-b p-[14px_16px] ${data?.show_owner ? "xl:grid-cols-[minmax(240px,1.1fr)_minmax(210px,.8fr)_minmax(420px,1.5fr)_auto]" : "xl:grid-cols-[minmax(280px,1.4fr)_minmax(360px,1fr)_auto]"}`}>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-500">任务名称 / 编号</span><input className={`${input} w-full`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索任务名称或任务编号"/></label>
        {data?.show_owner ? <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-500">数据范围</span><UserScopeSelect permission="ai.data_all" value={scopeUserId} onChange={(value) => { setScopeUserId(value); setPage(1); }} className={`${input} w-full`}/></label> : null}
        <fieldset className="min-w-0"><legend className="mb-1.5 text-xs font-medium text-slate-500">创建日期范围</legend><div className="flex h-[38px] items-center overflow-hidden rounded-[7px] border border-[#d8dfe9] bg-white focus-within:border-[#1763e8] focus-within:ring-2 focus-within:ring-blue-100"><CalendarRange className="ml-3 shrink-0 text-slate-400" size={16}/><span className="ml-2 shrink-0 text-xs text-slate-500">开始</span><input type="date" className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none" aria-label="开始日期" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)}/><span className="shrink-0 text-slate-400">至</span><span className="ml-2 shrink-0 text-xs text-slate-500">结束</span><input type="date" className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none" aria-label="结束日期" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)}/></div></fieldset>
        <div className="flex gap-2"><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => { setSearchDraft(""); setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setScopeUserId(""); setPage(1); }}>重置</button></div>
      </form>
      {error ? <ErrorState message={error} reload={() => void load()}/> : loading ? <Loading/> : <div className="overflow-x-auto"><table className="w-full min-w-[1540px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["任务名称 / 编号",...(data?.show_owner?["归属人"]:[]),"分析策略","筛选客户","状态","进度","成功 / 失败","任务耗时","总Token","第三方费用","平均每位客户","创建时间","操作"].map((value) => <th key={value} className="px-4 py-3 font-medium">{value}</th>)}</tr></thead><tbody>{(data?.data || []).map((task) => { const itemControl = control(task); const processed = Number(task.processed_count || task.success_count + task.failed_count); const taskCost = Number(task.third_party_cost_usd ?? task.total_cost_usd); const avgTokens = processed ? task.total_tokens / processed : 0; const avgCost = processed ? taskCost / processed : 0; const progress = task.total_count ? Math.min(100, processed / task.total_count * 100) : 0; return <tr key={task.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/ai-screening/tasks/${task.id}`)}} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/30"><td className="px-4 py-3"><b className="block font-medium text-slate-900">{task.name}</b><span className="mt-1 block text-xs text-slate-400">{task.task_number}</span></td>{data?.show_owner?<td className="px-4 py-3"><b className="block font-medium">{task.owner?.name||"未命名用户"}</b><small className="text-slate-400">{task.owner?.email||"—"}</small></td>:null}<td className="px-4 py-3"><StrategyBadge strategy={task.strategy}/></td><td className="px-4 py-3">{formatNumber(task.total_count)} 条</td><td className="px-4 py-3"><StatusBadge status={task.status}/></td><td className="w-40 px-4 py-3"><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }}/></div><span className="mt-1 block text-xs text-slate-400">{formatNumber(processed)} / {formatNumber(task.total_count)}</span></td><td className="px-4 py-3 whitespace-nowrap"><b className="font-medium text-emerald-600">{formatNumber(task.success_count)}</b><span className="mx-1.5 text-slate-300">/</span><b className="font-medium text-rose-600">{formatNumber(task.failed_count)}</b></td><td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDuration(effectiveElapsedMs(task, now))}</td><td className="px-4 py-3">{formatTokens(task.total_tokens)}</td><td className="px-4 py-3">{formatCost(taskCost)}</td><td className="px-4 py-3">{formatTokens(avgTokens)} / {formatCost(avgCost)}</td><td className="px-4 py-3 text-slate-500">{new Date(task.created_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><div className="flex items-center gap-3 whitespace-nowrap"><Link href={`/ai-screening/tasks/${task.id}`} className="font-medium text-blue-600">查看详情</Link>{task.status === "COMPLETED" ? <Link href={`/ai-screening/tasks/${task.id}/report`} className="font-medium text-blue-600">查看报告</Link> : null}{itemControl ? <button className={`font-medium ${itemControl.className}`} onClick={() => setPendingAction({ task, action: itemControl.action })}>{itemControl.label}</button> : null}</div></td></tr>; })}</tbody></table>{!data?.data.length ? <div className="p-14 text-center text-sm text-slate-400">暂无符合条件的AI筛选任务</div> : null}</div>}
      <Pagination page={page} pageSize={pageSize} total={data?.count || 0} itemLabel="个任务" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
    </section>
  </div>{toastNode}<ConfirmDialog open={Boolean(pendingAction)} title={pendingAction ? actionCopy[pendingAction.action]?.title || "确认操作" : ""} description={pendingAction ? actionCopy[pendingAction.action]?.description || "" : ""} confirmLabel={pendingAction ? actionCopy[pendingAction.action]?.confirm || "确认" : "确认"} busy={busy} onClose={() => setPendingAction(null)} onConfirm={() => void runAction()}/></main>;
}
