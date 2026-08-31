"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AiTask, TaskItem } from "@/components/ai-screening/types";
import { ConfirmDialog, ErrorState, Loading, PageHeader, Pagination, StatusBadge, StrategyBadge, button, effectiveElapsedMs, formatCost, formatDuration, formatNumber, formatTokens, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";
import { aiErrorCodeLabel, aiErrorMessageZh, aiStepLabel } from "@/components/ai-screening/localization";

const actionCopy: Record<string, { label: string; title: string; description: string }> = {
  pause: { label: "停止任务", title: "停止任务？", description: "当前单条客户完成后暂停；已完成结果永久保留。" },
  cancel: { label: "取消任务", title: "取消排队任务？", description: "取消后退出等待队列，不执行分析也不产生费用。" },
  resume: { label: "继续执行", title: "继续执行任务？", description: "只继续分析尚未完成的客户。" },
  retry: { label: "重试失败项", title: "重试失败客户？", description: "仅重试失败客户，已完成客户不会重复分析。" },
};

function actionFor(task?: AiTask | null) { const status = task?.status; return ["RUNNING", "PAUSING"].includes(String(status)) ? "pause" : status === "QUEUED" ? "cancel" : status === "PAUSED" ? "resume" : status === "FAILED" || (status === "COMPLETED" && Number(task?.failed_count || 0) > 0) ? "retry" : null; }

export function TaskDetailView({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AiTask | null>(null);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [step, setStep] = useState("");
  const [retryState, setRetryState] = useState("");
  const [industry, setIndustry] = useState("");
  const [target, setTarget] = useState("");
  const [grade, setGrade] = useState("");
  const [industryOptions, setIndustryOptions] = useState<string[]>([]);
  const [refreshMs, setRefreshMs] = useState(10000);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { toast, node } = useToast();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [taskResponse, itemsResponse] = await Promise.all([
      fetch(`/api/ai/tasks/${taskId}`, { cache: "no-store" }),
      fetch(`/api/ai/tasks/${taskId}/items?page=${page}&pageSize=${pageSize}&status=${status}&step=${step}&retry=${retryState}&industry=${encodeURIComponent(industry)}&target=${target}&grade=${grade}&search=${encodeURIComponent(search)}`, { cache: "no-store" }),
    ]);
    const taskBody = await taskResponse.json().catch(() => ({}));
    const itemsBody = await itemsResponse.json().catch(() => ({}));
    if (!quiet) setLoading(false);
    if (!taskResponse.ok || !itemsResponse.ok) { setError(taskBody.error || itemsBody.error || "任务详情查询失败"); return; }
    setTask(taskBody.task); setItems(itemsBody.data || []); setCount(itemsBody.count || 0); setError("");
  }, [taskId, page, pageSize, status, step, retryState, industry, target, grade, search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void fetch(`/api/ai/tasks/${taskId}/items?options=industries`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setIndustryOptions(Array.isArray(body.data) ? body.data : []))
      .catch(() => setIndustryOptions([]));
  }, [taskId]);
  useEffect(() => { if (!task || refreshMs <= 0 || !["QUEUED", "RUNNING", "PAUSING", "PAUSED"].includes(task.status)) return; const timer = setInterval(() => void load(true), refreshMs); return () => clearInterval(timer); }, [task, load, refreshMs]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const currentAction = actionFor(task);
  const processed = Number(task?.processed_count || 0);
  const remaining = Math.max(0, Number(task?.total_count || 0) - processed);
  const averageTokens = processed ? Number(task?.total_tokens || 0) / processed : 0;
  const averageCost = processed ? Number(task?.total_cost_usd || 0) / processed : 0;

  function itemStepLabel(item: TaskItem) {
    if (item.status !== "FAILED") return aiStepLabel(item.current_step || item.pipeline_stage);
    const contextStage = typeof item.error_context?.stage === "string" ? item.error_context.stage : null;
    const stage = contextStage || (item.pipeline_stage !== "FAILED" ? item.pipeline_stage : null);
    return `${stage ? `${aiStepLabel(stage)}：` : ""}${aiErrorMessageZh(item.error_code, item.error_message)}`;
  }

  function itemScore(item: TaskItem) {
    if (item.status !== "COMPLETED") return <span className="text-slate-400">-</span>;
    const grade = item.result?.grade || item.customer?.ai_level || "-";
    const score = item.result?.score ?? item.customer?.ai_score;
    if (!item.result?.grade && item.result?.score == null && item.customer?.ai_score == null) {
      return <span className="inline-flex min-w-[62px] justify-center rounded-md bg-rose-50 px-2 py-1 font-semibold text-rose-700">D · 0</span>;
    }
    const color = grade === "A" ? "bg-emerald-50 text-emerald-700" : grade === "B" ? "bg-blue-50 text-blue-700" : grade === "C" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
    return <span className={`inline-flex min-w-[62px] justify-center rounded-md px-2 py-1 font-semibold ${color}`}>{grade} · {score ?? "-"}</span>;
  }

  async function runAction() {
    if (!confirm) return;
    setBusy(true);
    const response = await fetch(`/api/ai/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: confirm }) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return toast(body.error || "任务操作失败", "error");
    setConfirm(null); toast("任务状态已更新"); await load(true);
  }

  if (loading && !task) return <main className="min-h-full bg-[#f5f7fb] p-6"><Loading/></main>;
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-[14px]">
    <PageHeader title={task?.name || "AI筛选任务详情"} description={`任务编号 ${task?.task_number || "-"} · ${task?.strategy === "DEEP" ? "深度分析" : "智能分析"} v1.0 · 创建于 ${task?.created_at ? new Date(task.created_at).toLocaleString("zh-CN") : "-"}`} actions={<><Link href="/ai-screening" className={button}>返回任务中心</Link><Link href={`/ai-screening/tasks/${taskId}/report`} className={primaryButton}>查看任务报告</Link>{currentAction ? <button className={button} onClick={() => setConfirm(currentAction)}>{actionCopy[currentAction].label}</button> : null}</>}/>
    {error ? <ErrorState message={error} reload={() => void load()}/> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">{[
      ["任务状态", <StatusBadge key="status" status={task?.status || ""}/>, <StrategyBadge key="strategy" strategy={task?.strategy || "SMART"}/>],
      ["已完成分析", formatNumber(processed), `占任务总量${task?.total_count ? (processed / task.total_count * 100).toFixed(1) : 0}%`],
      ["剩余待分析", formatNumber(remaining), `排队与处理中客户`],
      ["完成结果", `${formatNumber(task?.success_count)} / ${formatNumber(task?.failed_count)}`, "成功 / 失败"],
      ["当前总消耗", `${formatTokens(task?.total_tokens)} / ${formatCost(task?.total_cost_usd)}`, "Token / 实际费用"],
      ["平均每位消耗", `${formatTokens(averageTokens)} / ${formatCost(averageCost)}`, "Token / 客户费用"],
      ["任务执行耗时", formatDuration(task ? effectiveElapsedMs(task, now) : 0), "仅统计实际执行时间"],
    ].map(([label,value,sub]) => <article key={String(label)} className={`${panel} p-4`}><p className="text-xs text-slate-500">{label}</p><div className="mt-2 min-h-7 text-xl font-semibold text-slate-950">{value}</div><div className="mt-1 text-xs text-slate-400">{sub}</div></article>)}</section>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dce8ff] bg-[#f4f8ff] px-3 py-[10px] text-sm text-[#40608c]"><span><b>总体进度 {formatNumber(processed)} / {formatNumber(task?.total_count)}</b> · 页面刷新不会增加OpenAI调用或Token。</span><span className="flex items-center gap-2"><select className={`${input} h-8 w-auto`} value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))}><option value={10000}>每10秒刷新</option><option value={30000}>每30秒刷新</option><option value={0}>手动刷新</option></select><button className={`${button} h-8 px-3 text-[13px]`} onClick={() => void load()}><RefreshCw size={14}/>立即刷新</button></span></div>
    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold">任务处理队列</h2><p className="mt-1 text-sm text-[#778397]">用于监控每位客户的执行状态、当前步骤和异常重试；最终评分结果统一进入任务报告。</p></div><form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }} className="flex flex-wrap items-end gap-[10px] border-b p-[14px_16px] xl:flex-nowrap"><input className={`${input} min-w-[220px] flex-[1.25]`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索客户名称、邮箱或电话"/><select className={`${input} min-w-[132px] flex-1`} value={industry} onChange={(event) => { setIndustry(event.target.value); setPage(1); }}><option value="">全部所属行业</option>{industryOptions.map((value) => <option key={value}>{value}</option>)}</select><select className={`${input} min-w-[126px] flex-1`} value={target} onChange={(event) => { setTarget(event.target.value); setPage(1); }}><option value="">全部目标客户</option><option value="valid">有效目标</option><option value="invalid">无效目标</option></select><select className={`${input} min-w-[118px] flex-1`} value={grade} onChange={(event) => { setGrade(event.target.value); setPage(1); }}><option value="">全部AI等级</option>{["A","B","C","D"].map((value) => <option key={value}>{value}</option>)}</select><select className={`${input} min-w-[126px] flex-1`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部处理状态</option><option value="PENDING">等待分析</option><option value="RUNNING">分析中</option><option value="COMPLETED">已完成</option><option value="FAILED">分析失败</option></select><select className={`${input} min-w-[126px] flex-1`} value={step} onChange={(event) => { setStep(event.target.value); setPage(1); }}><option value="">全部处理步骤</option><option value="COLLECTING_EVIDENCE">读取公开入口</option><option value="ANALYZING">证据分析</option><option value="WRITTEN_BACK">写回客户</option><option value="FAILED">处理失败</option></select><select className={`${input} min-w-[126px] flex-1`} value={retryState} onChange={(event) => { setRetryState(event.target.value); setPage(1); }}><option value="">全部重试状态</option><option value="none">未重试</option><option value="retrying">自动重试中</option><option value="exhausted">已达重试上限</option></select><div className="flex shrink-0 gap-2"><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => { setSearchDraft(""); setSearch(""); setIndustry(""); setTarget(""); setGrade(""); setStatus(""); setStep(""); setRetryState(""); setPage(1); }}>重置</button></div></form>
      {loading ? <Loading/> : <div className="overflow-x-auto"><table className="w-full min-w-[1280px] table-fixed text-left text-sm"><colgroup><col className="w-[220px]"/><col className="w-[110px]"/><col className="w-[110px]"/><col className="w-[300px]"/><col className="w-[170px]"/><col className="w-[90px]"/><col className="w-[150px]"/><col className="w-[130px]"/></colgroup><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["客户名称","处理状态","AI等级 / 评分","当前步骤 / 失败原因","最近更新","重试","Token / 费用","操作"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100 align-middle"><td className="px-4 py-3"><div className="min-w-0"><b title={item.customer?.company_name || "-"} className="block truncate font-medium">{item.customer?.company_name || "-"}</b><small title={item.customer?.email || item.customer?.phone || "-"} className="mt-1 block truncate text-slate-400">{item.customer?.email || item.customer?.phone || "-"}</small></div></td><td className="px-4 py-3"><StatusBadge status={item.status}/></td><td className="px-4 py-3">{itemScore(item)}</td><td className={`px-4 py-3 leading-6 ${item.status === "FAILED" ? "text-rose-600" : "text-slate-700"}`} title={item.status === "FAILED" ? `${aiErrorCodeLabel(item.error_code)}：${aiErrorMessageZh(item.error_code, item.error_message)}` : undefined}>{itemStepLabel(item)}{item.status === "FAILED" ? <small className="mt-1 block text-rose-400">错误类型：{aiErrorCodeLabel(item.error_code)}</small> : null}</td><td className="px-4 py-3 text-slate-500">{new Date(item.updated_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3">{item.attempt_count} / {item.max_attempts}</td><td className="px-4 py-3">{formatTokens(item.total_tokens)} / {formatCost(item.cost_usd)}</td><td className="px-4 py-3">{item.status === "COMPLETED" ? <Link className="font-medium text-blue-600" href={`/ai-screening/customers/${item.customer_id}/evidence?task=${taskId}`}>查看分析依据</Link> : item.status === "FAILED" ? <Link className="font-medium text-rose-600" href={`/ai-screening/failures?task_id=${taskId}`}>重试</Link> : <span className="text-slate-400">处理中</span>}</td></tr>)}</tbody></table>{!items.length ? <div className="p-12 text-center text-sm text-slate-400">当前筛选条件下没有客户</div> : null}</div>}<Pagination page={page} pageSize={pageSize} total={count} itemLabel="条客户" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/></section>
  </div>{node}<ConfirmDialog open={Boolean(confirm)} title={confirm ? actionCopy[confirm].title : ""} description={confirm ? actionCopy[confirm].description : ""} confirmLabel={confirm ? actionCopy[confirm].label : "确认"} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void runAction()}/></main>;
}
