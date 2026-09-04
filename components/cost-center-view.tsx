"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, CircleDollarSign, Coins, Cpu, DatabaseZap, FileDown, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/app-dialog";
import { AppFilterBar, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";

type CostPeriod = "official" | "test" | "all";
type ProviderRow = { provider: string; service: string; request_count: number; total_usd: number; estimated_usd: number };
type CostRow = {
  id: string; provider: string; service: string; operation: string; model_or_sku: string | null;
  input_tokens: number; cached_input_tokens: number; output_tokens: number; amount_usd: number;
  amount_type: "FREE" | "ESTIMATED" | "FINAL"; pricing_snapshot?: { pricing_configured?: boolean } | null;
  occurred_at: string; user?: { name?: string | null; email?: string | null } | null;
  task?: { name?: string | null; task_number?: string | null } | null;
  customer?: { company_name?: string | null } | null;
};
type Payload = {
  data: CostRow[]; count: number; page: number; page_size: number; period: CostPeriod;
  accounting_start_at: string; settings_updated_at: string; effective_from: string; effective_to: string;
  summary: {
    total_usd: number; request_count: number; input_tokens: number; cached_input_tokens: number;
    output_tokens: number; estimated_usd: number; final_usd: number; unknown_pricing_count: number;
    providers: ProviderRow[];
  };
};
type GoogleBilling = { state: "NOT_CONFIGURED" | "CONNECTED" | "NO_DATA" | "ERROR"; message: string; totalUsd?: number; latestUsageAt?: string | null; usageRows?: number };
type OpenAiBilling = { state: "NOT_CONFIGURED" | "CONNECTED" | "NO_DATA" | "ERROR"; message: string; totalUsd?: number; latestUsageAt?: string | null; lineItems?: Array<{ name: string; amountUsd: number }> };

const money = (value: unknown) => `$${Number(value || 0).toFixed(4)}`;
const chinaDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const inputDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

function amountLabel(row: CostRow) {
  if (row.amount_type === "FINAL") return "账单已确认";
  if (row.amount_type === "FREE") return "明确免费";
  if (row.pricing_snapshot?.pricing_configured === false) return "单价待配置";
  return "按价目预估";
}

export function CostCenterView({ embedded = false }: { embedded?: boolean }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState<CostPeriod>("official");
  const [provider, setProvider] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [accountingDate, setAccountingDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [googleBilling, setGoogleBilling] = useState<GoogleBilling | null>(null);
  const [openAiBilling, setOpenAiBilling] = useState<OpenAiBilling | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const query = useMemo(() => {
    const value = new URLSearchParams({ to, period, page: String(page), page_size: String(pageSize) });
    if (from) value.set("from", from);
    if (provider) value.set("provider", provider);
    return value;
  }, [from, page, pageSize, period, provider, to]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/cost-center?${query}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(body.error || "费用数据加载失败"); return; }
    setPayload(body);
    setAccountingDate(inputDate(body.accounting_start_at));
    const [google, openai] = await Promise.all([fetch("/api/cost-center/google-billing", { cache: "no-store" }), fetch("/api/cost-center/openai-billing", { cache: "no-store" })]);
    if (google.ok) setGoogleBilling(await google.json());
    if (openai.ok) setOpenAiBilling(await openai.json());
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  async function saveAccountingStart(action: "SET_DATE" | "RESET_NOW") {
    setSaving(true); setError("");
    const response = await fetch("/api/cost-center", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "RESET_NOW" ? { action } : { action, accounting_start_date: accountingDate }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(body.error || "费用统计周期更新失败"); return; }
    setFrom(""); setPeriod("official"); setPage(1);
    setResetOpen(false);
    await load();
  }

  const summary = payload?.summary;
  const exportQuery = new URLSearchParams({ to, period });
  if (from) exportQuery.set("from", from);
  if (provider) exportQuery.set("provider", provider);
  const scopeLabel = period === "official" ? "正式期" : period === "test" ? "历史测试期" : "全部记录";

  const content = <div className="mx-auto max-w-[1640px]">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold">费用中心</h1><p className="mt-1 text-sm text-slate-500">先核对平台真实账单，再追溯到系统内每一次调用；删除客户或任务不会改变历史账本。</p></div>
      <div className="flex gap-2"><a href={`/api/cost-center/export?${exportQuery}`} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm text-blue-700"><FileDown size={16}/>导出当前明细</a><button onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"><RefreshCw size={16}/>刷新</button></div>
    </div>

    <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><b className="text-sm text-slate-800">正式费用统计起点</b><p className="mt-1 text-xs leading-5 text-slate-600">起点之前的调用归入历史测试期。调整或清空统计不会删除任何真实调用记录。</p></div>
        <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-600">开始日期<input type="date" value={accountingDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setAccountingDate(event.target.value)} className="ml-2 h-9 rounded-lg border bg-white px-3 text-sm"/></label><button disabled={saving || !accountingDate} onClick={() => void saveAccountingStart("SET_DATE")} className="h-9 rounded-lg bg-blue-600 px-4 text-sm text-white disabled:opacity-50">保存开始日期</button><button disabled={saving} onClick={() => setResetOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 text-sm text-amber-700 disabled:opacity-50"><RotateCcw size={15}/>清空正式期统计</button></div>
      </div>
      {payload ? <p className="mt-2 text-xs text-slate-500">当前起点：{chinaDate(payload.accounting_start_at)}{payload.settings_updated_at ? ` · 最近调整：${chinaDate(payload.settings_updated_at)}` : ""}</p> : null}
    </section>

    <AppFilterBar>
      <label className="text-sm">统计范围<select value={period} onChange={(event) => { setPeriod(event.target.value as CostPeriod); setPage(1); }} className={`${appFieldClass} ml-2`}><option value="official">正式期</option><option value="test">历史测试期</option><option value="all">全部记录</option></select></label>
      <label className="text-sm">开始日期<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className={`${appFieldClass} ml-2`}/></label>
      <label className="text-sm">结束日期<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className={`${appFieldClass} ml-2`}/></label>
      <label className="text-sm">服务商<select value={provider} onChange={(event) => { setProvider(event.target.value); setPage(1); }} className={`${appFieldClass} ml-2`}><option value="">全部服务商</option><option value="OPENAI">OpenAI</option><option value="GOOGLE_PLACES">Google Places</option></select></label>
      <button type="button" onClick={() => { setFrom(""); setTo(new Date().toISOString().slice(0, 10)); setProvider(""); setPeriod("official"); setPage(1); }} className="h-10 rounded-lg border bg-white px-4 text-sm">重置筛选</button>
    </AppFilterBar>
    <p className="mt-2 text-xs text-slate-500">当前查看：{scopeLabel}{payload ? ` · 实际查询 ${chinaDate(payload.effective_from)} 至 ${chinaDate(payload.effective_to)}` : ""}</p>
    {Number(summary?.unknown_pricing_count || 0) > 0 ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">有 {summary?.unknown_pricing_count} 次调用尚未配置计费单价，因此暂不计入金额；这不代表接口免费。配置价目后需与平台账单对账。</p> : null}
    <section className="mt-5"><div className="mb-3 flex items-center gap-2"><BadgeDollarSign size={18} className="text-emerald-600"/><div><h2 className="font-semibold text-slate-900">平台真实费用总览</h2><p className="text-xs text-slate-500">仅展示从平台读取的账单；与系统调用台账分开，避免不同统计周期被误认为同一金额。</p></div></div><div className="grid gap-3 xl:grid-cols-2">
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><b>Google Places / Google Cloud</b><p className="mt-1 text-xs text-slate-500">来源：BigQuery 详细费用导出 · 近 90 天</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billingTone(googleBilling?.state)}`}>{billingLabel(googleBilling?.state)}</span></div>{googleBilling ? <div className="mt-5"><b className={`text-3xl ${googleBilling.state === "CONNECTED" ? "text-emerald-700" : "text-slate-400"}`}>{googleBilling.state === "CONNECTED" ? money(googleBilling.totalUsd) : "—"}</b><p className="mt-2 text-sm leading-6 text-slate-700">{googleBilling.message}</p>{googleBilling.state === "CONNECTED" ? <p className="mt-2 text-xs text-slate-500">{Number(googleBilling.usageRows || 0).toLocaleString("zh-CN")} 条结算明细{googleBilling.latestUsageAt ? ` · 最新使用 ${chinaDate(googleBilling.latestUsageAt)}` : ""}</p> : null}</div> : <p className="mt-5 text-sm text-slate-400">正在读取 Google Cloud 账单状态…</p>}<div className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800"><b>免费额度 / 账户余额：</b>BigQuery 账单导出不能读取；未接入实际使用项目的配额监控前，系统不推算余额。</div></article>
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><b>OpenAI</b><p className="mt-1 text-xs text-slate-500">来源：组织 Costs API · 近 90 天</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billingTone(openAiBilling?.state)}`}>{billingLabel(openAiBilling?.state)}</span></div>{openAiBilling ? <div className="mt-5"><b className={`text-3xl ${openAiBilling.state === "CONNECTED" ? "text-emerald-700" : "text-slate-400"}`}>{openAiBilling.state === "CONNECTED" ? money(openAiBilling.totalUsd) : "—"}</b><p className="mt-2 text-sm leading-6 text-slate-700">{openAiBilling.message}</p>{openAiBilling.state === "CONNECTED" ? <><p className="mt-2 text-xs text-slate-500">{openAiBilling.latestUsageAt ? `最新费用归集 ${chinaDate(openAiBilling.latestUsageAt)}` : "暂无最新时间"}</p>{openAiBilling.lineItems?.length ? <p className="mt-2 text-xs leading-5 text-slate-500">主要计费项：{openAiBilling.lineItems.slice(0, 3).map(item => `${item.name} ${money(item.amountUsd)}`).join(" · ")}</p> : null}</> : null}</div> : <p className="mt-5 text-sm text-slate-400">正在读取 OpenAI 组织账单状态…</p>}<div className="mt-5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600"><b>账户余额：</b>OpenAI Costs API 只返回已发生费用，不返回余额；不会将 API Key 或系统台账伪装成余额。</div></article>
    </div></section>
    {error ? <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {loading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div> : payload ? <>
      <section className="mt-6"><div className="mb-3 flex items-center gap-2"><DatabaseZap size={18} className="text-blue-600"/><div><h2 className="font-semibold text-slate-900">系统调用台账</h2><p className="text-xs text-slate-500">{scopeLabel} · {chinaDate(payload.effective_from)} 至 {chinaDate(payload.effective_to)}。用于追溯调用，不等同于平台账单。</p></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["台账金额", money(summary?.total_usd), CircleDollarSign], ["账单已确认", money(summary?.final_usd), Coins],
        ["预估待对账", money(summary?.estimated_usd), Cpu], ["接口调用", `${Number(summary?.request_count || 0).toLocaleString("zh-CN")} 次`, RefreshCw],
      ].map(([label, value, Icon]) => <article key={String(label)} className="rounded-xl border bg-white p-5"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-600"><Icon size={18}/></span><small className="mt-3 block text-slate-500">{String(label)}</small><b className="mt-1 block text-2xl">{String(value)}</b></article>)}</div></section>
      <section className="mt-4 grid gap-3 lg:grid-cols-3">{(summary?.providers || []).map((row) => <article key={`${row.provider}-${row.service}`} className="rounded-xl border bg-white p-4"><b>{row.provider} · {row.service}</b><div className="mt-3 flex justify-between text-sm"><span>{Number(row.request_count).toLocaleString("zh-CN")} 次调用</span><span className="font-semibold text-blue-700">{money(row.total_usd)}</span></div>{Number(row.estimated_usd) > 0 ? <p className="mt-2 text-xs text-amber-700">其中 {money(row.estimated_usd)} 为按价目快照估算，需与平台账单对账。</p> : null}</article>)}</section>
      <section className="mt-4 overflow-hidden rounded-xl border bg-white">
        <div className="overflow-x-auto"><table className="w-full min-w-[1320px] text-left text-sm"><thead className="bg-slate-50"><tr>{["发生时间", "服务商/服务", "操作", "关联任务 / 客户", "模型或计费项", "Token/数量", "费用性质", "金额", "调用人"].map((header) => <th key={header} className="px-4 py-3 font-medium text-slate-600">{header}</th>)}</tr></thead><tbody>{payload.data.map((row) => <tr key={row.id} className="border-t"><td className="px-4 py-3">{chinaDate(row.occurred_at)}</td><td className="px-4 py-3"><b>{row.provider}</b><small className="block text-slate-500">{row.service}</small></td><td className="px-4 py-3">{row.operation}</td><td className="px-4 py-3"><b className="block font-medium">{row.task?.name || "非任务调用"}</b><small className="block text-slate-500">{row.customer?.company_name || "—"}</small></td><td className="px-4 py-3">{row.model_or_sku || "—"}</td><td className="px-4 py-3">{row.input_tokens + row.output_tokens ? `${(row.input_tokens + row.output_tokens).toLocaleString("zh-CN")} Token` : "1 次"}</td><td className="px-4 py-3">{amountLabel(row)}</td><td className="px-4 py-3 font-semibold">{row.pricing_snapshot?.pricing_configured === false ? "待配置" : money(row.amount_usd)}</td><td className="px-4 py-3">{row.user?.name || row.user?.email || "系统"}</td></tr>)}</tbody></table>{!payload.data.length ? <div className="p-12 text-center text-slate-400">当前条件下暂无费用记录</div> : null}</div>
        <AppPagination page={page} pageSize={pageSize} total={payload.count} itemLabel="条费用记录" onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/>
      </section>
    </> : null}
  </div>;
  const dialog=<ConfirmDialog open={resetOpen} title="清空正式期统计？" description="历史调用记录不会删除，只会归入“历史测试期”；客户、任务和费用账本均不受影响。" confirmLabel="确认重置统计起点" danger busy={saving} onCancel={()=>setResetOpen(false)} onConfirm={()=>void saveAccountingStart("RESET_NOW")}/>;
  return embedded ? <>{content}{dialog}</> : <main className="p-4 lg:p-6">{content}{dialog}</main>;
}

function billingLabel(state?: GoogleBilling["state"] | OpenAiBilling["state"]) {
  if (state === "CONNECTED") return "已取得实际账单";
  if (state === "NO_DATA") return "账单数据等待同步";
  if (state === "ERROR") return "读取异常";
  return "尚未配置读取权限";
}

function billingTone(state?: GoogleBilling["state"] | OpenAiBilling["state"]) {
  return state === "CONNECTED" ? "bg-emerald-50 text-emerald-700" : state === "ERROR" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
}
