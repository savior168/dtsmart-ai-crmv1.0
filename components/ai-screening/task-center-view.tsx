"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, CircleDollarSign, Plus, RefreshCw, RotateCcw, Target, Users } from "lucide-react";
import type { AiTask } from "@/components/ai-screening/types";
import { ConfirmDialog, ErrorState, Loading, PageHeader, Pagination, StatusBadge, StrategyBadge, button, formatCost, formatNumber, formatTokens, panel, primaryButton, input, useToast } from "@/components/ai-screening/ui";

type ResponseBody = {
  data: AiTask[]; count: number; counts: Record<string, number>; today_cost: number; today_completed_customers: number; today_failed_customers: number;
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
};

function control(task: AiTask) {
  if (task.status === "RUNNING") return { action: "pause", label: "停止任务", className: "text-rose-600" };
  if (task.status === "QUEUED") return { action: "cancel", label: "取消任务", className: "text-rose-600" };
  if (task.status === "PAUSED") return { action: "resume", label: "继续执行", className: "text-emerald-600" };
  if (task.status === "FAILED") return { action: "retry", label: "重试失败项", className: "text-blue-600" };
  return null;
}

export function TaskCenterView() {
  const [data, setData] = useState<ResponseBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<{ task: AiTask; action: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, node: toastNode } = useToast();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const response = await fetch(`/api/ai/tasks?page=${page}&pageSize=${pageSize}&status=${status}&search=${encodeURIComponent(search)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!quiet) setLoading(false);
    if (!response.ok) { setError(body.error || "任务列表查询失败"); return; }
    setData(body); setError("");
  }, [page, pageSize, status, search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = setInterval(() => void load(true), 15000); return () => clearInterval(timer); }, [load]);

  async function runAction() {
    if (!pendingAction) return;
    setBusy(true);
    const response = await fetch(`/api/ai/tasks/${pendingAction.task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: pendingAction.action }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return toast(body.error || "任务操作失败", "error");
    toast({ pause: "任务已停止", cancel: "排队任务已取消", resume: "任务已继续执行", retry: "失败客户已重新排队" }[pendingAction.action] || "操作成功");
    setPendingAction(null); await load(true);
  }

  return <main className="min-h-full bg-[#f5f7fb] p-5 lg:p-6"><div className="mx-auto max-w-[1680px] space-y-5">
    <PageHeader title="AI筛选任务中心" description="创建、监控和处理AI筛选任务，查看客户结果与失败重试。" actions={<>
      <Link href="/ai-screening/usage" className={button}><CircleDollarSign size={16}/>今日费用 {formatCost(data?.today_cost)}</Link>
      <button className={button} onClick={() => void load()}><RefreshCw size={16}/>刷新状态</button>
      <Link href="/ai-screening/new" className={primaryButton}><Plus size={17}/>创建AI筛选任务</Link>
    </>}/>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/ai-screening/new" className={`${panel} flex items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-600"><Target/></span><div><p className="text-sm text-slate-500">待AI筛选客户</p><b className="mt-1 block text-2xl text-slate-950">创建任务查询</b><small className="text-slate-400">筛选并选择待分析客户</small></div></Link>
      <button onClick={() => { setStatus("ACTIVE"); setPage(1); }} className={`${panel} flex items-center gap-4 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-12 w-12 place-items-center rounded-xl bg-violet-50 text-violet-600"><Activity/></span><div><p className="text-sm text-slate-500">活动任务</p><b className="mt-1 block text-2xl text-slate-950">{formatNumber(data?.counts?.active)}</b><small className="text-slate-400">执行中 {formatNumber(data?.counts?.running)} · 排队中 {formatNumber(data?.counts?.queued)}</small></div></button>
      <Link href="/ai-screening/results" className={`${panel} flex items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Users/></span><div><p className="text-sm text-slate-500">今日完成客户</p><b className="mt-1 block text-2xl text-slate-950">{formatNumber(data?.today_completed_customers)}</b><small className="text-slate-400">失败 {formatNumber(data?.today_failed_customers)} · 已写回客户档案</small></div></Link>
      <Link href="/ai-screening/failures" className={`${panel} flex items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:border-blue-300`}><span className="grid h-12 w-12 place-items-center rounded-xl bg-rose-50 text-rose-600"><RotateCcw/></span><div><p className="text-sm text-slate-500">待重试客户</p><b className="mt-1 block text-2xl text-slate-950">{formatNumber(data?.today_failed_customers)}</b><small className="text-slate-400">查看真实原因并重试</small></div></Link>
    </section>

    <section className={`${panel} overflow-hidden`}>
      <div className="border-b px-5 pt-5"><h2 className="text-lg font-semibold">AI筛选任务</h2><p className="mt-1 text-sm text-slate-500">集中查看当前用户有权限访问的全部历史任务。</p><nav className="mt-4 flex gap-6 overflow-x-auto">{tabs.map(([value, label, key]) => <button key={key} onClick={() => { setStatus(value); setPage(1); }} className={`whitespace-nowrap border-b-2 pb-3 text-sm ${status === value ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-slate-500"}`}>{label} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{formatNumber(data?.counts?.[key])}</span></button>)}</nav></div>
      <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }} className="flex flex-wrap gap-3 border-b p-4"><input className={`${input} min-w-64 flex-1`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索任务名称或任务编号"/><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => { setSearchDraft(""); setSearch(""); setStatus(""); setPage(1); }}>重置</button></form>
      {error ? <ErrorState message={error} reload={() => void load()}/> : loading ? <Loading/> : <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["任务名称 / 编号","分析策略","筛选客户","状态","进度","总Token","费用","平均每位客户","创建时间","操作"].map((value) => <th key={value} className="px-4 py-3 font-medium">{value}</th>)}</tr></thead><tbody>{(data?.data || []).map((task) => { const itemControl = control(task); const processed = Number(task.processed_count || task.success_count + task.failed_count); const avgTokens = processed ? task.total_tokens / processed : 0; const avgCost = processed ? Number(task.total_cost_usd) / processed : 0; const progress = task.total_count ? Math.min(100, processed / task.total_count * 100) : 0; return <tr key={task.id} className="border-t border-slate-100 hover:bg-blue-50/30"><td className="px-4 py-3"><b className="block font-medium text-slate-900">{task.name}</b><span className="mt-1 block text-xs text-slate-400">{task.task_number}</span></td><td className="px-4 py-3"><StrategyBadge strategy={task.strategy}/></td><td className="px-4 py-3">{formatNumber(task.total_count)} 条</td><td className="px-4 py-3"><StatusBadge status={task.status}/></td><td className="w-44 px-4 py-3"><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }}/></div><span className="mt-1 block text-xs text-slate-400">{formatNumber(processed)} / {formatNumber(task.total_count)}</span></td><td className="px-4 py-3">{formatTokens(task.total_tokens)}</td><td className="px-4 py-3">{formatCost(task.total_cost_usd)}</td><td className="px-4 py-3">{formatTokens(avgTokens)} / {formatCost(avgCost)}</td><td className="px-4 py-3 text-slate-500">{new Date(task.created_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><div className="flex items-center gap-3 whitespace-nowrap"><Link href={`/ai-screening/tasks/${task.id}`} className="font-medium text-blue-600">查看详情</Link>{task.status === "COMPLETED" ? <Link href={`/ai-screening/tasks/${task.id}/report`} className="font-medium text-blue-600">查看报告</Link> : null}{itemControl ? <button className={`font-medium ${itemControl.className}`} onClick={() => setPendingAction({ task, action: itemControl.action })}>{itemControl.label}</button> : null}</div></td></tr>; })}</tbody></table>{!data?.data.length ? <div className="p-14 text-center text-sm text-slate-400">暂无符合条件的AI筛选任务</div> : null}</div>}
      <Pagination page={page} pageSize={pageSize} total={data?.count || 0} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
    </section>
  </div>{toastNode}<ConfirmDialog open={Boolean(pendingAction)} title={pendingAction ? actionCopy[pendingAction.action]?.title || "确认操作" : ""} description={pendingAction ? actionCopy[pendingAction.action]?.description || "" : ""} confirmLabel={pendingAction ? actionCopy[pendingAction.action]?.confirm || "确认" : "确认"} busy={busy} onClose={() => setPendingAction(null)} onConfirm={() => void runAction()}/></main>;
}
