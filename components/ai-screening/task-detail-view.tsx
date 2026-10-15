"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { AiTask, TaskItem } from "@/components/ai-screening/types";
import { ConfirmDialog, CostModeBadge, ErrorState, Loading, PageHeader, Pagination, StatusBadge, button, effectiveElapsedMs, formatCost, formatDuration, formatNumber, formatTokens, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";
import { aiErrorCodeLabel, aiErrorMessageZh, aiStepLabel } from "@/components/ai-screening/localization";
import { SearchableMultiSelectFilter, type SearchableFilterOption } from "@/components/ui/searchable-multi-select-filter";
import { countryInfo } from "@/lib/countries";

const COUNTRY_NAMES = { of: (value: string) => countryInfo(value).name };

const actionCopy: Record<string, { label: string; title: string; description: string }> = {
  pause: { label: "停止任务", title: "停止任务？", description: "当前单条客户完成后暂停；已完成结果永久保留。" },
  cancel: { label: "取消任务", title: "取消排队任务？", description: "取消后退出等待队列，不执行分析也不产生费用。" },
  resume: { label: "继续执行", title: "继续执行任务？", description: "继续分析尚未完成的客户；旧版本中无评分的结果会自动重新分析。" },
  retry: { label: "重试失败项", title: "重试失败客户？", description: "仅重试失败客户，已完成客户不会重复分析。" },
  archive: { label: "归档任务", title: "归档任务？", description: "任务将从任务中心隐藏；客户结果、证据、完成统计、Token和费用账本全部保留。" },
};

function actionFor(task?: AiTask | null) { const status = task?.status; return ["RUNNING", "PAUSING"].includes(String(status)) ? "pause" : status === "QUEUED" ? "cancel" : status === "PAUSED" ? "resume" : status === "FAILED" || (status === "COMPLETED" && Number(task?.failed_count || 0) > 0) ? "retry" : ["COMPLETED", "CANCELLED"].includes(String(status)) ? "archive" : null; }
type GoogleAccountSku = { key:string; usageCount:number; freeLimit:number|null; pendingSystemUsage:number; projectedUsage:number; projectedRemaining:number|null; projectedOverageCalls:number; projectedOverageCostUsd:number };
type GoogleAccountBilling = { state:"NOT_CONFIGURED"|"CONNECTED"|"NO_DATA"|"ERROR"; message:string; skuUsage?:GoogleAccountSku[] };
export function TaskDetailView({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AiTask | null>(null);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [step, setStep] = useState("");
  const [retryState, setRetryState] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [grade, setGrade] = useState("");
  const [filterOptions, setFilterOptions] = useState<{industries:SearchableFilterOption[];countries:SearchableFilterOption[]}>({industries:[],countries:[]});
  const [refreshMs, setRefreshMs] = useState(10000);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [placesExpanded, setPlacesExpanded] = useState(false);
  const [googleAccountBilling, setGoogleAccountBilling] = useState<GoogleAccountBilling | null>(null);
  const { toast, node } = useToast();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const itemParams = new URLSearchParams({ page:String(page), pageSize:String(pageSize), status, step, retry:retryState, target, grade, search });
    for (const industry of industries) itemParams.append("industry", industry);
    for (const country of countries) itemParams.append("country", country);
    const [taskResponse, itemsResponse] = await Promise.all([
      fetch(`/api/ai/tasks/${taskId}`, { cache: "no-store" }),
      fetch(`/api/ai/tasks/${taskId}/items?${itemParams}`, { cache: "no-store" }),
    ]);
    const taskBody = await taskResponse.json().catch(() => ({}));
    const itemsBody = await itemsResponse.json().catch(() => ({}));
    if (!quiet) setLoading(false);
    if (!taskResponse.ok || !itemsResponse.ok) { setError(taskBody.error || itemsBody.error || "任务详情查询失败"); return; }
    setTask(taskBody.task); setItems(itemsBody.data || []); setCount(itemsBody.count || 0); setError("");
  }, [taskId, page, pageSize, status, step, retryState, industries, countries, target, grade, search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void fetch(`/api/ai/tasks/${taskId}/items?options=filters`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setFilterOptions({industries:Array.isArray(body.industries)?body.industries:[],countries:Array.isArray(body.countries)?body.countries:[]}))
      .catch(() => setFilterOptions({industries:[],countries:[]}));
  }, [taskId]);
  useEffect(() => {
    void fetch("/api/cost-center/google-billing", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => setGoogleAccountBilling(body))
      .catch(() => setGoogleAccountBilling(null));
  }, []);
  useEffect(() => { if (!task || refreshMs <= 0 || !["QUEUED", "RUNNING", "PAUSING"].includes(task.status)) return; const timer = setInterval(() => void load(true), refreshMs); return () => clearInterval(timer); }, [task, load, refreshMs]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const currentAction = actionFor(task);
  const processed = Number(task?.success_count || 0) + Number(task?.failed_count || 0);
  const remaining = Math.max(0, Number(task?.total_count || 0) - processed);
  const averageTokens = processed ? Number(task?.total_tokens || 0) / processed : 0;
  const openAiCost = Number(task?.total_cost_usd || 0);
  const averageOpenAiCost = processed ? openAiCost / processed : 0;
  const placesSkuRows = [
    ["PLACES_TEXT_SEARCH_ID_ONLY", "Text Search IDs Only", "不限量免费"],
    ["PLACES_DETAILS_PRO", "Place Details Pro", "每月前 5,000 次免费"],
    ["PLACES_DETAILS_ENTERPRISE", "Place Details Enterprise", "每月前 1,000 次免费"],
    ["PLACES_DETAILS_ENTERPRISE_ATMOSPHERE", "Enterprise + Atmosphere", "每月前 1,000 次免费"],
    ["HISTORICAL_UNCLASSIFIED", "历史未细分", "旧记录没有SKU，不能推测分摊"],
  ].map(([key,label,free])=>({ key, label, free, ...(task?.google_places_sku_breakdown?.[key] || { count:0, amount_usd:0 }) })).filter(row=>row.count>0 || row.key!=="HISTORICAL_UNCLASSIFIED");
  const accountSkuByTaskKey = new Map((googleAccountBilling?.skuUsage || []).map((row) => [
    row.key === "TEXT_SEARCH_IDS_ONLY" ? "PLACES_TEXT_SEARCH_ID_ONLY"
      : row.key === "PLACE_DETAILS_PRO" ? "PLACES_DETAILS_PRO"
      : row.key === "PLACE_DETAILS_ENTERPRISE" ? "PLACES_DETAILS_ENTERPRISE"
      : "PLACES_DETAILS_ENTERPRISE_ATMOSPHERE",
    row,
  ]));
  const budgetBlockCount = Object.values(task?.paid_api_budget_blocks || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const executorHistory = task?.executor_history || [];
  const executorLabel = executorHistory.length > 1
    ? "混合执行（发生接管）"
    : executorHistory[0] === "LOCAL_NODE"
      ? "本地 Worker 执行"
      : executorHistory[0] === "VERCEL_WORKFLOW"
        ? "Vercel 云端执行"
        : task?.active_executor === "LOCAL_NODE"
          ? "等待本地 Worker"
          : task?.active_executor === "VERCEL_WORKFLOW"
            ? "等待 Vercel 云端"
            : "尚未被执行器认领";

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
      return <span className="text-slate-400">未完成</span>;
    }
    const color = grade === "A" ? "bg-emerald-50 text-emerald-700" : grade === "B" ? "bg-blue-50 text-blue-700" : grade === "C" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
    return <span className={`inline-flex min-w-[62px] justify-center rounded-md px-2 py-1 font-semibold ${color}`}>{grade} · {score ?? "-"}</span>;
  }

  async function runAction() {
    if (!confirm) return;
    setBusy(true);
    const response = await fetch(`/api/ai/tasks/${taskId}`, confirm === "archive" ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: confirm }) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return toast(body.error || "任务操作失败", "error");
    if(confirm === "archive"){window.location.href="/ai-screening";return} setConfirm(null); toast("任务状态已更新"); await load(true);
  }

  if (loading && !task) return <main className="min-h-full bg-[#f5f7fb] p-6"><Loading/></main>;
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-[14px]">
    <PageHeader title={task?.name || "AI筛选任务详情"} description={`任务编号 ${task?.task_number || "-"} · 创建人 ${task?.creator?.name || task?.creator?.email || "历史账号"} · 创建于 ${task?.created_at ? new Date(task.created_at).toLocaleString("zh-CN") : "-"}`} actions={<><Link href="/ai-screening" className={button}>返回任务中心</Link><Link href={`/ai-screening/tasks/${taskId}/report`} className={primaryButton}>查看任务报告</Link>{currentAction ? <button className={`${button} ${currentAction==="cancel"?"text-rose-600 hover:border-rose-300 hover:bg-rose-50":""}`} onClick={() => setConfirm(currentAction)}>{actionCopy[currentAction].label}</button> : null}</>}/>
    {error ? <ErrorState message={error} reload={() => void load()}/> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">{[
      ["任务状态", <StatusBadge key="status" status={task?.status || ""}/>, <span key="task-mode" className="flex flex-wrap items-start justify-start gap-1 text-left"><CostModeBadge mode={task?.cost_mode}/><span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{executorLabel}</span></span>],
      ["总数 / 已处理 / 待处理", `${formatNumber(task?.total_count)} / ${formatNumber(processed)} / ${formatNumber(remaining)}`, `处理进度 ${task?.total_count ? (processed / task.total_count * 100).toFixed(1) : 0}%`],
      ["分析成功 / 分析失败", `${formatNumber(task?.success_count)} / ${formatNumber(task?.failed_count)}`, "真实业务结论 / 技术执行异常"],
      ["当前OpenAI消耗", `${formatTokens(task?.total_tokens)} / ${formatCost(openAiCost)}`, "Token / OpenAI台账费用"],
      ["平均每位消耗", `${formatTokens(averageTokens)} / ${formatCost(averageOpenAiCost)}`, "每位客户平均Token / OpenAI费用"],
      ["Google Places调用", `${formatNumber(task?.google_places_call_count)} 次`, "本任务真实API请求"],
      ["任务执行耗时", formatDuration(task ? effectiveElapsedMs(task, now) : 0), "仅统计实际执行时间"],
    ].map(([label,value,sub]) => label === "Google Places调用" ? <button type="button" key={String(label)} aria-expanded={placesExpanded} aria-controls="google-places-task-details" onClick={() => setPlacesExpanded((value) => !value)} className={`${panel} p-4 text-left transition hover:border-blue-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}><span className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{label}</span><ChevronDown size={16} className={`text-blue-600 transition ${placesExpanded ? "rotate-180" : ""}`}/></span><span className="mt-2 block min-h-7 text-xl font-semibold text-slate-950">{value}</span><span className="mt-1 flex items-center justify-between text-xs"><span className="text-slate-400">{sub}</span><span className="font-medium text-blue-600">{placesExpanded ? "收起明细" : "查看明细"}</span></span></button> : <article key={String(label)} className={`${panel} p-4`}><p className="text-xs text-slate-500">{label}</p><div className="mt-2 min-h-7 text-xl font-semibold text-slate-950">{value}</div><div className="mt-1 text-xs text-slate-400">{sub}</div></article>)}</section>
    {task?.dispatch_error && ["QUEUED", "RUNNING"].includes(task.status) ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">最近一次云端调度未成功：{task.dispatch_error}。任务仍保留在持久队列中，Vercel 云端恢复后会继续执行。</div> : null}
    {placesExpanded ? <section id="google-places-task-details" className={`${panel} p-4`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Google Places 调用明细</h2><p className="mt-1 text-xs text-slate-500">主数字为本任务调用量；月度额度来自当前 Google 结算账号，平台账单可能延迟，待同步调用已计入预计用量。</p></div>{budgetBlockCount?<span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">已因费用上限跳过 {formatNumber(budgetBlockCount)} 次付费调用</span>:null}</div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{placesSkuRows.map(row=>{const account=accountSkuByTaskKey.get(row.key);const unlimited=account?.freeLimit==null;const exceeded=Number(account?.projectedOverageCalls||0)>0;return <div key={row.key} className="rounded-lg border bg-slate-50/60 p-3"><b className="text-sm">{row.label}</b><div className="mt-2"><span className="text-xl font-semibold">{formatNumber(row.count)} 次</span><span className="ml-2 text-xs text-slate-400">本任务</span></div>{account ? <div className="mt-2 border-t pt-2 text-xs leading-5"><p className="text-slate-500">本月平台确认 {formatNumber(account.usageCount)} 次{account.pendingSystemUsage ? ` · 待同步 ${formatNumber(account.pendingSystemUsage)} 次` : ""}</p>{unlimited ? <p className="font-medium text-emerald-700">不限量免费</p> : exceeded ? <><p className="font-medium text-rose-600">已超免费额度 {formatNumber(account.projectedOverageCalls)} 次</p><p className="text-rose-600">超出部分预计 {formatCost(account.projectedOverageCostUsd)}</p></> : <p className="font-medium text-emerald-700">预计剩余 {formatNumber(account.projectedRemaining)} 次免费</p>}</div> : <p className="mt-2 border-t pt-2 text-xs text-slate-400">{googleAccountBilling?.state && googleAccountBilling.state !== "CONNECTED" ? "月度额度暂不可用" : row.free}</p>}</div>})}</div><p className="mt-3 text-xs text-amber-700">预计费用仅用于控制尚未同步的超额风险，最终费用以 Google 账单结算及抵扣为准。</p></section> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dce8ff] bg-[#f4f8ff] px-3 py-[10px] text-sm text-[#40608c]"><span><b>总体进度 {formatNumber(processed)} / {formatNumber(task?.total_count)}</b> · 页面刷新不会增加OpenAI调用或Token。</span><span className="flex items-center gap-2"><select className={`${input} h-8 w-auto`} value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))}><option value={10000}>每10秒刷新</option><option value={30000}>每30秒刷新</option><option value={0}>手动刷新</option></select><button className={`${button} h-8 px-3 text-[13px]`} onClick={() => void load()}><RefreshCw size={14}/>立即刷新</button></span></div>
    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold">任务处理队列</h2><p className="mt-1 text-sm text-[#778397]">用于监控每位客户的执行状态、当前步骤和异常重试；最终评分结果统一进入任务报告。</p></div><form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }} className="flex flex-wrap items-end gap-[10px] border-b p-[14px_16px]"><input className={`${input} min-w-[220px] flex-[1.25]`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索客户名称、邮箱或电话"/><SearchableMultiSelectFilter className="min-w-[150px] flex-1" label="国家/地区" value={countries} options={filterOptions.countries.map((item)=>({...item,label:COUNTRY_NAMES.of(item.value)||item.label||item.value}))} onChange={(value)=>{setCountries(value);setPage(1)}}/><SearchableMultiSelectFilter className="min-w-[150px] flex-1" label="所属行业" value={industries} options={filterOptions.industries} onChange={(value)=>{setIndustries(value);setPage(1)}}/><select className={`${input} min-w-[126px] flex-1`} value={target} onChange={(event) => { setTarget(event.target.value); setPage(1); }}><option value="">全部目标客户</option><option value="valid">有效目标</option><option value="invalid">无效目标</option></select><select className={`${input} min-w-[118px] flex-1`} value={grade} onChange={(event) => { setGrade(event.target.value); setPage(1); }}><option value="">全部AI等级</option>{["A","B","C","D"].map((value) => <option key={value}>{value}</option>)}</select><select className={`${input} min-w-[126px] flex-1`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部处理状态</option><option value="PENDING">等待分析</option><option value="RUNNING">分析中</option><option value="COMPLETED">已完成</option><option value="FAILED">分析失败</option></select><select className={`${input} min-w-[126px] flex-1`} value={step} onChange={(event) => { setStep(event.target.value); setPage(1); }}><option value="">全部处理步骤</option><option value="COLLECTING_EVIDENCE">读取公开入口</option><option value="ANALYZING">证据分析</option><option value="WRITTEN_BACK">写回客户</option><option value="FAILED">处理失败</option></select><select className={`${input} min-w-[126px] flex-1`} value={retryState} onChange={(event) => { setRetryState(event.target.value); setPage(1); }}><option value="">全部重试状态</option><option value="none">未重试</option><option value="retrying">自动重试中</option><option value="exhausted">已达重试上限</option></select><div className="flex shrink-0 gap-2"><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => { setSearchDraft(""); setSearch(""); setCountries([]); setIndustries([]); setTarget(""); setGrade(""); setStatus(""); setStep(""); setRetryState(""); setPage(1); }}>重置</button></div></form>
      {loading ? <Loading/> : <div className="overflow-x-auto"><table className="w-full min-w-[1600px] table-fixed text-left text-sm"><colgroup><col className="w-[210px]"/><col className="w-[105px]"/><col className="w-[150px]"/><col className="w-[110px]"/><col className="w-[280px]"/><col className="w-[165px]"/><col className="w-[115px]"/><col className="w-[85px]"/><col className="w-[105px]"/><col className="w-[145px]"/><col className="w-[125px]"/></colgroup><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["客户名称","处理状态","AI核验行业","AI等级 / 评分","当前步骤 / 失败原因","最近更新","实际执行器","重试","Places调用","Token / 费用","操作"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100 align-middle"><td className="px-4 py-3"><div className="min-w-0"><b title={item.customer?.company_name || "-"} className="block truncate font-medium">{item.customer?.company_name || "-"}</b><small title={item.customer?.email || item.customer?.phone || "-"} className="mt-1 block truncate text-slate-400">{item.customer?.email || item.customer?.phone || "-"}</small></div></td><td className="px-4 py-3"><StatusBadge status={item.status}/></td><td className="px-4 py-3"><span title={item.result?.industry_type || "-"} className="block truncate font-medium text-emerald-700">{item.status === "COMPLETED" ? item.result?.industry_type || "—" : "—"}</span></td><td className="px-4 py-3">{itemScore(item)}</td><td className={`px-4 py-3 leading-6 ${item.status === "FAILED" ? "text-rose-600" : "text-slate-700"}`} title={item.status === "FAILED" ? `${aiErrorCodeLabel(item.error_code)}：${aiErrorMessageZh(item.error_code, item.error_message)}` : undefined}>{itemStepLabel(item)}{item.status === "FAILED" ? <small className="mt-1 block text-rose-400">错误类型：{aiErrorCodeLabel(item.error_code)}</small> : null}</td><td className="px-4 py-3 text-slate-500">{new Date(item.updated_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs ${item.executor_type==="LOCAL_NODE"?"bg-violet-50 text-violet-700":item.executor_type==="VERCEL_WORKFLOW"?"bg-blue-50 text-blue-700":"bg-slate-100 text-slate-500"}`}>{item.executor_type==="LOCAL_NODE"?"本地 Worker":item.executor_type==="VERCEL_WORKFLOW"?"Vercel 云端":"尚未认领"}</span></td><td className="px-4 py-3">{item.attempt_count} / {item.max_attempts}</td><td className="px-4 py-3">{formatNumber(item.google_places_call_count)} 次</td><td className="px-4 py-3">{formatTokens(item.total_tokens)} / {formatCost(item.cost_usd)}</td><td className="px-4 py-3">{item.status === "COMPLETED" ? <Link className="font-medium text-blue-600" href={`/ai-screening/customers/${item.customer_id}/evidence?task=${taskId}`}>查看分析依据</Link> : item.status === "FAILED" ? <Link className="font-medium text-rose-600" href={`/ai-screening/failures?task_id=${taskId}`}>重试</Link> : <span className="text-slate-400">处理中</span>}</td></tr>)}</tbody></table>{!items.length ? <div className="p-12 text-center text-sm text-slate-400">当前筛选条件下没有客户</div> : null}</div>}<Pagination page={page} pageSize={pageSize} total={count} itemLabel="条客户" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/></section>
  </div>{node}<ConfirmDialog open={Boolean(confirm)} title={confirm ? actionCopy[confirm].title : ""} description={confirm ? actionCopy[confirm].description : ""} confirmLabel={confirm ? actionCopy[confirm].label : "确认"} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void runAction()}/></main>;
}
