"use client";
import Link from "next/link";
import { CalendarClock, ChevronDown, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { CustomerContactSummary } from "@/components/customer-contact-summary";
import { CustomerScoreBadge } from "@/components/customer-score-badge";
import { CountryLabel } from "@/components/country-label";
import { CustomerPublicLink } from "@/components/ui/customer-public-link";
import { CustomerPublicChannels } from "@/components/customer-public-channels";
import { SearchableMultiSelectFilter } from "@/components/ui/searchable-multi-select-filter";
import {
  ConfirmDialog,
  CostModeBadge,
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
import type { AcquisitionTask, Candidate } from "./types";
import { decisionLabels } from "./types";
import { acquisitionErrorMessageZh, acquisitionFailureStage } from "@/lib/ai-acquisition/presentation";
import { acquisitionBusinessLabel } from "@/lib/ai-acquisition/display-labels";
import { GroupedEvidenceSection, VerifiedContactsSection, type EvidenceDisplayItem, type VerifiedContactDisplayItem } from "@/components/ai-screening/evidence-sections";
type UsageSummary = {
  total_calls: number;
  free_calls: number;
  google_calls: number;
  openai_calls: number;
  total_cost_usd: number;
  actual_cost_usd?: number;
  google_actual_cost_usd?: number;
  total_tokens:number;
  sku_breakdown: Array<{ provider: string; model_or_sku: string; operation: string; calls: number; free_calls: number; amount_usd: number }>;
};
type GoogleSkuUsage = { key:string; label:string; usageCount:number; pendingSystemUsage:number; projectedUsage:number; freeLimit:number|null; projectedRemaining:number|null; projectedOverageCalls:number; projectedOverageCostUsd:number };
type GoogleBilling = { state:"NOT_CONFIGURED"|"CONNECTED"|"NO_DATA"|"ERROR"; message:string; skuUsage?:GoogleSkuUsage[] };
type EvidenceData = {
  evidence_available?: boolean;
  candidate: Candidate;
  analysis: {
    score?: number;
    grade?: string;
    short_reason?: string;
    identity_status?: string;
    evidence_sufficiency_score?: number;
    business_scope?: string;
    company_scale_evidence?: string;
    customer_value?: string;
    followup_suggestion?: string;
  } | null;
  evidence: Array<{
    id: string;
    source_url: string;
    source_type: string;
    channel?: string;
    title?: string;
    evidence_type: string;
    evidence_strength: string;
    evidence_confidence?: number;
    identity_match_status?: string;
    normalized_fact?: string;
    translated_fact?: string;
    content?: string;
    original_excerpt?: string;
    metadata?: { media_urls?: string[] } | null;
    created_at?: string;
  }>;
  contacts: Array<{
    id: string;
    type: string;
    value_raw: string;
    verification_status: string;
    source_channel: string;
    exact_source_url: string;
  }>;
};
const identityLabel: Record<string, string> = { MATCHED: "主体一致", AMBIGUOUS: "主体待确认", CONFLICT: "主体冲突", NOT_FOUND: "未确认主体" };
const tone: Record<string, string> = {
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  REVIEW: "bg-amber-50 text-amber-700",
  REJECTED: "bg-slate-100 text-slate-600",
  DUPLICATE: "bg-violet-50 text-violet-700",
  FAILED: "bg-rose-50 text-rose-700",
  ANALYZING: "bg-blue-50 text-blue-700",
};
type CompletionInfo = { budget_limited: boolean; blocked_periods: string[];incremental_skipped?:number;concurrently_skipped?:number;reused_searches?:number;reused_candidates?:number;no_new_search_units?:boolean };
type DiscoveryProgress = { stage:string;stage_detail:string|null;total:number;completed:number;raw_hits:number;incremental_skipped?:number;concurrently_skipped?:number;current_query:string|null;current_country:string|null;updated_at:string|null };
type VerificationProgress = {status:string;total:number;completed:number;pending:number;success:number;failed:number;early_processed:number;updated_at:string|null};
type SearchStat = {query:string;candidates:number;duplicates:number;rejected:number;review:number;accepted:number;claimed:number;progressed:number;cost_usd:number};
type TaskDetailPayload = {
  error?:string;
  task?:AcquisitionTask;
  candidates?:Candidate[];
  count?:number;
  usage_summary?:Partial<UsageSummary>;
  completion?:CompletionInfo;
  discovery_progress?:DiscoveryProgress|null;
  verification_progress?:VerificationProgress|null;
  search_stats?:SearchStat[];
  can_control?:boolean;
  can_view_evidence?:boolean;
};
const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const GOOGLE_SKU_ORDER=["PLACES_TEXT_SEARCH_PRO","PLACES_TEXT_SEARCH_ID_ONLY","PLACES_DETAILS_PRO","PLACES_DETAILS_ENTERPRISE","PLACES_DETAILS_ENTERPRISE_ATMOSPHERE"];
const GOOGLE_BILLING_KEY_BY_SKU:Record<string,string>={
  PLACES_TEXT_SEARCH_ID_ONLY:"TEXT_SEARCH_IDS_ONLY",
  PLACES_TEXT_SEARCH_PRO:"TEXT_SEARCH_PRO",
  PLACES_DETAILS_PRO:"PLACE_DETAILS_PRO",
  PLACES_DETAILS_ENTERPRISE:"PLACE_DETAILS_ENTERPRISE",
  PLACES_DETAILS_ENTERPRISE_ATMOSPHERE:"PLACE_DETAILS_ATMOSPHERE",
};
function CompactTags({values,limit=8}:{values:string[];limit?:number}) {
  const visible=values.slice(0,limit),remaining=values.slice(limit);
  return <div className="flex flex-wrap items-center gap-1.5">{visible.map((value,index)=><span key={`${value}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">{value}</span>)}{remaining.length?<details className="group/tags"><summary title="点击展开其余匹配关键词" className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:border-blue-300 hover:bg-blue-100">展开其余 {remaining.length} 项<ChevronDown size={12} className="transition group-open/tags:rotate-180"/></summary><div className="mt-2 flex max-h-32 min-w-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-white p-2 shadow-sm">{remaining.map((value,index)=><span key={`${value}-${index}`} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700">{value}</span>)}</div></details>:null}</div>;
}
function CandidateIndustryLabel({candidate}:{candidate:Candidate}) {
  const raw=candidate.customer_profile?.industry||candidate.customer_profile?.category;
  const label=acquisitionBusinessLabel(raw);
  const verified=candidate.ai_score!==null;
  return <small className={`mt-0.5 block truncate text-xs font-normal ${raw?"text-emerald-600":"text-slate-500"}`} title={label}>{raw?(verified?"AI核验：":"发现类型："):""}{label}</small>;
}
export function AcquisitionTaskDetail({ taskId, initialDecision="" }: { taskId: string; initialDecision?:string }) {
  const [task, setTask] = useState<AcquisitionTask | null>(null),
    [rows, setRows] = useState<Candidate[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [decision, setDecision] = useState(initialDecision),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [countries, setCountries] = useState<string[]>([]),
    [industries, setIndustries] = useState<string[]>([]),
    [level, setLevel] = useState(""),
    [readiness, setReadiness] = useState(""),
    [evidenceStatus, setEvidenceStatus] = useState(""),
    [resultSort, setResultSort] = useState("SALES_PRIORITY"),
    [usage, setUsage] = useState<UsageSummary | null>(null),
    [usageScope, setUsageScope] = useState<"GOOGLE" | null>(null),
    [googleBilling, setGoogleBilling] = useState<GoogleBilling | null>(null),
    [googleBillingLoading, setGoogleBillingLoading] = useState(false),
    [completion, setCompletion] = useState<CompletionInfo>({budget_limited:false,blocked_periods:[]}),
    [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress | null>(null),
    [verificationProgress, setVerificationProgress] = useState<VerificationProgress | null>(null),
    [searchStats, setSearchStats] = useState<SearchStat[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [canControl, setCanControl] = useState(false),
    [canEvidence, setCanEvidence] = useState(false),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<"PAUSE" | "RESUME" | "CANCEL" | "RETRY" | "REASSESS_REVIEWS" | "RECHECK_EVIDENCE_GAPS" | null>(null),
    [evidence, setEvidence] = useState<EvidenceData | null>(null),
    [evidenceLoading, setEvidenceLoading] = useState(false),
    [reviewAction, setReviewAction] = useState<{action:"DISCARD" | "RECHECK_AND_ACCEPT";candidateId:string} | null>(null);
  const { toast, node } = useToast();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    if (!quiet) setError("");
    try {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (decision) p.set("decision", decision);
      if (search) p.set("search", search);
      for (const country of countries) p.append("country", country);
      for (const industry of industries) p.append("industry", industry);
      if (level) p.set("level", level);
      if (readiness) p.set("readiness", readiness);
      if (evidenceStatus) p.set("evidence_status", evidenceStatus);
      p.set("sort", resultSort);
      if (quiet) p.set("lightweight", "1");
      let r: Response | null = null;
      let b: TaskDetailPayload = {};
      // A detail page is read-only. Retry one transient server failure before
      // showing an error so a brief database or function cold-start does not
      // make a working task appear unavailable to the user.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        r = await fetch(`/api/ai-acquisition/tasks/${taskId}?${p}`, { cache: "no-store" });
        b = await r.json().catch(() => ({}));
        if (r.ok || r.status < 500 || attempt === 1) break;
      }
      if (!r) throw new Error("加载失败");
      if (!r.ok) throw new Error(b.error || "加载失败");
      if (!b.task) throw new Error("任务核心数据不完整，请重新加载");
      setTask(b.task);
      if (!quiet) {
        setRows(b.candidates || []);
        setCount(b.count || 0);
      }
      if (b.usage_summary) setUsage((current) => ({ ...(current || {}), ...b.usage_summary } as UsageSummary));
      if (b.completion) setCompletion(b.completion);
      setDiscoveryProgress(b.discovery_progress || null);
      setVerificationProgress(b.verification_progress || null);
      if (Array.isArray(b.search_stats)) setSearchStats(b.search_stats);
      setCanControl(Boolean(b.can_control));
      setCanEvidence(Boolean(b.can_view_evidence));
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [taskId, page, pageSize, decision, search, countries, industries, level, readiness, evidenceStatus, resultSort]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!task || !["QUEUED", "RUNNING", "PAUSING"].includes(task.status))
      return;
    const id = setInterval(() => void load(true), 15000);
    return () => clearInterval(id);
  }, [task, load]);
  async function runAction() {
    if (!action) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/ai-acquisition/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "操作失败");
      toast(
        action === "PAUSE"
          ? "正在安全暂停"
          : action === "RESUME"
            ? "任务已恢复"
            : action === "RETRY"
              ? "任务已重新开始"
              : action === "RECHECK_EVIDENCE_GAPS"
                ? "证据缺口已重新进入核验，不会重复搜索"
                : action === "REASSESS_REVIEWS"
                  ? "待复核客户已重新进入补证、分析和评分"
                  : "任务已取消",
      );
      setAction(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "error");
    } finally {
      setBusy(false);
    }
  }
  async function showEvidence(id: string) {
    setEvidenceLoading(true);
    setEvidence(null);
    try {
      let r: Response | null = null;
      let b: EvidenceData & {error?:string} = {} as EvidenceData;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        r = await fetch(`/api/ai-acquisition/candidates/${id}/evidence`, { cache: "no-store" });
        b = await r.json().catch(() => ({} as EvidenceData));
        if (r.ok || r.status < 500 || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!r?.ok) throw new Error(b.error || "依据加载失败");
      setEvidence(b);
    } catch (e) {
      toast(e instanceof Error ? e.message : "依据加载失败", "error");
    } finally {
      setEvidenceLoading(false);
    }
  }
  async function runReviewAction() {
    if (!reviewAction) return;
    setBusy(true);
    try {
      const response=await fetch(`/api/ai-acquisition/candidates/${reviewAction.candidateId}/review`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:reviewAction.action})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||"复核处理失败");
      toast(reviewAction.action==="DISCARD"?"该客户已确认舍弃":"重新校验通过，客户已进入公海");
      setReviewAction(null);setEvidence(null);await load();
    } catch(error) { toast(error instanceof Error?error.message:"复核处理失败","error"); }
    finally { setBusy(false); }
  }
  if (loading && !task)
    return (
      <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]">
        <Loading />
      </main>
    );
  if (error && !task)
    return (
      <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]">
        <ErrorState message={error} reload={() => void load()} />
      </main>
    );
  if (!task) return null;
  const totalCost = usage?.actual_cost_usd ?? usage?.total_cost_usd ?? 0;
  const providerCost=(provider:string)=>(usage?.sku_breakdown||[]).filter((item)=>item.provider.toUpperCase().includes(provider)).reduce((sum,item)=>sum+Number(item.amount_usd||0),0);
  const googleCost=providerCost("GOOGLE");
  const googleActualCost=Number(usage?.google_actual_cost_usd||0);
  const openaiCost=providerCost("OPENAI");
  const averageAcceptedCost=task.accepted_count>0?totalCost/task.accepted_count:null;
  const googleSkuRows=[...(usage?.sku_breakdown||[])].filter((item)=>item.provider.toUpperCase().includes("GOOGLE")).reduce((rows,item)=>{
    const current=rows.get(item.model_or_sku)||{model_or_sku:item.model_or_sku,calls:0,free_calls:0,amount_usd:0,operations:[] as string[]};
    current.calls+=Number(item.calls||0);current.free_calls+=Number(item.free_calls||0);current.amount_usd+=Number(item.amount_usd||0);
    if(item.operation&&!current.operations.includes(item.operation))current.operations.push(item.operation);
    rows.set(item.model_or_sku,current);return rows;
  },new Map<string,{model_or_sku:string;calls:number;free_calls:number;amount_usd:number;operations:string[]}>());
  const visibleUsageBreakdown=[...googleSkuRows.values()].sort((a,b)=>{
    const rank=(value:string)=>{const index=GOOGLE_SKU_ORDER.indexOf(value);return index<0?999:index};
    return rank(a.model_or_sku)-rank(b.model_or_sku)||a.model_or_sku.localeCompare(b.model_or_sku);
  });
  const googleAccountRows=googleBilling?.state==="CONNECTED"?(googleBilling.skuUsage||[]):[];
  const googleProjectedUsage=googleAccountRows.reduce((sum,item)=>sum+Number(item.projectedUsage||0),0);
  const googleLimitedRows=googleAccountRows.filter((item)=>item.freeLimit!=null);
  const googleProjectedRemaining=googleLimitedRows.reduce((sum,item)=>sum+Number(item.projectedRemaining||0),0);
  const googleProjectedOverageCalls=googleAccountRows.reduce((sum,item)=>sum+Number(item.projectedOverageCalls||0),0);
  const googleProjectedOverageCost=googleAccountRows.reduce((sum,item)=>sum+Number(item.projectedOverageCostUsd||0),0);
  const visibleFreeCalls=visibleUsageBreakdown.reduce((sum,item)=>sum+Number(item.free_calls||0),0);
  const searchTotals=searchStats.reduce((total,item)=>({candidates:total.candidates+item.candidates,accepted:total.accepted+item.accepted,cost:total.cost+item.cost_usd}),{candidates:0,accepted:0,cost:0});
  async function toggleGoogleDetails(){
    const opening=usageScope!=="GOOGLE";
    setUsageScope(opening?"GOOGLE":null);
    if(!opening||googleBilling||googleBillingLoading)return;
    setGoogleBillingLoading(true);
    try{
      const response=await fetch("/api/cost-center/google-billing",{cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      setGoogleBilling(response.ok?body:{state:"ERROR",message:body.error||"Google Places 账号额度读取失败"});
    }catch{
      setGoogleBilling({state:"ERROR",message:"Google Places 账号额度读取失败，请稍后重试"});
    }finally{
      setGoogleBillingLoading(false);
    }
  }
  function showCustomerResults(nextDecision:"ACCEPTED"|"REVIEW"){
    setDecision(nextDecision);
    setPage(1);
    setDraft("");
    setSearch("");
    setCountries([]);
    setIndustries([]);
    setLevel("");
    setReadiness("");
    setEvidenceStatus("");
    setResultSort("SALES_PRIORITY");
    window.history.replaceState(null,"",`?decision=${nextDecision}#customer-results`);
    requestAnimationFrame(()=>document.getElementById("customer-results")?.scrollIntoView({behavior:"smooth",block:"start"}));
  }
  const discoveryCompleted=Number(discoveryProgress?.completed||0);
  const discoveryTotal=Number(discoveryProgress?.total||0);
  const discoveryPercent=discoveryTotal?Math.min(100,Math.round(discoveryCompleted/discoveryTotal*100)):0;
  const candidateCompleted=Number(task.processed_count||0);
  const candidateTotal=Number(task.discovered_count||0);
  const candidatePercent=candidateTotal?Math.min(100,Math.round(candidateCompleted/candidateTotal*100)):0;
  const verificationTotal=Number(verificationProgress?.total||0);
  const earlyProcessed=Number(verificationProgress?.early_processed||0);
  const runningStageTitle=({WAITING:"等待开始执行",DISCOVERY:"正在持续发现并核验目标客户",DEDUPLICATING:"正在保存候选并精准初筛",VERIFYING:"正在持续核验并实时入池",FINALIZING:"正在完成最后一批质量准入"} as Record<string,string>)[discoveryProgress?.stage||""]||"正在执行AI获客";
  const maintenancePaused=String(discoveryProgress?.stage_detail||"").includes("系统维护暂停");
  const stageTitle=maintenancePaused?"系统维护保护中":task.status==="PAUSED"?`已暂停 · 暂停前阶段：${runningStageTitle.replace(/^正在/,"")}`:task.status==="PAUSING"?`正在安全暂停 · ${runningStageTitle.replace(/^正在/,"")}`:runningStageTitle;
  const remainingSearches=Math.max(0,discoveryTotal-discoveryCompleted);
  const remainingCandidates=Math.max(0,candidateTotal-candidateCompleted);
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title={task.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>任务编号 {task.task_number}</span><span>·</span>
            <span>创建人 {task.owner?.name||task.owner?.email||"原账号（已停用）"}</span><span>·</span>
            <span>创建于 {new Date(task.created_at).toLocaleString("zh-CN",{hour12:false})}</span>
          </span>
        }
        actions={
          <>
            <Link href="/ai-acquisition" className={button}>
              返回任务中心
            </Link>
            <Link href={`/ai-acquisition/customers?scope=accepted&task_id=${task.id}`} className={button}>查看本任务入池客户</Link>
            {task.status === "COMPLETED" ? <Link href={`/ai-acquisition/tasks/${task.id}/report`} className={primaryButton}>查看任务报告</Link> : null}
            {canControl && task.status === "RUNNING" && !maintenancePaused ? (
              <button className={button} onClick={() => setAction("PAUSE")}>
                停止任务
              </button>
            ) : null}
            {canControl && (task.status === "PAUSED" || maintenancePaused) ? (
              <button className={button} onClick={() => setAction("RESUME")}>
                继续执行
              </button>
            ) : null}
            {canControl && (task.status === "FAILED" || (task.status === "COMPLETED" && Number(task.processed_count||0) < Number(task.discovered_count||0))) ? (
              <button className={button} onClick={() => setAction("RETRY")}>
                {task.status === "COMPLETED" ? "恢复未核验项" : "重试失败项"}
              </button>
            ) : null}
            {canControl && task.review_count > 0 && ["COMPLETED", "FAILED"].includes(task.status) ? (
              <button className={button} onClick={() => setAction("REASSESS_REVIEWS")}>
                重新核验待复核
              </button>
            ) : null}
            {canControl && task.status === "COMPLETED" ? (
              <button className={button} onClick={() => setAction("RECHECK_EVIDENCE_GAPS")}>
                校验证据缺口
              </button>
            ) : null}
            {canControl &&
            ["QUEUED", "RUNNING", "PAUSING", "PAUSED"].includes(task.status) ? (
              <button
                className={`${button} text-rose-600 hover:border-rose-300 hover:bg-rose-50`}
                onClick={() => setAction("CANCEL")}
              >
                取消任务
              </button>
            ) : null}
          </>
        }
      />
      {task.scheduled_at ? <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><CalendarClock size={16}/><b>预约执行：</b>{new Date(task.scheduled_at).toLocaleString("zh-CN",{hour12:false})}<span className="text-blue-600">（预约等待时间不计入有效耗时）</span></div> : null}
      {discoveryProgress && ["QUEUED","RUNNING","PAUSING","PAUSED"].includes(task.status) ? <section className={`${panel} overflow-hidden`} aria-label="AI获客实时执行进度">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"><div><div className="flex flex-wrap items-center gap-2"><b>{stageTitle}</b><StatusBadge status={maintenancePaused?"PAUSED":task.status}/></div><p className="mt-1 text-xs text-slate-500">{maintenancePaused?"当前任务暂不继续执行，也不会新增调用或费用；已完成的搜索和核验结果均已保留，只有人工点击“继续执行”后才会恢复。":task.status==="PAUSED"?"任务已在安全检查点暂停；只有人工点击“继续执行”后才会恢复，且不会重复已完成搜索。":discoveryProgress.stage_detail||"系统一边搜索、一边核验；符合真实证据和联系方式门槛的客户会持续入池。"}</p></div><div className="text-right text-xs text-slate-400"><p>有效耗时 {formatDuration(effectiveElapsedMs(task))}</p>{discoveryProgress.updated_at?<p className="mt-1">最近进展 {new Date(discoveryProgress.updated_at).toLocaleString("zh-CN",{hour12:false})}</p>:null}</div></div>
        <div className="p-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3"><small className="text-slate-500">1. 搜索范围</small><b className="mt-1 block text-lg text-blue-700">{formatNumber(discoveryCompleted)} / {formatNumber(discoveryTotal)} 组</b><span className="text-xs text-slate-500">已完成搜索；剩余 {formatNumber(remainingSearches)} 组</span></article>
          <article className="rounded-lg border bg-slate-50 px-4 py-3"><small className="text-slate-500">2. 发现并去重</small><b className="mt-1 block text-lg">{formatNumber(candidateTotal)} 位候选</b><span className="text-xs text-slate-500">来自 {formatNumber(discoveryProgress.raw_hits)} 条原始命中</span></article>
          <article className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3"><small className="text-slate-500">3. 完成核验</small><b className="mt-1 block text-lg text-emerald-700">{formatNumber(candidateCompleted)} / {formatNumber(candidateTotal)} 位</b><span className="text-xs text-slate-500">剩余 {formatNumber(remainingCandidates)} 位待处理</span></article>
          <article className="rounded-lg border bg-slate-50 px-4 py-3"><small className="text-slate-500">4. 当前结果</small><b className="mt-1 block text-lg"><span className="text-emerald-700">入池 {formatNumber(task.accepted_count)}</span><span className="mx-2 text-slate-300">·</span><span className="text-amber-700">待复核 {formatNumber(task.review_count)}</span></b><span className="text-xs text-slate-500">未通过 {formatNumber(task.rejected_count)} · 重复 {formatNumber(task.duplicate_count)}</span></article>
        </div><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><div className="flex items-end justify-between gap-3"><span><b className="text-sm">搜索完成度</b><small className="ml-2 text-slate-400">{formatNumber(discoveryCompleted)} / {formatNumber(discoveryTotal)} 组</small></span><b className="text-sm text-blue-700">{discoveryPercent}%</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500 transition-all" style={{width:`${discoveryPercent}%`}}/></div></div><div><div className="flex items-end justify-between gap-3"><span><b className="text-sm">候选核验完成度</b><small className="ml-2 text-slate-400">{formatNumber(candidateCompleted)} / {formatNumber(candidateTotal)} 位</small></span><b className="text-sm text-emerald-700">{candidatePercent}%</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{width:`${candidatePercent}%`}}/></div></div></div>{discoveryProgress.current_query&&discoveryProgress.stage==="DISCOVERY"?<p className="mt-3 truncate text-xs text-blue-700" title={discoveryProgress.current_query}>正在搜索：{discoveryProgress.current_query}{discoveryProgress.current_country?` · ${COUNTRY_NAMES.of(discoveryProgress.current_country)||discoveryProgress.current_country}`:""}</p>:null}
        {verificationProgress&&verificationTotal>0?<details className="mt-4 rounded-lg border bg-slate-50/60 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium text-blue-700">查看处理明细</summary><div className="mt-2 grid gap-2 text-slate-500 sm:grid-cols-4"><span>快速排除或重复：<b className="text-slate-800">{formatNumber(earlyProcessed)} 位</b></span><span>进入深度核验：<b className="text-slate-800">{formatNumber(verificationTotal)} 位</b></span><span>核验成功：<b className="text-slate-800">{formatNumber(verificationProgress.success)} 位</b></span><span>待处理：<b className="text-slate-800">{formatNumber(verificationProgress.pending)} 位</b>{verificationProgress.failed>0?<em className="ml-2 not-italic text-rose-600">技术失败 {formatNumber(verificationProgress.failed)} 位，需重试</em>:null}</span></div></details>:null}</div>
      </section>:null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="AI获客结果概览">
        <button type="button" onClick={()=>showCustomerResults("ACCEPTED")} className={`${panel} p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/30`}><small className="text-slate-500">成功入池客户</small><div className="mt-2 text-xl font-semibold text-emerald-700">{formatNumber(task.accepted_count)}</div><small className="mt-1 block text-slate-500">已核验有效并写入客户公海</small></button>
        <button type="button" onClick={()=>showCustomerResults("REVIEW")} className={`${panel} p-4 text-left transition hover:border-amber-300 hover:bg-amber-50/30`}><small className="text-slate-500">待人工复核</small><div className="mt-2 text-xl font-semibold text-amber-700">{formatNumber(task.review_count)}</div><small className="mt-1 block text-slate-500">点击处理证据不足的候选</small></button>
        <article className={`${panel} p-4`}><small className="text-slate-500">候选核验进度</small><div className="mt-2 text-xl font-semibold">{formatNumber(task.processed_count)} / {formatNumber(task.discovered_count)}</div><small className="mt-1 block text-slate-500">未通过 {formatNumber(task.rejected_count)} · 重复 {formatNumber(task.duplicate_count)}</small></article>
        <article className={`${panel} p-4`}><small className="text-slate-500">平均有效客户成本</small><div className="mt-2 text-xl font-semibold">{averageAcceptedCost==null?"—":formatCost(averageAcceptedCost)}</div><small className="mt-1 block text-slate-500">实际已产生费用 {formatCost(totalCost)}</small></article>
        <article className={`${panel} p-4`}><small className="text-slate-500">OpenAI</small><div className="mt-2 text-xl font-semibold">{formatCost(openaiCost)}</div><small className="mt-1 block text-slate-500">{formatNumber(usage?.openai_calls)} 次 · {formatTokens(usage?.total_tokens)} Token</small></article>
        <button type="button" aria-expanded={usageScope==="GOOGLE"} aria-controls="google-usage-details" onClick={()=>void toggleGoogleDetails()} className={`${panel} p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/30`}><span className="flex items-center justify-between"><small className="text-slate-500">Google Places</small><small className="flex items-center gap-1 text-blue-600">{usageScope==="GOOGLE"?"收起明细":"查看明细"}<ChevronDown size={14} className={`transition ${usageScope==="GOOGLE"?"rotate-180":""}`}/></small></span><div className="mt-2 text-xl font-semibold">{formatNumber(usage?.google_calls)} 次</div><small className="mt-1 block text-slate-500">{googleActualCost>0?`平台已确认费用 ${formatCost(googleActualCost)}`:"暂无平台确认费用"}</small></button>
      </section>
      {usageScope==="GOOGLE"?<section id="google-usage-details" className={`${panel} overflow-hidden`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div><h2 className="font-semibold">Google Places 调用与费用明细</h2><p className="mt-1 text-xs text-slate-500">先核对本任务用量，再查看同一Google结算账号当前结算月的总用量、剩余额度、超额调用与预计费用。</p></div>
          <div className="flex items-center gap-4"><Link href="/ai-usage?business_type=acquisition" className="text-sm font-medium text-blue-600">AI用量与费用</Link><button type="button" className="flex items-center gap-1 text-sm font-medium text-blue-600" onClick={()=>setUsageScope(null)}>收起明细<ChevronDown size={15} className="rotate-180"/></button></div>
        </div>
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <div className="rounded-lg bg-blue-50/60 px-4 py-3"><small className="text-slate-500">本任务调用</small><b className="mt-1 block text-lg text-blue-700">{formatNumber(usage?.google_calls)} 次</b><span className="text-xs text-slate-400">其中免费记账 {formatNumber(visibleFreeCalls)} 次</span></div>
          <div className="rounded-lg bg-slate-50 px-4 py-3"><small className="text-slate-500">本任务价目估算</small><b className="mt-1 block text-lg">{formatCost(googleCost)}</b><span className="text-xs text-slate-400">未抵扣账号共享免费额度</span></div>
          <div className="rounded-lg bg-slate-50 px-4 py-3"><small className="text-slate-500">结算月预计总用量</small><b className="mt-1 block text-lg">{googleBillingLoading?"读取中…":googleBilling?.state==="CONNECTED"?`${formatNumber(googleProjectedUsage)} 次`:"—"}</b><span className="text-xs text-slate-400">平台已确认 + 系统待同步</span></div>
          <div className="rounded-lg bg-emerald-50/60 px-4 py-3"><small className="text-slate-500">预计剩余免费额度</small><b className="mt-1 block text-lg text-emerald-700">{googleBillingLoading?"读取中…":googleBilling?.state==="CONNECTED"?(googleLimitedRows.length?`${formatNumber(googleProjectedRemaining)} 次`:"不限量"):"—"}</b><span className="text-xs text-slate-400">各有限额SKU剩余合计</span></div>
          <div className={`rounded-lg px-4 py-3 ${googleProjectedOverageCalls>0?"bg-rose-50":"bg-slate-50"}`}><small className="text-slate-500">超过免费额度</small><b className={`mt-1 block text-lg ${googleProjectedOverageCalls>0?"text-rose-600":"text-slate-800"}`}>{googleBillingLoading?"读取中…":googleBilling?.state==="CONNECTED"?`${formatNumber(googleProjectedOverageCalls)} 次`:"—"}</b><span className="text-xs text-slate-400">当前结算账号预计超额</span></div>
          <div className={`rounded-lg px-4 py-3 ${googleProjectedOverageCost>0?"bg-rose-50":"bg-slate-50"}`}><small className="text-slate-500">超额预计费用</small><b className={`mt-1 block text-lg ${googleProjectedOverageCost>0?"text-rose-600":"text-slate-800"}`}>{googleBillingLoading?"读取中…":googleBilling?.state==="CONNECTED"?formatCost(googleProjectedOverageCost):"—"}</b><span className="text-xs text-slate-400">最终以Google账单为准</span></div>
        </div>
        {visibleUsageBreakdown.length?<div className="border-b p-4"><h3 className="text-sm font-semibold">本任务 Google Places SKU用量与账号额度</h3><div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">{visibleUsageBreakdown.map((item)=>{const account=googleBilling?.skuUsage?.find((entry)=>entry.key===GOOGLE_BILLING_KEY_BY_SKU[item.model_or_sku]);const exceeded=Number(account?.projectedOverageCalls||0)>0;return <article key={item.model_or_sku} className="rounded-lg border bg-slate-50/60 p-3"><div className="flex items-start justify-between gap-2"><div><b className="text-sm text-slate-800">{item.model_or_sku}</b><small className="mt-1 block text-slate-500">{item.operations.join("、")||"Google Places调用"}</small></div><span className="shrink-0 rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">本任务 {formatNumber(item.calls)} 次</span></div><div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs"><span className="text-slate-500">本任务免费<b className="mt-1 block text-sm text-slate-800">{formatNumber(item.free_calls)} 次</b></span><span className="text-slate-500">价目估算<b className="mt-1 block text-sm text-slate-800">{formatCost(item.amount_usd)}</b></span></div>{account?<div className="mt-3 border-t pt-3 text-xs leading-5"><p className="text-slate-500">结算月预计总量 <b className="text-slate-700">{formatNumber(account.projectedUsage)} 次</b></p><p className="text-slate-400">平台确认 {formatNumber(account.usageCount)} · 待同步 {formatNumber(account.pendingSystemUsage)}</p>{account.freeLimit==null?<p className="font-medium text-emerald-700">不限量免费</p>:exceeded?<><p className="font-medium text-rose-600">已超免费额度 {formatNumber(account.projectedOverageCalls)} 次</p><p className="text-rose-600">超额预计费用 {formatCost(account.projectedOverageCostUsd)}</p></>:<p className="font-medium text-emerald-700">预计剩余 {formatNumber(account.projectedRemaining)} 次免费</p>}</div>:<p className="mt-3 border-t pt-3 text-xs text-slate-400">{googleBillingLoading?"正在读取结算月额度…":googleBilling?.message||"账号额度暂不可用"}</p>}</article>})}</div>{googleBilling?.state!=="CONNECTED"&&!googleBillingLoading?<p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{googleBilling?.message||"账号额度暂不可用，本任务调用与成本数据不受影响。"}</p>:<p className="mt-3 text-xs text-slate-500">账号总量按平台已确认用量加系统待同步记录估算；免费额度由同一Google结算账号下的AI获客与AI筛选共享。</p>}</div>:<div className="p-8 text-center text-sm text-slate-400">本任务暂无已记录调用</div>}
      </section>:null}
      {task.error_message ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div><b>{acquisitionFailureStage(task.error_message)}</b><p className="mt-1 leading-6">{acquisitionErrorMessageZh(task.error_message)}</p><small className="mt-1 block text-rose-500">已完成 {formatNumber(task.processed_count)} 位，剩余 {formatNumber(Math.max(0,task.discovered_count-task.processed_count))} 位待继续处理；已完成结果不会重复分析或计费。</small>{discoveryProgress?<small className="mt-1 block text-rose-500">已保留 {discoveryProgress.completed} 个检索检查点、{formatNumber(discoveryProgress.raw_hits)} 条原始命中和全部费用记录。</small>:null}</div>
          {canControl&&task.status==="FAILED"?<button className={primaryButton} onClick={()=>setAction("RETRY")}><RefreshCw size={15}/>从检查点重试</button>:null}
        </div>
      ) : null}
      <details className={`${panel} group overflow-hidden`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4"><div><h2 className="font-semibold">任务条件与执行规则</h2><p className="mt-1 text-xs text-slate-500">{task.countries.length} 个国家/地区 · {task.industries?.length||1} 个目标行业 · {task.keywords.length} 个搜索关键词</p></div><span className="flex shrink-0 items-center gap-2 text-sm text-blue-600">查看任务条件<ChevronDown size={16} className="transition group-open:rotate-180"/></span></summary>
        <div className="grid gap-3 border-t p-4 text-sm lg:grid-cols-2">
          <div className="rounded-lg border bg-slate-50/60 p-3"><b className="text-slate-700">目标国家/地区</b><div className="mt-2"><CompactTags values={task.countries.map((code)=>COUNTRY_NAMES.of(code)||code)} limit={8}/></div></div>
          <div className="rounded-lg border bg-slate-50/60 p-3"><b className="text-slate-700">执行设置</b><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt className="text-slate-500">获客模式</dt><dd><CostModeBadge mode={task.cost_mode} context="acquisition" /></dd><dt className="text-slate-500">费用保护</dt><dd className="font-medium text-slate-700">{task.task_cost_limit_usd==null?"继承AI获客全局费用限制":`本任务最多 ${formatCost(task.task_cost_limit_usd)}`}</dd><dt className="text-slate-500">执行时间</dt><dd className="font-medium text-slate-700">{task.scheduled_at?new Date(task.scheduled_at).toLocaleString("zh-CN",{hour12:false}):"创建后立即执行"}</dd></dl></div>
          <div className="rounded-lg border bg-slate-50/60 p-3 lg:col-span-2"><b className="text-slate-700">目标行业</b><div className="mt-2"><CompactTags values={task.industries?.length?task.industries:[task.industry]} limit={8}/></div></div>
          <div className="rounded-lg border bg-slate-50/60 p-3 lg:col-span-2"><b className="text-slate-700">搜索关键词</b><div className="mt-2"><CompactTags values={task.keywords} limit={10}/></div></div>
          <div className={`rounded-lg border px-4 py-3 leading-6 lg:col-span-2 ${completion.no_new_search_units?"border-amber-200 bg-amber-50 text-amber-900":"border-blue-100 bg-blue-50 text-blue-800"}`}><b>{completion.no_new_search_units?"本次执行说明：":"结束规则："}</b>{task.status==="COMPLETED"?(completion.budget_limited?"付费路径达到任务或全局限制后停止；已发现候选仍完成去重与质量判定。":completion.no_new_search_units?`本次没有发起新的第三方搜索或AI分析：近期覆盖账本已包含当前范围，跳过 ${completion.incremental_skipped||0} 项覆盖汇总，复用历史核验结论 ${completion.reused_candidates||0} 条。系统已避免重复消耗，但这不属于一次新的采集分析。`:"当前检索策略可返回的分页已覆盖，并已完成全部新候选质量判定；结果受Google可返回范围、费用保护和去重规则影响，不代表市场绝对全量。"):"系统会覆盖当前国家、行业和关键词的全部检索组合及Google可返回分页；只有分页无更多结果、达到任务安全上限或触发费用保护后才停止。"}</div>
        </div>
      </details>
      <section id="customer-results" className={`${panel} scroll-mt-4`}>
        <div className="border-b px-5 pt-5">
          <div>
            <h2 className="text-lg font-semibold">本次获取的客户</h2>
            <p className="mt-1 text-sm text-slate-500">
              优先核对成功入池客户的数据质量；待复核、未通过和重复记录均不会进入客户公海。
            </p>
          </div>
          <nav className="mt-4 flex gap-6 overflow-x-auto" aria-label="客户结果分类">
            {([
              ["","全部候选",task.processed_count],
              ["ACCEPTED","成功入池",task.accepted_count],
              ["REVIEW","待复核",task.review_count],
              ["REJECTED","未通过",task.rejected_count],
              ["DUPLICATE","重复",task.duplicate_count],
            ] as const).map(([value,label,total])=><button key={label} type="button" onClick={()=>{setDecision(value);setPage(1)}} className={`whitespace-nowrap border-b-2 pb-3 text-sm ${decision===value?"border-blue-600 font-medium text-blue-600":"border-transparent text-slate-500 hover:text-slate-800"}`}>{label}<span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{total}</span></button>)}
          </nav>
        </div>
          <form className="grid w-full gap-2 border-b p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_repeat(6,minmax(135px,auto))_auto]" onSubmit={(event)=>{event.preventDefault();setPage(1);setSearch(draft.trim())}}>
          <label className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input className={`${input} w-full pl-9`} value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder="搜索客户名称或地址"/></label>
          {task.countries.length>1?<SearchableMultiSelectFilter label="国家/地区" value={countries} options={task.countries.map((value)=>({value,label:COUNTRY_NAMES.of(value)||value}))} onChange={(value)=>{setPage(1);setCountries(value)}}/>:null}
          {(task.industries?.length||1)>1?<SearchableMultiSelectFilter label="核验行业" value={industries} options={(task.industries?.length?task.industries:[task.industry]).filter(Boolean).map((value)=>({value,label:value}))} onChange={(value)=>{setPage(1);setIndustries(value)}}/>:null}
          <select aria-label="AI等级" className={`${input} w-full`} value={level} onChange={(event)=>{setPage(1);setLevel(event.target.value)}}><option value="">全部AI等级</option>{["A","B","C","D"].map((item)=><option key={item} value={item}>{item}级</option>)}</select>
          <select aria-label="联系状态" className={`${input} w-full`} value={readiness} onChange={(event)=>{setPage(1);setReadiness(event.target.value)}}><option value="">全部联系状态</option><option value="ACTIONABLE">有已核验联系方式</option><option value="NO_CONTACT">缺少有效联系方式</option></select>
          <select aria-label="证据状态" className={`${input} w-full`} value={evidenceStatus} onChange={(event)=>{setPage(1);setEvidenceStatus(event.target.value)}}><option value="">全部证据状态</option><option value="COMPLETE">经营与行业证据充分</option><option value="GAP">证据不足</option></select>
          <select aria-label="结果排序" className={`${input} w-full`} value={resultSort} onChange={(event)=>{setPage(1);setResultSort(event.target.value)}}><option value="SALES_PRIORITY">销售优先</option><option value="SCORE">AI评分从高到低</option><option value="RECENT">最近处理</option></select>
          <div className="flex gap-2"><button className={button}>查询</button>{(search||decision||countries.length||industries.length||level||readiness||evidenceStatus||resultSort!=="SALES_PRIORITY")?<button type="button" className="text-sm text-blue-700" onClick={()=>{setDraft("");setSearch("");setDecision("");setCountries([]);setIndustries([]);setLevel("");setReadiness("");setEvidenceStatus("");setResultSort("SALES_PRIORITY");setPage(1)}}>清除</button>:null}</div>
          </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[2360px] table-fixed text-left text-sm">
            <colgroup><col className="w-[230px]"/><col className="w-[120px]"/><col className="w-[110px]"/><col className="w-[190px]"/><col className="w-[250px]"/><col className="w-[210px]"/><col className="w-[190px]"/><col className="w-[280px]"/><col className="w-[230px]"/><col className="w-[230px]"/><col className="w-[250px]"/><col className="w-[145px]"/><col className="w-[145px]"/></colgroup>
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "客户名称",
                  "国家/地区",
                  "AI评分",
                  "联系号码",
                  "邮箱",
                  "官网",
                  "公开渠道",
                  "匹配关键词",
                  "Google地址",
                  "商机线索",
                  "销售建议",
                  "核验结论",
                  "操作",
                ].map((x,index,headers) => (
                  <th key={x} className={`px-4 py-3 font-medium ${index===0?"sticky left-0 z-20 bg-slate-50 shadow-[1px_0_0_#e2e8f0]":""} ${index===headers.length-1?"sticky right-0 z-20 bg-slate-50 shadow-[-1px_0_0_#e2e8f0]":""}`}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="group border-t align-top hover:bg-blue-50/30">
                  <td className="sticky left-0 z-10 bg-white px-3 py-4 shadow-[1px_0_0_#e2e8f0] group-hover:bg-blue-50">
                    <span className="block min-w-0"><span className="block truncate font-medium text-blue-700" title={r.company_name}>{r.company_name}</span><CandidateIndustryLabel candidate={r}/></span>
                  </td>
                  <td className="px-3 py-4"><CountryLabel value={r.country}/></td>
                  <td className="px-3 py-4"><CustomerScoreBadge score={r.ai_score} level={r.ai_level}/></td>
                  <td className="max-w-64 px-4 py-4">
                    <CustomerContactSummary customer={{...r.customer_profile,country:r.country,verified_contacts:r.verified_contacts}} source="ai" display="phone"/>
                  </td>
                  <td className="max-w-56 px-4 py-4">
                    <CustomerContactSummary customer={{...r.customer_profile,country:r.country,verified_contacts:r.verified_contacts}} source="ai" display="email"/>
                  </td>
                  <td className="px-4 py-4"><span title={!r.customer_profile?.website&&r.source_website?"Google 商家提供的官网":"企业官网"}><CustomerPublicLink value={r.customer_profile?.website||r.source_website} kind="website" iconOnly/>{!r.customer_profile?.website&&r.source_website?<span className="sr-only">Google 商家提供</span>:null}</span></td>
                  <td className="px-4 py-4"><CustomerPublicChannels customer={{...r.customer_profile,google_url:r.customer_profile?.google_url||r.google_url}}/></td>
                  <td className="px-4 py-4">{r.matched_keywords?.length?<div className="space-y-1" title={`匹配关键词：${r.matched_keywords.join("、")}`}>{r.matched_keywords.slice(0,3).map((keyword)=><span key={keyword} className="block max-w-[166px] truncate whitespace-nowrap rounded bg-blue-50 px-2 py-1 text-[11px] font-normal text-blue-700">{keyword}</span>)}{r.matched_keywords.length>3?<span className="block text-[11px] font-normal text-slate-400">另有 {r.matched_keywords.length-3} 项</span>:null}</div>:<small className="text-slate-400">未记录</small>}</td>
                  <td className="px-4 py-4"><span className="line-clamp-3 leading-5 text-slate-600">{r.address||"地址待核验"}</span></td>
                  <td className="px-4 py-4"><p className="line-clamp-3 text-xs leading-5 text-slate-600">{r.customer_profile?.company_scale_evidence||r.customer_profile?.customer_value||"暂无可核验的采购、批发或经营规模线索"}</p></td>
                  <td className="px-4 py-4"><p className="line-clamp-3 text-xs leading-5 text-blue-700">{r.customer_profile?.followup_suggestion||"建议先核对主营业务与采购需求后联系"}</p></td>
                  <td className="max-w-80 px-4 py-4 text-slate-600">
                    <span className={`rounded-md px-2 py-1 text-xs ${tone[r.decision] || "bg-slate-100"}`}>{decisionLabels[r.decision] || r.decision}</span>
                    <small className="mt-2 block leading-5">{r.decision_reason || "—"}</small>
                    <small className={`mt-1 block ${r.evidence_complete&&r.has_actionable_contact?"text-emerald-700":"text-amber-700"}`}>{r.evidence_complete?"依据通过":"依据不足"} · {r.has_actionable_contact?"联系方式通过":"联系方式不足"}</small>
                  </td>
                  <td className="sticky right-0 z-10 bg-white px-4 py-4 shadow-[-1px_0_0_#e2e8f0] group-hover:bg-blue-50">
                    <div className="flex flex-col items-start gap-2">
                      {canEvidence ? (
                        <button
                          className={button}
                          disabled={evidenceLoading}
                          onClick={() => void showEvidence(r.id)}
                        >
                          查看依据
                        </button>
                      ) : null}
                      {r.imported_customer_id ? (
                        <Link
                          className={button}
                          href={`/customers/${r.imported_customer_id}?from=pool`}
                        >
                          客户详情
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? (
            <div className="grid h-40 place-items-center px-6 text-center text-sm text-slate-400">
              {task.status==="FAILED"&&discoveryProgress?.completed?"检索结果已保留，但候选尚未完成保存与核验；从检查点重试后将在这里展示客户数据。":"当前筛选条件下暂无客户记录"}
            </div>
          ) : null}
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={count}
          onPage={setPage}
          onPageSize={(s) => {
            setPage(1);
            setPageSize(s);
          }}
          itemLabel="个候选"
        />
      </section>
      <div id="task-analysis" className="scroll-mt-4 space-y-4">
      {searchStats.length?<details className={`${panel} group overflow-hidden`}><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4"><div><h2 className="font-semibold">搜索策略效果</h2><p className="mt-1 text-xs text-slate-500">用于复盘各检索组合的发现、核验、入池和后续转化表现，默认收起，不影响日常查看客户。</p></div><span className="flex shrink-0 items-center gap-3 text-sm"><span className="text-slate-500">组合 {formatNumber(searchStats.length)} · 发现 {formatNumber(searchTotals.candidates)} · 入池 {formatNumber(searchTotals.accepted)}</span><b className="text-slate-900">{formatCost(searchTotals.cost)}</b><ChevronDown size={16} className="text-blue-600 transition group-open:rotate-180"/></span></summary><div className="border-t"><div className="grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-4">{[["检索组合",formatNumber(searchStats.length)],["发现候选",formatNumber(searchTotals.candidates)],["成功入池",formatNumber(searchTotals.accepted)],["成本参考",formatCost(searchTotals.cost)]].map(([label,value])=><div key={label} className="rounded-lg bg-slate-50 px-4 py-3"><small className="text-slate-500">{label}</small><b className="mt-1 block text-lg">{value}</b></div>)}</div><div className="max-h-80 overflow-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr>{["检索组合","发现候选","重复","未通过","待复核","成功入池","已认领","已推进","成本参考","平均入池成本参考"].map((label)=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{searchStats.map((item)=><tr key={item.query} className="border-t"><td className="max-w-80 px-4 py-3 font-medium text-slate-700">{item.query}</td><td className="px-4 py-3">{item.candidates}</td><td className="px-4 py-3">{item.duplicates}</td><td className="px-4 py-3">{item.rejected}</td><td className="px-4 py-3">{item.review}</td><td className="px-4 py-3 font-medium text-emerald-700">{item.accepted}</td><td className="px-4 py-3">{item.claimed}</td><td className="px-4 py-3">{item.progressed}</td><td className="px-4 py-3">{formatCost(item.cost_usd)}</td><td className="px-4 py-3">{item.accepted?formatCost(item.cost_usd/item.accepted):"—"}</td></tr>)}</tbody></table></div></div></details>:null}
      </div>
      {node}
      <ConfirmDialog
        open={Boolean(action)}
        title={
          action === "PAUSE"
            ? "暂停AI获客任务？"
            : action === "RESUME"
              ? "恢复AI获客任务？"
              : action === "RETRY"
                ? "从检查点重试任务？"
                : action === "REASSESS_REVIEWS"
                  ? "重新核验全部待复核客户？"
                : action === "RECHECK_EVIDENCE_GAPS"
                  ? "重新校验证据缺口？"
                  : "取消AI获客任务？"
        }
        description={
          action === "PAUSE"
            ? "系统将在当前安全节点暂停；暂停期间不会计入有效执行耗时。"
            : action === "RESUME"
              ? "将从已保存节点继续，不重复导入已处理客户。"
              : action === "RETRY"
                ? "只恢复失败或中断的核验项；保留已处理候选和原始发现依据，不重复调用 Google Places 搜索。"
                : action === "REASSESS_REVIEWS"
                  ? "清空待复核客户的旧评分、旧结论与旧渠道检查点，重新核对Google商家、官网及公开渠道，重新提取带来源的联系方式并按现行规则评分；不改动已正确入池、未通过或重复记录。"
                : action === "RECHECK_EVIDENCE_GAPS"
                  ? "只重新核验因Google详情预算降级而缺少主体锚点的候选，不重复搜索，也不改动已正确入池、重复或人工复核结果。"
                  : "已产生的来源、核验和费用明细会保留，未完成候选不会进入客户公海。"
        }
        confirmLabel={
          action === "PAUSE"
            ? "确认暂停"
            : action === "RESUME"
              ? "确认恢复"
              : action === "RETRY"
                ? "确认重试"
                : action === "REASSESS_REVIEWS"
                  ? "开始全面重新核验"
                : action === "RECHECK_EVIDENCE_GAPS"
                  ? "开始重新校验"
                  : "确认取消"
        }
        busy={busy}
        onClose={() => setAction(null)}
        onConfirm={() => void runAction()}
      />
      <AppDialog
        open={Boolean(evidence)}
        title={evidence?.candidate.company_name || "客户核验依据"}
        description="所有联系方式均链接至实际发现该信息的具体公开页面；Google Maps 仅作为发现来源，不代替行业和在营证据。"
        onClose={() => setEvidence(null)}
        width="max-w-5xl"
      >
        {evidence ? (
          <div className="space-y-5">
            {!evidence.evidence_available ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800"><b className="mr-2">早筛依据</b>{evidence.candidate.decision_reason || "该候选在深度核验前已因重复、停业或缺少目标行业信号停止，因此没有生成完整AI证据报告。"}</p> : null}
            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-blue-50 p-4">
                <small>AI评分</small>
                <b className="mt-1 block">
                  {evidence.analysis?.grade || "—"} ·{" "}
                  {evidence.analysis?.score ?? "—"}
                </b>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <small>主体状态</small>
                <b className="mt-1 block">
                  {identityLabel[evidence.analysis?.identity_status || ""] || "主体待核验"}
                </b>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <small>证据充分度</small>
                <b className="mt-1 block">
                  {evidence.analysis?.evidence_sufficiency_score != null ? `${evidence.analysis.evidence_sufficiency_score} / 100` : "—"}
                </b>
              </div>
            </section>
            {evidence.analysis?.short_reason ? <p className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm leading-6 text-slate-700"><b className="mr-2 text-blue-800">核验结论</b>{evidence.analysis.short_reason}</p> : null}
            <VerifiedContactsSection
              contacts={evidence.contacts as VerifiedContactDisplayItem[]}
              customer={{
                country: evidence.candidate.country,
                phone: evidence.candidate.customer_profile?.phone,
                whatsapp: evidence.candidate.customer_profile?.whatsapp,
                email: evidence.candidate.customer_profile?.email,
                website: evidence.candidate.customer_profile?.website || evidence.candidate.source_website,
                google_url: evidence.candidate.customer_profile?.google_url || evidence.candidate.google_url,
                facebook_url: evidence.candidate.customer_profile?.facebook_url,
                instagram_url: evidence.candidate.customer_profile?.instagram_url,
                linkedin_url: evidence.candidate.customer_profile?.linkedin_url,
                tiktok_url: evidence.candidate.customer_profile?.tiktok_url,
              }}
              evidence={evidence.evidence.map((item) => ({
                id: item.id, channel: item.channel || item.source_type, source_type: item.source_type,
                source_url: item.source_url, title: item.title,
                normalized_fact: item.translated_fact || item.normalized_fact || item.content,
                original_excerpt: item.original_excerpt, metadata: item.metadata,
                fetched_at: item.created_at, evidence_type: item.evidence_type,
                evidence_confidence: item.evidence_confidence,
                identity_match_label: identityLabel[item.identity_match_status || ""] || "主体待核验",
              })) as EvidenceDisplayItem[]}
            />
            <section>
              <h3 className="font-semibold">商机线索与销售建议</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-sm"><b className="text-emerald-800">可核验经营/采购线索</b><p className="mt-1 leading-6 text-slate-600">{evidence.analysis?.company_scale_evidence||evidence.analysis?.business_scope||"未发现带来源的采购、批发或经营规模线索"}</p></div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm"><b className="text-blue-800">AI销售建议</b><p className="mt-1 leading-6 text-slate-600">{evidence.analysis?.followup_suggestion||evidence.analysis?.customer_value||"先依据已核验经营事实联系客户，再确认实际采购需求"}</p><small className="mt-2 block text-slate-400">建议不代表客户已经表达采购意向。</small></div>
              </div>
            </section>
            <GroupedEvidenceSection evidence={evidence.evidence.map((item) => ({
              id: item.id, channel: item.channel || item.source_type, source_type: item.source_type,
              source_url: item.source_url, title: item.title,
              normalized_fact: item.translated_fact || item.normalized_fact || item.content,
              original_excerpt: item.original_excerpt, metadata: item.metadata,
              fetched_at: item.created_at, evidence_type: item.evidence_type,
              evidence_confidence: item.evidence_confidence,
              identity_match_label: identityLabel[item.identity_match_status || ""] || "主体待核验",
            })) as EvidenceDisplayItem[]} />
            {canControl&&evidence.candidate.decision==="REVIEW"?<section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-2xl text-sm leading-6 text-slate-500">人工操作不会绕过质量门槛。重新校验仅在行业、主体在营、具体来源页和有效联系方式全部通过后入池。</p><div className="flex gap-2"><button type="button" className={`${button} text-rose-600 hover:border-rose-400 hover:text-rose-700`} onClick={()=>{setReviewAction({action:"DISCARD",candidateId:evidence.candidate.id});setEvidence(null)}}>确认舍弃</button><button type="button" className={primaryButton} onClick={()=>{setReviewAction({action:"RECHECK_AND_ACCEPT",candidateId:evidence.candidate.id});setEvidence(null)}}>重新校验并入池</button></div></section>:null}
          </div>
        ) : null}
      </AppDialog>
      <ConfirmDialog open={Boolean(reviewAction)} title={reviewAction?.action==="DISCARD"?"确认舍弃该客户？":"重新校验该客户？"} description={reviewAction?.action==="DISCARD"?"舍弃后该客户不会进入客户公海，处理依据与审计记录仍会保留。":"系统将重新执行全部准入条件校验；只有证据和有效联系方式均达标且无重复时才会进入客户公海。"} confirmLabel={reviewAction?.action==="DISCARD"?"确认舍弃":"重新校验"} busy={busy} onClose={()=>setReviewAction(null)} onConfirm={()=>void runReviewAction()}/>
    </div></main>
  );
}
