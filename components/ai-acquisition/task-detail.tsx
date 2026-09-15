"use client";
import Link from "next/link";
import { ExternalLink, Pause, Play, RefreshCw, Search, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
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
export function AcquisitionTaskDetail({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AcquisitionTask | null>(null),
    [rows, setRows] = useState<Candidate[]>([]),
    [costs, setCosts] = useState<Cost[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [decision, setDecision] = useState(""),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [country, setCountry] = useState(""),
    [level, setLevel] = useState(""),
    [readiness, setReadiness] = useState(""),
    [usage, setUsage] = useState<UsageSummary | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [canControl, setCanControl] = useState(false),
    [canEvidence, setCanEvidence] = useState(false),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<"PAUSE" | "RESUME" | "CANCEL" | "RETRY" | null>(null),
    [evidence, setEvidence] = useState<EvidenceData | null>(null),
    [evidenceLoading, setEvidenceLoading] = useState(false);
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
  if (loading && !task)
    return (
      <main className="p-5">
        <Loading />
      </main>
    );
  if (error && !task)
    return (
      <main className="p-5">
        <ErrorState message={error} reload={() => void load()} />
      </main>
    );
  if (!task) return null;
  const totalCost = usage?.total_cost_usd ?? costs.reduce((s, c) => s + Number(c.amount_usd || 0), 0);
  return (
    <main className="space-y-5 p-5">
      <PageHeader
        title={task.name}
        description={
          <span>
            {task.task_number} · {task.industry} · {task.countries.join("、")}
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
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["状态", <StatusBadge key="s" status={task.status} />],
          ["成本模式", <CostModeBadge key="m" mode={task.cost_mode} />],
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
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold">候选客户与处理依据</h2>
            <p className="mt-1 text-xs text-slate-500">
              未通过、待复核和重复记录不会进入客户公海。
            </p>
          </div>
          <form className="grid w-full gap-2 md:grid-cols-2 xl:w-auto xl:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(130px,auto))_auto]" onSubmit={(event)=>{event.preventDefault();setPage(1);setSearch(draft.trim())}}>
          <label className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input className={`${input} w-full pl-9`} value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder="搜索客户名称或地址"/></label>
          <select
            className={`${input} w-full`}
            value={decision}
            onChange={(e) => {
              setPage(1);
              setDecision(e.target.value);
            }}
          >
            <option value="">全部判断</option>
            {Object.entries(decisionLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className={`${input} w-full`} value={country} onChange={(event)=>{setPage(1);setCountry(event.target.value)}}><option value="">全部国家/地区</option>{task.countries.map((item)=><option key={item} value={item}>{item}</option>)}</select>
          <select className={`${input} w-full`} value={readiness} onChange={(event)=>{setPage(1);setReadiness(event.target.value)}}><option value="">全部开发条件</option><option value="ACTIONABLE">可直接开发</option><option value="NO_CONTACT">缺少有效联系方式</option><option value="EVIDENCE_GAP">依据不足</option></select>
          <select className={`${input} w-full`} value={level} onChange={(event)=>{setPage(1);setLevel(event.target.value)}}><option value="">全部AI等级</option>{["A","B","C","D"].map((item)=><option key={item} value={item}>{item}级</option>)}</select>
          <div className="flex gap-2"><button className={button}>查询</button>{(search||decision||country||level||readiness)?<button type="button" className="text-sm text-blue-700" onClick={()=>{setDraft("");setSearch("");setDecision("");setCountry("");setLevel("");setReadiness("");setPage(1)}}>清除</button>:null}</div>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "客户",
                  "国家 / 地址",
                  "判断",
                  "AI评分",
                  "入池条件",
                  "发现来源",
                  "处理说明",
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
                    {r.company_name}
                  </td>
                  <td className="max-w-60 px-4 py-4">
                    <b>{r.country}</b>
                    <small className="mt-1 block text-slate-500">
                      {r.address || "—"}
                    </small>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded-md px-2 py-1 text-xs ${tone[r.decision] || "bg-slate-100"}`}
                    >
                      {decisionLabels[r.decision] || r.decision}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {r.ai_score == null
                      ? "—"
                      : `${r.ai_level || "—"} · ${r.ai_score}`}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={
                        r.evidence_complete
                          ? "text-emerald-700"
                          : "text-slate-400"
                      }
                    >
                      依据{r.evidence_complete ? "通过" : "不足"}
                    </span>
                    <br />
                    <span
                      className={
                        r.has_actionable_contact
                          ? "text-emerald-700"
                          : "text-slate-400"
                      }
                    >
                      联系路径{r.has_actionable_contact ? "通过" : "不足"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {r.google_url ? (
                      <a
                        href={r.google_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                      >
                        Google Maps
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      "—"
                    )}
                    <small className="mt-1 block text-slate-400">
                      {r.source_query}
                    </small>
                  </td>
                  <td className="max-w-72 px-4 py-4 text-slate-600">
                    {r.decision_reason || "—"}
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
          </div>
        ) : null}
      </AppDialog>
    </main>
  );
}
