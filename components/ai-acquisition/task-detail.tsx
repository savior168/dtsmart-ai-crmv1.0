"use client";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pause, Play, RefreshCw, Search, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { CustomerContactSummary } from "@/components/customer-contact-summary";
import { CustomerPublicLink } from "@/components/ui/customer-public-link";
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
  input,
  panel,
  primaryButton,
  useToast,
} from "@/components/ai-screening/ui";
import type { AcquisitionTask, Candidate } from "./types";
import { decisionLabels } from "./types";
type Cost = {
  provider: string;
  model_or_sku: string;
  operation: string;
  amount_usd: number;
  amount_type: string;
  quantity: number;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};
type UsageSummary = {
  total_calls: number;
  free_calls: number;
  google_calls: number;
  openai_calls: number;
  total_cost_usd: number;
  sku_breakdown: Array<{ provider: string; model_or_sku: string; operation: string; calls: number; free_calls: number; amount_usd: number }>;
};
type EvidenceData = {
  candidate: Candidate;
  analysis: {
    score?: number;
    grade?: string;
    short_reason?: string;
    reason?: string;
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
    evidence_type: string;
    evidence_strength: string;
    content_excerpt: string;
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
const tone: Record<string, string> = {
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  REVIEW: "bg-amber-50 text-amber-700",
  REJECTED: "bg-slate-100 text-slate-600",
  DUPLICATE: "bg-violet-50 text-violet-700",
  FAILED: "bg-rose-50 text-rose-700",
  ANALYZING: "bg-blue-50 text-blue-700",
};
type CompletionInfo = { budget_limited: boolean; blocked_periods: string[];incremental_skipped?:number;concurrently_skipped?:number;no_new_search_units?:boolean };
type DiscoveryProgress = { stage:string;stage_detail:string|null;total:number;completed:number;raw_hits:number;incremental_skipped?:number;concurrently_skipped?:number;current_query:string|null;current_country:string|null;updated_at:string|null };
type SearchStat = {query:string;candidates:number;duplicates:number;rejected:number;review:number;accepted:number;claimed:number;progressed:number;cost_usd:number};
const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });
function SocialChannels({candidate}:{candidate:Candidate}) {
  const profile=candidate.customer_profile;
  const links=[
    ["Facebook",profile?.facebook_url,"bg-blue-50 text-blue-700"],
    ["Instagram",profile?.instagram_url,"bg-pink-50 text-pink-700"],
    ["LinkedIn",profile?.linkedin_url,"bg-sky-50 text-sky-700"],
    ["TikTok",profile?.tiktok_url,"bg-slate-100 text-slate-700"],
    ...(profile?.other_public_urls||[]).map((url)=>["公开渠道",url,"bg-slate-50 text-slate-600"]),
  ].filter((item)=>Boolean(String(item[1]||"").trim()));
  if(!links.length)return <span className="text-slate-400">—</span>;
  return <div className="flex max-w-44 flex-wrap gap-1">{links.map(([label,raw,tone],index)=>{const value=String(raw);const href=/^https?:\/\//i.test(value)?value:`https://${value}`;return <a key={`${label}-${index}`} href={href} target="_blank" rel="noreferrer" title={`打开${label}来源`} className={`rounded-md px-2 py-1 text-xs hover:underline ${tone}`}>{label}</a>})}</div>;
}
export function AcquisitionTaskDetail({ taskId, initialDecision="" }: { taskId: string; initialDecision?:string }) {
  const [task, setTask] = useState<AcquisitionTask | null>(null),
    [rows, setRows] = useState<Candidate[]>([]),
    [costs, setCosts] = useState<Cost[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [decision, setDecision] = useState(initialDecision),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [country, setCountry] = useState(""),
    [level, setLevel] = useState(""),
    [readiness, setReadiness] = useState(""),
    [usage, setUsage] = useState<UsageSummary | null>(null),
    [completion, setCompletion] = useState<CompletionInfo>({budget_limited:false,blocked_periods:[]}),
    [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress | null>(null),
    [searchStats, setSearchStats] = useState<SearchStat[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [canControl, setCanControl] = useState(false),
    [canEvidence, setCanEvidence] = useState(false),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<"PAUSE" | "RESUME" | "CANCEL" | "RETRY" | null>(null),
    [evidence, setEvidence] = useState<EvidenceData | null>(null),
    [evidenceLoading, setEvidenceLoading] = useState(false),
    [reviewAction, setReviewAction] = useState<{action:"DISCARD" | "RECHECK_AND_ACCEPT";candidateId:string} | null>(null);
  const { toast, node } = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (decision) p.set("decision", decision);
      if (search) p.set("search", search);
      if (country) p.set("country", country);
      if (level) p.set("level", level);
      if (readiness) p.set("readiness", readiness);
      const r = await fetch(`/api/ai-acquisition/tasks/${taskId}?${p}`, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "加载失败");
      setTask(b.task);
      setRows(b.candidates || []);
      setCount(b.count || 0);
      setCosts(b.costs || []);
      setUsage(b.usage_summary || null);
      setCompletion(b.completion || {budget_limited:false,blocked_periods:[]});
      setDiscoveryProgress(b.discovery_progress || null);
      setSearchStats(b.search_stats || []);
      setCanControl(Boolean(b.can_control));
      setCanEvidence(Boolean(b.can_view_evidence));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [taskId, page, pageSize, decision, search, country, level, readiness]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!task || !["QUEUED", "RUNNING", "PAUSING"].includes(task.status))
      return;
    const id = setInterval(() => void load(), 8000);
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
      const r = await fetch(`/api/ai-acquisition/candidates/${id}/evidence`, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "依据加载失败");
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
  const totalCost = usage?.total_cost_usd ?? costs.reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title={task.name}
        description={
          <span>
            {task.task_number} · {(task.industries?.length ? task.industries : [task.industry]).join("、")} · {task.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、")}
          </span>
        }
        actions={
          <>
            <Link href="/ai-acquisition" className={button}>
              返回任务中心
            </Link>
            <button className={button} onClick={() => void load()}>
              <RefreshCw size={15} />
              刷新
            </button>
            {canControl && task.status === "RUNNING" ? (
              <button className={button} onClick={() => setAction("PAUSE")}>
                <Pause size={15} />
                暂停
              </button>
            ) : null}
            {canControl && task.status === "PAUSED" ? (
              <button className={button} onClick={() => setAction("RESUME")}>
                <Play size={15} />
                恢复
              </button>
            ) : null}
            {canControl && task.status === "FAILED" ? (
              <button className={button} onClick={() => setAction("RETRY")}>
                <RefreshCw size={15} />
                重试未完成项
              </button>
            ) : null}
            {canControl &&
            ["QUEUED", "RUNNING", "PAUSING", "PAUSED"].includes(task.status) ? (
              <button
                className={`${button} text-rose-600`}
                onClick={() => setAction("CANCEL")}
              >
                <Square size={14} />
                取消任务
              </button>
            ) : null}
          </>
        }
      />
      {task.scheduled_at ? <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><CalendarClock size={16}/><b>预约执行：</b>{new Date(task.scheduled_at).toLocaleString("zh-CN",{hour12:false})}<span className="text-blue-600">（预约等待时间不计入有效耗时）</span></div> : null}
      {discoveryProgress && ["QUEUED","RUNNING","PAUSING","PAUSED"].includes(task.status) ? <section className={`${panel} p-4`} aria-label="AI获客实时执行进度"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><b className="text-sm">{{WAITING:"等待开始执行",DISCOVERY:"正在搜索目标客户",DEDUPLICATING:"正在去重与目标初判",VERIFYING:"正在核验候选客户",FINALIZING:"正在执行入池判定"}[discoveryProgress.stage]||"正在执行AI获客"}</b><StatusBadge status={task.status}/></div><p className="mt-1 text-xs text-slate-500">{discoveryProgress.stage_detail||`已完成 ${discoveryProgress.completed} / ${discoveryProgress.total} 个实际本地化检索表达`}</p></div>{discoveryProgress.updated_at?<small className="text-slate-400">最近更新 {new Date(discoveryProgress.updated_at).toLocaleString("zh-CN",{hour12:false})}</small>:null}</div>{discoveryProgress.total>0?<><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{width:`${Math.min(100,Math.round(discoveryProgress.completed/discoveryProgress.total*100))}%`}}/></div><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500"><span>检索表达 {discoveryProgress.completed} / {discoveryProgress.total}</span><span>原始命中 {discoveryProgress.raw_hits} 条（未去重）</span>{discoveryProgress.incremental_skipped?<span>历史已覆盖跳过 {discoveryProgress.incremental_skipped} 项</span>:null}{discoveryProgress.concurrently_skipped?<span>其他任务执行中 {discoveryProgress.concurrently_skipped} 项</span>:null}<span>已保存候选 {task.discovered_count} 条</span><span>成功入池 {task.accepted_count} 条</span></div></>:null}{discoveryProgress.current_query?<div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm"><span className="text-slate-500">当前检索：</span><b className="ml-2 text-blue-800">{discoveryProgress.current_query}</b>{discoveryProgress.current_country?<span className="ml-2 text-xs text-blue-600">· {COUNTRY_NAMES.of(discoveryProgress.current_country)||discoveryProgress.current_country}</span>:null}</div>:null}</section>:null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["状态", <StatusBadge key="s" status={task.status} />],
          ["获客模式", <CostModeBadge key="m" mode={task.cost_mode} context="acquisition" />],
          [
            "发现 / 已处理",
            `${task.discovered_count} / ${task.processed_count}`,
          ],
          ["已入公海", task.accepted_count],
          ["待复核", task.review_count],
          ["有效耗时", formatDuration(effectiveElapsedMs(task))],
        ].map(([l, v]) => (
          <article key={String(l)} className={`${panel} p-4`}>
            <small className="text-slate-500">{l}</small>
            <div className="mt-2 text-lg font-semibold">{v}</div>
          </article>
        ))}
      </section>
      {task.error_message ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {task.error_message}
        </div>
      ) : null}
      <div className={`rounded-lg border px-4 py-3 text-sm ${task.status==="COMPLETED"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-blue-100 bg-blue-50/60 text-blue-800"}`}>
        <b>{task.status==="COMPLETED"?(completion.budget_limited?"已按费用边界完成":completion.no_new_search_units?"增量检查已完成":"本次获客已完成"):"任务完成条件"}：</b>
        {task.status==="COMPLETED"
          ? completion.budget_limited
            ? "付费路径达到任务或全局限制后停止，已发现候选仍已完成去重与质量判定；未通过准入门槛的数据不会进入客户公海。"
            : completion.no_new_search_units
              ? `本次范围没有新的待检索单元：近期已覆盖 ${completion.incremental_skipped||0} 项，其他任务执行中 ${completion.concurrently_skipped||0} 项；未重复调用、补证或分析。`
              : "本次国家/地区、目标行业、本地化检索表达和已支持来源均已执行，全部新候选已完成去重与质量判定。"
          : "执行完本次有限检索计划并处理完全部新候选后自动结束；连续分页无新候选会提前结束，不会无限采集。"}
      </div>
      {searchStats.length?<section className={panel}><div className="border-b px-5 py-4"><h2 className="font-semibold">实际检索表达效果</h2><p className="mt-1 text-xs text-slate-500">按客户首次发现的实际本地化检索表达归因；费用包含可明确归属的搜索与候选核验调用，不重复分摊同一笔费用。</p></div><div className="max-h-80 overflow-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr>{["实际检索表达","候选","重复","早停/未通过","待复核","成功入池","已认领","已推进","可归属费用","入池成本"].map((label)=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{searchStats.map((item)=><tr key={item.query} className="border-t"><td className="max-w-80 px-4 py-3 font-medium text-slate-700">{item.query}</td><td className="px-4 py-3">{item.candidates}</td><td className="px-4 py-3">{item.duplicates}</td><td className="px-4 py-3">{item.rejected}</td><td className="px-4 py-3">{item.review}</td><td className="px-4 py-3 font-medium text-emerald-700">{item.accepted}</td><td className="px-4 py-3">{item.claimed}</td><td className="px-4 py-3">{item.progressed}</td><td className="px-4 py-3">{formatCost(item.cost_usd)}</td><td className="px-4 py-3">{item.accepted?formatCost(item.cost_usd/item.accepted):"—"}</td></tr>)}</tbody></table></div></section>:null}
      <section className={panel}>
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
          <form className="grid w-full gap-2 border-b p-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_repeat(3,minmax(140px,auto))_auto]" onSubmit={(event)=>{event.preventDefault();setPage(1);setSearch(draft.trim())}}>
          <label className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input className={`${input} w-full pl-9`} value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder="搜索客户名称或地址"/></label>
          <select className={`${input} w-full`} value={country} onChange={(event)=>{setPage(1);setCountry(event.target.value)}}><option value="">全部国家/地区</option>{task.countries.map((item)=><option key={item} value={item}>{COUNTRY_NAMES.of(item)||item}</option>)}</select>
          <select className={`${input} w-full`} value={readiness} onChange={(event)=>{setPage(1);setReadiness(event.target.value)}}><option value="">全部开发条件</option><option value="ACTIONABLE">可直接开发</option><option value="NO_CONTACT">缺少有效联系方式</option><option value="EVIDENCE_GAP">依据不足</option></select>
          <select className={`${input} w-full`} value={level} onChange={(event)=>{setPage(1);setLevel(event.target.value)}}><option value="">全部AI等级</option>{["A","B","C","D"].map((item)=><option key={item} value={item}>{item}级</option>)}</select>
          <div className="flex gap-2"><button className={button}>查询</button>{(search||decision||country||level||readiness)?<button type="button" className="text-sm text-blue-700" onClick={()=>{setDraft("");setSearch("");setDecision("");setCountry("");setLevel("");setReadiness("");setPage(1)}}>清除</button>:null}</div>
          </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1540px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "客户",
                  "AI评分",
                  "国家 / 地址",
                  "已核验联系方式",
                  "官网",
                  "Google Maps",
                  "社媒渠道",
                  "商机线索",
                  "结果与说明",
                  "操作",
                ].map((x) => (
                  <th key={x} className="px-4 py-3 font-medium">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-4 font-medium text-slate-800">
                    <span className="block max-w-56">{r.company_name}</span>
                    <small className="mt-1 block text-emerald-700">AI核验：{r.customer_profile?.industry||r.customer_profile?.category||"待确认行业"}</small>
                    {r.matched_keywords?.length?<div className="mt-2 flex max-w-64 flex-wrap gap-1" title={`匹配关键词：${r.matched_keywords.join("、")}`}>{r.matched_keywords.slice(0,3).map((keyword)=><span key={keyword} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-normal text-blue-700">{keyword}</span>)}{r.matched_keywords.length>3?<span className="text-[11px] font-normal text-slate-400">+{r.matched_keywords.length-3}</span>:null}</div>:null}
                  </td>
                  <td className="px-4 py-4">
                    {r.ai_score == null
                      ? "—"
                      : `${r.ai_level || "—"} · ${r.ai_score}`}
                  </td>
                  <td className="max-w-60 px-4 py-4">
                    <b>{COUNTRY_NAMES.of(r.country) || r.country}</b>
                    <small className="mt-1 block text-slate-500">
                      {r.address || "—"}
                    </small>
                  </td>
                  <td className="max-w-64 px-4 py-4">
                    <CustomerContactSummary customer={{...r.customer_profile,country:r.country,verified_contacts:r.verified_contacts}} source="ai"/>
                  </td>
                  <td className="px-4 py-4"><CustomerPublicLink value={r.customer_profile?.website} kind="website"/></td>
                  <td className="px-4 py-4"><CustomerPublicLink value={r.customer_profile?.google_url||r.google_url} kind="map"/></td>
                  <td className="px-4 py-4"><SocialChannels candidate={r}/></td>
                  <td className="max-w-72 px-4 py-4"><b className="text-xs font-medium text-slate-700">{r.customer_profile?.company_scale_evidence?"已核验线索":"销售判断"}</b><p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500">{r.customer_profile?.company_scale_evidence||r.customer_profile?.customer_value||"暂无可核验的采购、批发或经营规模线索"}</p></td>
                  <td className="max-w-80 px-4 py-4 text-slate-600">
                    <span className={`rounded-md px-2 py-1 text-xs ${tone[r.decision] || "bg-slate-100"}`}>{decisionLabels[r.decision] || r.decision}</span>
                    <small className="mt-2 block leading-5">{r.decision_reason || "—"}</small>
                    <small className={`mt-1 block ${r.evidence_complete&&r.has_actionable_contact?"text-emerald-700":"text-amber-700"}`}>{r.evidence_complete?"依据通过":"依据不足"} · {r.has_actionable_contact?"联系方式通过":"联系方式不足"}</small>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex gap-2">
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
                          href={`/customers/${r.imported_customer_id}`}
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
            <div className="grid h-40 place-items-center text-sm text-slate-400">
              暂无匹配记录
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
      <section className={panel}>
        <div className="border-b p-4">
          <h2 className="font-semibold">第三方调用与费用明细</h2>
          <p className="mt-1 text-xs text-slate-500">
            共 {usage?.total_calls ?? costs.length} 条已记录调用 · 费用 {formatCost(totalCost)}
            ；最终费用以服务商账单为准。
          </p>
        </div>
        {usage ? <><div className="grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-5">{[["累计费用",formatCost(usage.total_cost_usd)],["全部调用",usage.total_calls],["免费额度调用",usage.free_calls],["Google Places",usage.google_calls],["大模型",usage.openai_calls]].map(([label,value])=><div key={String(label)} className="rounded-lg bg-slate-50 px-4 py-3"><small className="text-slate-500">{label}</small><b className="mt-1 block text-lg">{value}</b></div>)}</div>{usage.sku_breakdown.length?<div className="border-b p-4"><h3 className="text-sm font-semibold">SKU / 模型汇总</h3><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-2">服务商</th><th>SKU / 模型</th><th>用途</th><th>调用</th><th>免费</th><th>金额</th></tr></thead><tbody>{usage.sku_breakdown.map((item)=><tr key={`${item.provider}-${item.model_or_sku}-${item.operation}`} className="border-t"><td className="py-2">{item.provider}</td><td>{item.model_or_sku}</td><td>{item.operation}</td><td>{item.calls}</td><td>{item.free_calls}</td><td>{formatCost(item.amount_usd)}</td></tr>)}</tbody></table></div></div>:null}</> : null}
        <div className="px-4 pt-4 text-xs text-slate-500">最近调用记录（完整累计以汇总数据为准）</div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "时间",
                  "服务商",
                  "SKU / 模型",
                  "操作",
                  "用量",
                  "费用状态",
                  "金额",
                ].map((x) => (
                  <th key={x} className="px-4 py-3 font-medium">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {costs.map((c, i) => (
                <tr key={`${c.occurred_at}-${i}`} className="border-t">
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(c.occurred_at).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </td>
                  <td className="px-4 py-3">{c.provider}</td>
                  <td className="px-4 py-3">{c.model_or_sku}</td>
                  <td className="px-4 py-3">{c.operation}</td>
                  <td className="px-4 py-3">{c.quantity}</td>
                  <td className="px-4 py-3">
                    {c.amount_type === "FREE" ? "免费额度" : "计费/预估"}
                  </td>
                  <td className="px-4 py-3">{formatCost(c.amount_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!costs.length ? (
            <div className="p-8 text-center text-sm text-slate-400">
              暂无已记录调用
            </div>
          ) : null}
        </div>
      </section>
      {node}
      <ConfirmDialog
        open={Boolean(action)}
        title={
          action === "PAUSE"
            ? "暂停AI获客任务？"
            : action === "RESUME"
              ? "恢复AI获客任务？"
              : action === "RETRY"
                ? "重试未完成候选？"
              : "取消AI获客任务？"
        }
        description={
          action === "PAUSE"
            ? "系统将在当前安全节点暂停；暂停期间不会计入有效执行耗时。"
            : action === "RESUME"
              ? "将从已保存节点继续，不重复导入已处理客户。"
              : action === "RETRY"
                ? "只恢复失败或中断的核验项；保留已处理候选和原始发现依据，不重复调用 Google Places 搜索。"
              : "已产生的来源、核验和费用明细会保留，未完成候选不会进入客户公海。"
        }
        confirmLabel={
          action === "PAUSE"
            ? "确认暂停"
            : action === "RESUME"
              ? "确认恢复"
              : action === "RETRY"
                ? "确认重试"
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
                  {evidence.analysis?.identity_status || "—"}
                </b>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <small>证据充分度</small>
                <b className="mt-1 block">
                  {evidence.analysis?.evidence_sufficiency_score ?? "—"}
                </b>
              </div>
            </section>
            <section>
              <h3 className="font-semibold">可开发联系方式</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {evidence.contacts.map((c) => (
                  <div key={c.id} className="rounded-lg border p-3 text-sm">
                    <div><b>{c.type === "WHATSAPP" ? "WhatsApp" : c.type === "EMAIL" ? "邮箱" : "电话"}</b><span className="ml-2 break-all text-blue-700">{c.value_raw}</span></div>
                    <small className="mt-1 block text-slate-500">{c.verification_status} · {c.source_channel}</small>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <a href={c.exact_source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">核验具体来源<ExternalLink size={12}/></a>
                      {c.type === "WHATSAPP" ? <a href={`https://wa.me/${String(c.value_raw).replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline">发起WhatsApp对话<ExternalLink size={12}/></a> : null}
                    </div>
                  </div>
                ))}
                {!evidence.contacts.length ? (
                  <p className="text-sm text-slate-400">
                    没有通过来源核验的联系方式
                  </p>
                ) : null}
              </div>
            </section>
            <section>
              <h3 className="font-semibold">商机线索与销售建议</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-sm"><b className="text-emerald-800">可核验经营/采购线索</b><p className="mt-1 leading-6 text-slate-600">{evidence.analysis?.company_scale_evidence||evidence.analysis?.business_scope||"未发现带来源的采购、批发或经营规模线索"}</p></div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm"><b className="text-blue-800">AI销售建议</b><p className="mt-1 leading-6 text-slate-600">{evidence.analysis?.followup_suggestion||evidence.analysis?.customer_value||"先依据已核验经营事实联系客户，再确认实际采购需求"}</p><small className="mt-2 block text-slate-400">建议不代表客户已经表达采购意向。</small></div>
              </div>
            </section>
            <section>
              <h3 className="font-semibold">采集分析依据</h3>
              <div className="mt-2 space-y-2">
                {evidence.evidence.map((e) => (
                  <a
                    key={e.id}
                    href={e.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border p-3 hover:border-blue-300"
                  >
                    <div className="flex justify-between gap-3">
                      <b className="text-sm">
                        {e.evidence_type || e.source_type}
                      </b>
                      <span className="text-xs text-slate-400">
                        {e.evidence_strength}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {e.content_excerpt || e.source_url}
                    </p>
                    <small className="mt-1 block truncate text-blue-700">
                      {e.source_url}
                    </small>
                  </a>
                ))}
              </div>
            </section>
            {canControl&&evidence.candidate.decision==="REVIEW"?<section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-2xl text-sm leading-6 text-slate-500">人工操作不会绕过质量门槛。重新校验仅在行业、主体在营、具体来源页和有效联系方式全部通过后入池。</p><div className="flex gap-2"><button type="button" className={`${button} text-rose-600 hover:border-rose-400 hover:text-rose-700`} onClick={()=>{setReviewAction({action:"DISCARD",candidateId:evidence.candidate.id});setEvidence(null)}}>确认舍弃</button><button type="button" className={primaryButton} onClick={()=>{setReviewAction({action:"RECHECK_AND_ACCEPT",candidateId:evidence.candidate.id});setEvidence(null)}}>重新校验并入池</button></div></section>:null}
          </div>
        ) : null}
      </AppDialog>
      <ConfirmDialog open={Boolean(reviewAction)} title={reviewAction?.action==="DISCARD"?"确认舍弃该客户？":"重新校验该客户？"} description={reviewAction?.action==="DISCARD"?"舍弃后该客户不会进入客户公海，处理依据与审计记录仍会保留。":"系统将重新执行全部准入条件校验；只有证据和有效联系方式均达标且无重复时才会进入客户公海。"} confirmLabel={reviewAction?.action==="DISCARD"?"确认舍弃":"重新校验"} busy={busy} onClose={()=>setReviewAction(null)} onConfirm={()=>void runReviewAction()}/>
    </div></main>
  );
}
