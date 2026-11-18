"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileDown, LoaderCircle } from "lucide-react";

type Summary = { note_count: number; supplier_count: number; quantity: number; allocated_cny: number; paid_cny: number; unpaid_cny: number; cash_paid_reported_cny: number };
type Note = { id: string; note_number?: string | null; supplier_name?: string | null; document_date?: string | null; allocated_cny?: number | null; paid_cny?: number | null; unpaid_cny?: number | null };
type Report = { summary: Summary; notes: Note[] };
const money = (value: number | null | undefined) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function monthRange() { const now = new Date(); return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` }; }

export function FinanceReportsView({ canViewReconciliation }: { canViewReconciliation: boolean }) {
  const [initial] = useState(monthRange);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!from || !to || from > to) { setError("请选择有效的送货日期范围"); setLoading(false); return; }
    setLoading(true); setError(""); setReport(null);
    try {
      const params = new URLSearchParams({ from, to, page_size: "10" });
      const response = await fetch(`/api/supplier-reconciliation?${params}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.summary) throw new Error(body.error || "财务报表加载失败");
      if (!signal?.aborted) setReport({ summary: body.summary, notes: Array.isArray(body.notes) ? body.notes : [] });
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "财务报表加载失败"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [from, to]);
  useEffect(() => { if (!canViewReconciliation) { setLoading(false); return; } const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [canViewReconciliation, load]);
  const params = new URLSearchParams({ from, to, format: "csv" });
  const metrics = report ? [
    ["期间送货单", `${report.summary.note_count} 张`], ["涉及供应商", `${report.summary.supplier_count} 家`],
    ["应付货款", money(report.summary.allocated_cny)], ["已登记付款", money(report.summary.paid_cny)],
    ["未付货款", money(report.summary.unpaid_cny)], ["现场报付待核", money(report.summary.cash_paid_reported_cny)],
  ] : [];
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1600px]">
    <header><h1 className="text-2xl font-bold">报表中心</h1><p className="mt-1 text-sm text-slate-500">财务对账与付款统计；只按所选送货日期汇总，不代表历史累计余额。</p></header>
    {!canViewReconciliation ? <p className="mt-4 rounded-xl border bg-white p-4 text-sm text-slate-600">当前未授权查看供应商对账数据，请联系系统管理员配置权限。</p> : null}
    <section className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <label className="text-xs text-slate-600">送货开始日期<input type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-200 px-3 text-sm" /></label>
      <label className="text-xs text-slate-600">送货结束日期<input type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-200 px-3 text-sm" /></label>
      <button type="button" onClick={() => void load()} className="h-10 rounded-lg bg-blue-600 px-5 text-sm text-white">查询</button>
      <a href={`/api/supplier-reconciliation?${params}`} className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm text-blue-700"><FileDown size={16}/>导出报表</a>
    </section>
    {error ? <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {loading && !report ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600" aria-label="加载中" /></div> : report ? <>
      <section className="mt-6"><p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">财务运营</p><h2 className="mt-1 text-lg font-semibold">供应商对账与付款</h2><p className="mt-1 text-xs text-slate-500">按送货日期筛选；点击指标进入对账页面核对明细。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{metrics.map(([label, value]) => <Link key={label} href={`/supplier-reconciliation?from=${from}&to=${to}`} className="rounded-xl border bg-white p-4 shadow-sm hover:border-blue-300"><small className="text-slate-500">{label}</small><b className="mt-3 block text-xl tabular-nums text-slate-950">{value}</b></Link>)}</div>
      </section>
      <section className="mt-5 overflow-hidden rounded-xl border bg-white"><div className="flex items-center justify-between border-b p-4"><h2 className="font-semibold">期间送货单明细</h2><Link href={`/supplier-reconciliation?from=${from}&to=${to}`} className="text-sm text-blue-600">查看全部</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["送货单", "供应商", "送货日期", "应付", "已登记付款", "未付"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{report.notes.map(note => <tr key={note.id} className="border-t"><td className="px-4 py-3">{note.note_number || note.id.slice(0, 8)}</td><td className="px-4 py-3">{note.supplier_name || "—"}</td><td className="px-4 py-3">{note.document_date || "—"}</td><td className="px-4 py-3">{money(note.allocated_cny)}</td><td className="px-4 py-3">{money(note.paid_cny)}</td><td className="px-4 py-3">{money(note.unpaid_cny)}</td></tr>)}</tbody></table>{!report.notes.length ? <p className="p-8 text-center text-sm text-slate-500">该期间暂无送货单</p> : null}</div></section>
    </> : null}
  </div></main>;
}
