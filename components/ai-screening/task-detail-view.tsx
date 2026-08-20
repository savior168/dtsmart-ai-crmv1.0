"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AiTask, TaskItem } from "@/components/ai-screening/types";
import { ConfirmDialog, ErrorState, Loading, PageHeader, Pagination, StatusBadge, StrategyBadge, button, formatCost, formatNumber, formatTokens, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";

const stepLabels: Record<string, string> = { WAITING: "等待分析", COLLECTING_EVIDENCE: "读取公开渠道证据", ANALYZING: "OpenAI结构化分析", WRITTEN_BACK: "结果已写回客户档案", FAILED: "分析失败" };
const actionCopy: Record<string, { label: string; title: string; description: string }> = {
  pause: { label: "停止任务", title: "停止任务？", description: "当前单条客户完成后暂停；已完成结果永久保留。" },
  cancel: { label: "取消任务", title: "取消排队任务？", description: "取消后退出等待队列，不执行分析也不产生费用。" },
  resume: { label: "继续执行", title: "继续执行任务？", description: "只继续分析尚未完成的客户。" },
  retry: { label: "重试失败项", title: "重试失败客户？", description: "仅重试失败客户，已完成客户不会重复分析。" },
};

function actionFor(status?: string) { return status === "RUNNING" ? "pause" : status === "QUEUED" ? "cancel" : status === "PAUSED" ? "resume" : status === "FAILED" ? "retry" : null; }

export function TaskDetailView({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AiTask | null>(null);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, node } = useToast();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [taskResponse, itemsResponse] = await Promise.all([
      fetch(`/api/ai/tasks/${taskId}`, { cache: "no-store" }),
      fetch(`/api/ai/tasks/${taskId}/items?page=${page}&pageSize=${pageSize}&status=${status}&search=${encodeURIComponent(search)}`, { cache: "no-store" }),
    ]);
    const taskBody = await taskResponse.json().catch(() => ({}));
    const itemsBody = await itemsResponse.json().catch(() => ({}));
    if (!quiet) setLoading(false);
    if (!taskResponse.ok || !itemsResponse.ok) { setError(taskBody.error || itemsBody.error || "任务详情查询失败"); return; }
    setTask(taskBody.task); setItems(itemsBody.data || []); setCount(itemsBody.count || 0); setError("");
  }, [taskId, page, pageSize, status, search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!task || !["QUEUED", "RUNNING", "PAUSED"].includes(task.status)) return; const timer = setInterval(() => void load(true), 8000); return () => clearInterval(timer); }, [task, load]);
  const currentAction = actionFor(task?.status);
  const processed = Number(task?.processed_count || 0);
  const remaining = Math.max(0, Number(task?.total_count || 0) - processed);
  const averageTokens = processed ? Number(task?.total_tokens || 0) / processed : 0;
  const averageCost = processed ? Number(task?.total_cost_usd || 0) / processed : 0;

  async function runAction() {
    if (!confirm) return;
    setBusy(true);
    const response = await fetch(`/api/ai/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: confirm }) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return toast(body.error || "任务操作失败", "error");
    setConfirm(null); toast("任务状态已更新"); await load(true);
  }

  if (loading && !task) return <main className="min-h-full bg-[#f5f7fb] p-6"><Loading/></main>;
  return <main className="min-h-full bg-[#f5f7fb] p-5 lg:p-6"><div className="mx-auto max-w-[1680px] space-y-5">
    <PageHeader title={task?.name || "AI筛选任务详情"} description={`任务编号 ${task?.task_number || "-"} · ${task?.strategy === "DEEP" ? "深度分析" : "智能分析"} v1.0 · 创建于 ${task?.created_at ? new Date(task.created_at).toLocaleString("zh-CN") : "-"}`} actions={<><Link href="/ai-screening" className={button}>返回任务中心</Link><Link href={`/ai-screening/tasks/${taskId}/report`} className={primaryButton}>查看任务报告</Link>{currentAction ? <button className={button} onClick={() => setConfirm(currentAction)}>{actionCopy[currentAction].label}</button> : null}</>}/>
    {error ? <ErrorState message={error} reload={() => void load()}/> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[
      ["任务状态", <StatusBadge key="status" status={task?.status || ""}/>, <StrategyBadge key="strategy" strategy={task?.strategy || "SMART"}/>],
      ["已完成分析", formatNumber(processed), `占任务总量${task?.total_count ? (processed / task.total_count * 100).toFixed(1) : 0}%`],
      ["剩余待分析", formatNumber(remaining), `排队与处理中客户`],
      ["完成结果", `${formatNumber(task?.success_count)} / ${formatNumber(task?.failed_count)}`, "成功 / 失败"],
      ["当前总消耗", `${formatTokens(task?.total_tokens)} / ${formatCost(task?.total_cost_usd)}`, "Token / 实际费用"],
      ["平均每位消耗", `${formatTokens(averageTokens)} / ${formatCost(averageCost)}`, "Token / 客户费用"],
    ].map(([label,value,sub]) => <article key={String(label)} className={`${panel} p-4`}><p className="text-xs text-slate-500">{label}</p><div className="mt-2 min-h-7 text-xl font-semibold text-slate-950">{value}</div><div className="mt-1 text-xs text-slate-400">{sub}</div></article>)}</section>
    <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">任务处理队列</h2><p className="mt-1 text-sm text-slate-500">手动刷新或每8秒自动刷新状态；状态刷新不会调用OpenAI，也不会增加Token。</p></div><form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }} className="flex flex-wrap gap-3 border-b p-4"><input className={`${input} min-w-64 flex-1`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索客户名称、邮箱或电话"/><select className={input} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部处理状态</option><option value="PENDING">等待分析</option><option value="RUNNING">分析中</option><option value="COMPLETED">已完成</option><option value="FAILED">分析失败</option></select><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => { setSearchDraft(""); setSearch(""); setStatus(""); setPage(1); }}>重置</button><button type="button" className={button} onClick={() => void load()}><RefreshCw size={16}/>刷新状态</button></form>
      {loading ? <Loading/> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["客户名称","处理状态","当前步骤","最近更新","重试","Token / 费用","操作"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-4 py-3"><b className="font-medium">{item.customer?.company_name || "-"}</b><small className="mt-1 block text-slate-400">{item.customer?.email || item.customer?.phone || "-"}</small></td><td className="px-4 py-3"><StatusBadge status={item.status}/></td><td className="px-4 py-3">{stepLabels[item.current_step] || item.current_step || "-"}</td><td className="px-4 py-3 text-slate-500">{new Date(item.updated_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3">{item.attempt_count} / {item.max_attempts}</td><td className="px-4 py-3">{formatTokens(item.total_tokens)} / {formatCost(item.cost_usd)}</td><td className="px-4 py-3">{item.status === "COMPLETED" ? <Link className="font-medium text-blue-600" href={`/ai-screening/customers/${item.customer_id}/evidence?task=${taskId}`}>查看分析依据</Link> : item.status === "FAILED" ? <Link className="font-medium text-rose-600" href={`/ai-screening/failures?task_id=${taskId}`}>查看原因并重试</Link> : <span className="text-slate-400">处理中</span>}</td></tr>)}</tbody></table>{!items.length ? <div className="p-12 text-center text-sm text-slate-400">当前筛选条件下没有客户</div> : null}</div>}<Pagination page={page} pageSize={pageSize} total={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/></section>
  </div>{node}<ConfirmDialog open={Boolean(confirm)} title={confirm ? actionCopy[confirm].title : ""} description={confirm ? actionCopy[confirm].description : ""} confirmLabel={confirm ? actionCopy[confirm].label : "确认"} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void runAction()}/></main>;
}

