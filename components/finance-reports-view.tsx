"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { AppSelect } from "@/components/ui/app-select";
import { BUSINESS_DATE_PRESETS, businessDatePreset, type BusinessDatePreset } from "@/lib/reports/date-presets";

type Summary = { note_count: number; supplier_count: number; quantity: number; allocated_cny: number; paid_cny: number; unpaid_cny: number; cash_paid_reported_cny: number };
type Note = { id: string; note_number?: string | null; supplier_name?: string | null; document_date?: string | null; allocated_cny?: number | null; paid_cny?: number | null; unpaid_cny?: number | null };
type SupplierOption = { supplier_id: string; system_code: string; supplier_name: string | null };
type Report = { summary: Summary; notes: Note[] };
const money = (value: number | null | undefined) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FinanceReportsView({ canViewReconciliation }: { canViewReconciliation: boolean }) {
  const [initial] = useState(() => businessDatePreset("month"));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selectedPreset, setSelectedPreset] = useState<BusinessDatePreset | "">("month");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ from: initial.from, to: initial.to, supplierId: "", search: "" });
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setReport(null);
    try {
      const params = new URLSearchParams({ from: applied.from, to: applied.to, page_size: "10" });
      if (applied.supplierId) params.set("supplier_id", applied.supplierId);
      if (applied.search) params.set("search", applied.search);
      const response = await fetch(`/api/supplier-reconciliation?${params}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.summary) throw new Error(body.error || "财务报表加载失败");
      if (!signal?.aborted) {
        setReport({ summary: body.summary, notes: Array.isArray(body.notes) ? body.notes : [] });
        if (!applied.supplierId && !applied.search) setSupplierOptions(Array.isArray(body.supplier_summary) ? body.supplier_summary : []);
      }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "财务报表加载失败"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [applied]);
  useEffect(() => { if (!canViewReconciliation) { setLoading(false); return; } const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [canViewReconciliation, load]);
  function query() {
    if (!from || !to || from > to) { setError("请选择有效的送货日期范围"); return; }
    if (search.trim().length > 80) { setError("搜索词不能超过80字"); return; }
    setApplied({ from, to, supplierId, search: search.trim() });
  }
  const detailParams = new URLSearchParams({ from: applied.from, to: applied.to });
  if (applied.supplierId) detailParams.set("supplier_id", applied.supplierId);
  if (applied.search) detailParams.set("search", applied.search);
  const detailHref = `/supplier-reconciliation?${detailParams}`;
  const metrics = report ? [
    ["期间送货单", `${report.summary.note_count} 张`], ["涉及供应商", `${report.summary.supplier_count} 家`],
    ["应付货款", money(report.summary.allocated_cny)], ["已登记付款", money(report.summary.paid_cny)],
    ["未付货款", money(report.summary.unpaid_cny)], ["现场报付待核", money(report.summary.cash_paid_reported_cny)],
  ] : [];
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1600px]">
    <header><h1 className="text-2xl font-bold">报表中心</h1><p className="mt-1 text-sm text-slate-500">财务对账与付款统计；只按所选送货日期汇总，不代表历史累计余额。</p></header>
    {!canViewReconciliation ? <p className="mt-4 rounded-xl border bg-white p-4 text-sm text-slate-600">当前未授权查看供应商对账数据，请联系系统管理员配置权限。</p> : null}
    {canViewReconciliation ? <section className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <CompactDateRange label="送货日期" fromLabel="送货开始日期" toLabel="送货结束日期" from={from} to={to} onFromChange={value => { setFrom(value); setSelectedPreset(""); }} onToChange={value => { setTo(value); setSelectedPreset(""); }} presets={BUSINESS_DATE_PRESETS} selectedPreset={selectedPreset} onPresetChange={value => { if (!value) { setSelectedPreset(""); return; } const range = businessDatePreset(value as BusinessDatePreset); setFrom(range.from); setTo(range.to); setSelectedPreset(value as BusinessDatePreset); }} onMonthRangeApply={range => { setFrom(range.from); setTo(range.to); setSelectedPreset(""); }}/>
      <AppSelect aria-label="按供应商筛选财务报表" value={supplierId} onChange={event => setSupplierId(event.target.value)} className="h-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 text-sm" forceSearch><option value="">全部供应商</option>{supplierOptions.map(option => <option key={option.supplier_id} value={option.supplier_id}>{option.system_code}{option.supplier_name ? ` · ${option.supplier_name}` : ""}</option>)}</AppSelect>
      <input aria-label="搜索送货单号、供应商代码或PI订单号" value={search} onChange={event => setSearch(event.target.value)} maxLength={80} placeholder="送货单号 / 供应商代码 / PI号" className="h-10 min-w-52 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
      <button type="button" onClick={query} className="h-10 rounded-lg bg-blue-600 px-5 text-sm text-white">查询</button>
      <button type="button" onClick={() => { const range = businessDatePreset("month"); setFrom(range.from); setTo(range.to); setSelectedPreset("month"); setSupplierId(""); setSearch(""); setApplied({ ...range, supplierId: "", search: "" }); }} className="h-10 rounded-lg border border-slate-200 px-4 text-sm text-slate-700">重置</button>
    </section> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {loading && !report ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600" aria-label="加载中" /></div> : report ? <>
      <section className="mt-6"><p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">财务运营</p><h2 className="mt-1 text-lg font-semibold">供应商对账与付款</h2><p className="mt-1 text-xs text-slate-500">按送货日期筛选；点击指标进入对账页面核对明细。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{metrics.map(([label, value]) => <Link key={label} href={detailHref} className="rounded-xl border bg-white p-4 shadow-sm hover:border-blue-300"><small className="text-slate-500">{label}</small><b className="mt-3 block text-xl tabular-nums text-slate-950">{value}</b></Link>)}</div>
      </section>
      <section className="mt-5 overflow-hidden rounded-xl border bg-white"><div className="flex items-center justify-between border-b p-4"><h2 className="font-semibold">期间送货单明细</h2><Link href={detailHref} className="text-sm text-blue-600">查看全部</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["送货单", "供应商", "送货日期", "应付", "已登记付款", "未付"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{report.notes.map(note => <tr key={note.id} className="border-t"><td className="px-4 py-3">{note.note_number || note.id.slice(0, 8)}</td><td className="px-4 py-3">{note.supplier_name || "—"}</td><td className="px-4 py-3">{note.document_date || "—"}</td><td className="px-4 py-3">{money(note.allocated_cny)}</td><td className="px-4 py-3">{money(note.paid_cny)}</td><td className="px-4 py-3">{money(note.unpaid_cny)}</td></tr>)}</tbody></table>{!report.notes.length ? <p className="p-8 text-center text-sm text-slate-500">该期间暂无送货单</p> : null}</div></section>
    </> : null}
  </div></main>;
}
