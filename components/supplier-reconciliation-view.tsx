"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { SupplierDeliveryNoteFiles, type SupplierDeliveryNoteView } from "@/components/supplier-delivery-note-files";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { AppSelect } from "@/components/ui/app-select";
import { BUSINESS_DATE_PRESETS, businessDatePreset, type BusinessDatePreset } from "@/lib/reports/date-presets";
import { settlementDisplay } from "@/lib/suppliers/settlement";

type Allocation = { id: string; pi_number: string; system_pi_number: string; pi_id: string; product: string; quantity: number;
  unit_price_cny: number; amount_cny: number; cash_paid_reported_cny: number | null;
  correction_of: string | null; correction_reason: string | null; recorded_at: string };
type Payment = { id: string; amount_cny: number; paid_on: string; method: string; reference: string };
type Note = { id: string; supplier_id: string; supplier_code: string; supplier_name: string;
  settlement_cycle: string; settlement_days: number | null; settlement_terms_original?: string | null; note_number: string; document_date: string; updated_at: string;
  paper_total_cny: number | null; allocated_quantity: number; allocated_cny: number;
  cash_paid_reported_cny: number; paid_cny: number; unpaid_cny: number; allocations: Allocation[]; payments: Payment[]; attachments: SupplierDeliveryNoteView["attachments"] };
type Summary = { note_count: number; supplier_count: number; quantity: number;
  allocated_cny: number; cash_paid_reported_cny: number; paid_cny: number; unpaid_cny: number };
type SupplierSummary = { supplier_id: string; system_code: string; supplier_name: string | null;
  settlement_cycle: string; settlement_days: number | null; settlement_terms_original?: string | null; note_count: number; quantity: number;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };
type MonthlySummary = { month: string; supplier_id: string; system_code: string;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };
type PaymentDraft = { noteId: string; noteNumber: string; amount: string;
  paidOn: string; method: string; reference: string };
type PaperDraft = { noteId: string; noteNumber: string; amount: string; version: string; reason: string };
const money = (value: number) => `${Number(value || 0) < 0 ? "−" : ""}¥${Math.abs(Number(value || 0)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const settlementLabel = settlementDisplay;
function noteChecks(note: Note) {
  const checks: string[] = [];
  if (!note.attachments?.length) checks.push("缺纸单图片");
  if (note.paper_total_cny === null) checks.push("待录纸单金额");
  else if (Math.abs(note.paper_total_cny - note.allocated_cny) > 0.005) checks.push("金额有差异");
  return checks;
}
function groupAllocations(allocations: Allocation[]) {
  const groups = new Map<string, { piNumber: string; systemPiNumber: string; items: Allocation[]; quantity: number; amount: number }>();
  for (const item of allocations) {
    const group = groups.get(item.pi_id) || { piNumber: item.pi_number, systemPiNumber: item.system_pi_number, items: [], quantity: 0, amount: 0 };
    group.items.push(item);
    group.quantity += Number(item.quantity || 0);
    group.amount += Number(item.amount_cny || 0);
    groups.set(item.pi_id, group);
  }
  return [...groups.values()];
}
const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function SupplierReconciliationView({ canRecordPayment }: { canRecordPayment: boolean }) {
  const initial = businessDatePreset("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selectedPreset, setSelectedPreset] = useState<BusinessDatePreset | "">("month");
  const [supplierId, setSupplierId] = useState("");
  const [filters, setFilters] = useState({ ...initial, supplierId: "" });
  const [suppliers, setSuppliers] = useState<Array<{ id: string; system_code: string; short_name: string | null; english_short_name: string | null }>>([]);
  const [supplierError, setSupplierError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [legacyUnlinked, setLegacyUnlinked] = useState<{ line_count: number; quantity: number } | null>(null);
  const [supplierSummary, setSupplierSummary] = useState<SupplierSummary[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary[]>([]);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft | null>(null);
  const [paperDraft, setPaperDraft] = useState<PaperDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: filters.from, to: filters.to, page: String(page) });
    if (filters.supplierId) params.set("supplier_id", filters.supplierId);
    const response = await fetch(`/api/supplier-reconciliation?${params}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setLoading(false);
    if (!response?.ok) { setError(body.error || "供应商对账加载失败"); setSummary(null); setLegacyUnlinked(null); setSupplierSummary([]); setMonthlySummary([]); setNotes([]); return; }
    setSummary(body.summary || null);
    setLegacyUnlinked(body.legacy_unlinked || null);
    setSupplierSummary(body.supplier_summary || []);
    setMonthlySummary(body.monthly_summary || []);
    setNotes(body.notes || []);
    setError("");
  }, [filters, page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    async function loadSuppliers() {
      try {
        const all: typeof suppliers = [];
        for (let page = 1; page <= 10000; page++) {
          const response = await fetch(`/api/suppliers?page=${page}`, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "供应商筛选项加载失败");
          all.push(...(body.data || []));
          if (all.length >= body.count || !(body.data || []).length) break;
        }
        if (!cancelled) { setSuppliers(all); setSupplierError(""); }
      } catch (cause) {
        if (!cancelled) setSupplierError(cause instanceof Error ? cause.message : "供应商筛选项加载失败");
      }
    }
    void loadSuppliers();
    return () => { cancelled = true; };
  }, []);
  function search() {
    if (!from || !to || from > to) { setError("请选择有效的送货日期范围"); return; }
    setPage(1); setExpanded(null); setExpandedSupplier(null); setFilters({ from, to, supplierId });
  }
  function selectPreset(value: string) {
    if (!value) { setSelectedPreset(""); return; }
    const preset = value as BusinessDatePreset;
    const range = businessDatePreset(preset);
    setFrom(range.from); setTo(range.to); setSelectedPreset(preset);
    setPage(1); setExpanded(null); setExpandedSupplier(null);
    setFilters({ ...range, supplierId });
  }
  function reset() {
    const range = businessDatePreset("month");
    setFrom(range.from); setTo(range.to); setSelectedPreset("month"); setSupplierId("");
    setPage(1); setExpanded(null); setExpandedSupplier(null);
    setFilters({ ...range, supplierId: "" });
  }
  function showSupplierNotes(id: string) {
    setSupplierId(id); setPage(1); setExpanded(null);
    setFilters((current) => ({ ...current, supplierId: id }));
    document.getElementById("supplier-delivery-notes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function exportCsv() {
    if (loading || exporting || !filters.from || !filters.to) return;
    setExporting(true); setError("");
    try {
      const params = new URLSearchParams({ from: filters.from, to: filters.to, format: "csv" });
      if (filters.supplierId) params.set("supplier_id", filters.supplierId);
      const response = await fetch(`/api/supplier-reconciliation?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "供应商对账导出失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `供应商对账-${filters.from}-${filters.to}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "供应商对账导出失败");
    } finally {
      setExporting(false);
    }
  }
  function openPayment(note: Note) {
    setError("");
    setPayment({ noteId: note.id, noteNumber: note.note_number,
      amount: Number(note.unpaid_cny).toFixed(2), paidOn: localDate(new Date()),
      method: note.settlement_cycle === "CASH" ? "CASH" : "BANK", reference: "" });
  }
  async function submitPayment() {
    if (!payment || busy) return;
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(payment.amount)
      || Number(payment.amount) <= 0 || !payment.reference.trim()) {
      setError("请填写大于零的付款金额及付款凭证号"); return;
    }
    setBusy(true); setError("");
    const response = await fetch("/api/supplier-reconciliation/payments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delivery_note_id: payment.noteId, amount_cny: payment.amount,
        paid_on: payment.paidOn, payment_method: payment.method,
        payment_reference: payment.reference.trim() }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "付款登记失败"); return; }
    setPayment(null);
    await load();
  }
  async function submitPaperTotal() {
    if (!paperDraft || busy) return;
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(paperDraft.amount)
      || !paperDraft.reason.trim()) {
      setError("请填写纸单金额及核对说明"); return;
    }
    setBusy(true); setError("");
    const response = await fetch(`/api/supplier-reconciliation/notes/${paperDraft.noteId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paper_total_cny: paperDraft.amount,
        expected_updated_at: paperDraft.version, reason: paperDraft.reason.trim() }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "纸单金额核对失败"); return; }
    setPaperDraft(null);
    await load();
  }
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1600px] space-y-4">
    <div><h1 className="text-xl font-semibold">供应商对账</h1><p className="mt-1 text-sm text-slate-600">按送货日期汇总实收分配；一张纸质送货单可关联多张 PI。现金结也纳入应付，只有财务已登记付款才冲减未付。</p></div>
    <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center gap-2 text-sm">
      <CompactDateRange label="送货日期" fromLabel="送货开始日期" toLabel="送货结束日期" from={from} to={to} onFromChange={(value) => { setFrom(value); setSelectedPreset(""); }} onToChange={(value) => { setTo(value); setSelectedPreset(""); }} presets={BUSINESS_DATE_PRESETS} selectedPreset={selectedPreset} onPresetChange={selectPreset}/>
      <AppSelect aria-label="筛选供应商" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="h-10 min-w-48 max-w-64 rounded-lg border border-slate-200 bg-white px-3 text-slate-700"><option value="">全部供应商</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.system_code} · {supplier.short_name || supplier.english_short_name || "未补名称"}</option>)}</AppSelect>
      <button onClick={search} className="h-10 rounded-lg bg-blue-600 px-4 text-white">查询</button>
      <button type="button" onClick={reset} className="h-10 rounded-lg border px-3 text-slate-700">重置</button>
      <button type="button" disabled={loading || exporting} onClick={() => void exportCsv()} className="h-10 rounded-lg border px-4 text-slate-700 disabled:opacity-40">{exporting ? "导出中…" : "导出当前筛选 CSV"}</button>
    </div></section>
    {supplierError ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{supplierError}；当前供应商筛选项可能不完整，请刷新页面后重试。</p> : null}
    {error && !payment ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {legacyUnlinked && legacyUnlinked.line_count > 0 ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">全历史另有 {legacyUnlinked.line_count} 项回货（共 {legacyUnlinked.quantity} 件）没有原始供应商/送货单来源；此数不受上方日期筛选影响，也未计入本页任何供应商应付与月度汇总。须由仓库核对纸单后再补充真实来源，不能自动编造。</p> : null}
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="供应商对账概览">{([
      ["送货单", summary?.note_count, "张"], ["供应商", summary?.supplier_count, "家"], ["实收数量", summary?.quantity, "件"],
      ["应付货款", summary && money(summary.allocated_cny), ""], ["现场报付待核", summary && money(summary.cash_paid_reported_cny), ""], ["已登记付款", summary && money(summary.paid_cny), ""], ["未付货款", summary && money(summary.unpaid_cny), ""],
    ] as const).map(([label, value, unit]) => <div key={label} className="min-w-0 rounded-xl border bg-white px-3 py-3"><p className="truncate text-xs text-slate-500" title={label}>{label}</p><strong className="mt-1 block truncate text-base tabular-nums text-slate-900 lg:text-lg" title={loading || value === null || value === undefined ? undefined : `${value}${unit}`}>{loading || value === null || value === undefined ? "—" : `${value}${unit}`}</strong>{label === "现场报付待核" ? <p className="text-[11px] text-slate-500">不冲减应付</p> : null}</div>)}</section>
    <section className="rounded-xl border bg-white p-4" aria-label="供应商采购货款汇总">
      <h2 className="font-semibold">供应商采购货款汇总</h2>
      <p className="mt-1 text-xs text-slate-500">与下方采购明细共用日期和供应商筛选；汇总覆盖全部匹配送货单，不受明细分页影响。</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b bg-slate-50 text-slate-600"><tr><th className="p-3">供应商代码 / 名称</th><th>结算方式</th><th>送货单</th><th>回货数量</th><th>应付</th><th>财务已付</th><th>未付</th><th>操作</th></tr></thead>
        <tbody>{supplierSummary.map((supplier) => <tr key={supplier.supplier_id} className="border-b last:border-0"><td className="p-3 font-medium">{supplier.system_code} · {supplier.supplier_name || "未补名称"}</td><td>{settlementLabel(supplier.settlement_cycle, supplier.settlement_days, supplier.settlement_terms_original)}</td><td>{supplier.note_count} 张</td><td>{supplier.quantity} 件</td><td className="tabular-nums">{money(supplier.allocated_cny)}</td><td className="tabular-nums">{money(supplier.paid_cny)}</td><td className="tabular-nums">{money(supplier.unpaid_cny)}</td><td className="whitespace-nowrap"><button type="button" onClick={() => showSupplierNotes(supplier.supplier_id)} className="font-medium text-blue-700 hover:underline" aria-label={`查看${supplier.system_code}的采购明细`}>查看明细</button><button type="button" onClick={() => setExpandedSupplier((current) => current === supplier.supplier_id ? null : supplier.supplier_id)} className="ml-3 text-slate-600 hover:underline">月度</button></td></tr>)}</tbody>
      </table>{!loading && !supplierSummary.length ? <p className="py-8 text-center text-sm text-slate-500">所选日期范围没有供应商回货分配</p> : null}</div>
      {expandedSupplier ? <div className="mt-3 rounded-lg bg-slate-50 p-3"><h3 className="text-sm font-medium">{supplierSummary.find((row) => row.supplier_id === expandedSupplier)?.system_code} · 月度采购与付款</h3><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr className="border-b"><th className="py-2">月份</th><th>应付</th><th>已付</th><th>未付</th></tr></thead><tbody>{monthlySummary.filter((row) => row.supplier_id === expandedSupplier).map((row) => <tr key={row.month} className="border-b last:border-0"><td className="py-2">{row.month.slice(0, 7)}</td><td>{money(row.allocated_cny)}</td><td>{money(row.paid_cny)}</td><td>{money(row.unpaid_cny)}</td></tr>)}</tbody></table></div></div> : null}
    </section>
    <section id="supplier-delivery-notes" className="scroll-mt-20 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">采购明细</h2><p className="mt-1 text-xs text-slate-500">一张真实送货单一行；展开可核对关联 PI、产品分配与付款流水。</p></div>{filters.supplierId ? <button type="button" onClick={() => { setSupplierId(""); setPage(1); setExpanded(null); setFilters((current) => ({ ...current, supplierId: "" })); }} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700">{suppliers.find((item) => item.id === filters.supplierId)?.system_code || "所选供应商"} · 清除筛选</button> : null}</div>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1220px] text-left text-sm"><thead><tr className="border-b bg-slate-50 text-slate-600"><th className="p-3">送货日期</th><th>供应商</th><th>当时商务条件</th><th>送货单号</th><th>纸单影像</th><th>核对提示</th><th>数量</th><th>分配金额</th><th>纸单金额 / 差额</th><th>已付</th><th>未付</th><th>操作</th></tr></thead><tbody>{notes.map((note) => <tr key={note.id} className="border-b align-top"><td className="p-3">{note.document_date}</td><td>{note.supplier_code}<small className="block text-slate-500">{note.supplier_name}</small></td><td>{settlementLabel(note.settlement_cycle, note.settlement_days, note.settlement_terms_original)}</td><td>{note.note_number}</td><td className="max-w-52 p-2"><SupplierDeliveryNoteFiles note={{ id: note.id, supplier_code: note.supplier_code, note_number: note.note_number, document_date: note.document_date, attachments: note.attachments || [] }} compact/></td><td className="min-w-28 py-3">{noteChecks(note).length ? noteChecks(note).map((check) => <span key={check} className="mb-1 block w-fit rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{check}</span>) : <span className="text-xs text-emerald-700">资料齐备 · 金额一致</span>}</td><td>{note.allocated_quantity}</td><td>{money(note.allocated_cny)}</td><td>{note.paper_total_cny === null ? "未录入" : <>{money(note.paper_total_cny)}<small className={`block ${Math.abs(note.paper_total_cny - note.allocated_cny) > 0.005 ? "text-amber-700" : "text-emerald-700"}`}>{Math.abs(note.paper_total_cny - note.allocated_cny) > 0.005 ? `差额 ${money(note.paper_total_cny - note.allocated_cny)}` : "金额一致"}</small></>}</td><td>{money(note.paid_cny)}</td><td className="font-medium">{money(note.unpaid_cny)}</td><td className="space-x-2 whitespace-nowrap"><button onClick={() => setExpanded((value) => value === note.id ? null : note.id)} className="text-blue-700">{expanded === note.id ? "收起" : `查看PI（${groupAllocations(note.allocations).length}）`}</button>{canRecordPayment ? <button onClick={() => { setError(""); setPaperDraft({ noteId: note.id, noteNumber: note.note_number, amount: note.paper_total_cny === null ? "" : Number(note.paper_total_cny).toFixed(2), version: note.updated_at, reason: "" }); }} className="text-blue-700">核对纸单</button> : null}{canRecordPayment && note.unpaid_cny > 0 ? <button onClick={() => openPayment(note)} className="text-emerald-700">登记付款</button> : null}</td></tr>)}</tbody></table>
        {!loading && notes.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">该日期范围没有送货单回货记录</p> : null}</div>
      {expanded ? (() => { const note = notes.find((row) => row.id === expanded); if (!note) return null; const groups = groupAllocations(note.allocations); return <div className="mt-4 rounded-xl border bg-slate-50 p-4 text-sm"><h3 className="font-semibold">{note.supplier_code} · {note.note_number} · 关联 PI（{groups.length} 单）</h3><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b"><th className="py-2">PI订单号 / 产品</th><th>回货数量</th><th>采购单价</th><th>金额</th></tr></thead><tbody>{groups.map((group) => <Fragment key={group.items[0].pi_id}><tr className="border-b bg-blue-50/70 font-semibold"><td className="py-2">{group.piNumber}</td><td>{group.quantity}</td><td>—</td><td>{money(group.amount)}</td></tr>{group.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-2 pl-4 text-slate-700">{item.product}{item.correction_of ? <small className="block text-rose-700">冲正原记录 {item.correction_of.slice(0, 8)} · {item.correction_reason}</small> : null}</td><td>{item.quantity}</td><td>{money(item.unit_price_cny)}</td><td>{money(item.amount_cny)}</td></tr>)}</Fragment>)}</tbody></table></div><h4 className="mt-4 font-medium">付款流水</h4>{note.payments.length ? note.payments.map((entry) => <p key={entry.id} className="mt-1 text-xs">{entry.paid_on} · {money(entry.amount_cny)} · {entry.method} · 凭证 {entry.reference}</p>) : <p className="mt-1 text-xs text-slate-500">暂无已确认付款</p>}</div>; })() : null}
      <div className="mt-4 flex items-center justify-end gap-3 text-sm"><span>第 {page} 页 · 共 {summary?.note_count || 0} 张</span><button disabled={page <= 1 || loading} onClick={() => { setPage((value) => value - 1); setExpanded(null); }} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button><button disabled={loading || page * 50 >= (summary?.note_count || 0)} onClick={() => { setPage((value) => value + 1); setExpanded(null); }} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button></div>
    </section>
    <AppDialog open={paperDraft !== null} title="核对纸质送货单金额" description="录入纸单金额后与系统已分配货款比对；差额不会自动改写 PI、回货或付款记录。" onClose={() => { if (!busy) { setPaperDraft(null); setError(""); } }}>
      {paperDraft ? <form onSubmit={(event) => { event.preventDefault(); void submitPaperTotal(); }} className="space-y-3 text-sm">
        <p>送货单号：{paperDraft.noteNumber}</p>
        <label className="block">纸质单据总金额 ¥（必填）<input required inputMode="decimal" value={paperDraft.amount} onChange={(event) => setPaperDraft((current) => current && { ...current, amount: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label className="block">核对说明（必填）<textarea required maxLength={500} value={paperDraft.reason} onChange={(event) => setPaperDraft((current) => current && { ...current, reason: event.target.value })} className="mt-1 min-h-20 w-full rounded border px-3 py-2"/></label>
        {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setPaperDraft(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-40">{busy ? "保存中…" : "确认核对"}</button></div>
      </form> : null}
    </AppDialog>
    <AppDialog open={payment !== null} title="登记供应商付款" description="付款流水提交后不可覆盖或删除；请与银行或现金凭证核对。" onClose={() => { if (!busy) { setPayment(null); setError(""); } }}>
      {payment ? <form onSubmit={(event) => { event.preventDefault(); void submitPayment(); }} className="space-y-3 text-sm"><p>送货单号：{payment.noteNumber}</p><div className="grid gap-3 sm:grid-cols-2">
        <label>付款金额（人民币）<input required inputMode="decimal" value={payment.amount} onChange={(event) => setPayment((current) => current && { ...current, amount: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>付款日期<input required type="date" max={localDate(new Date())} value={payment.paidOn} onChange={(event) => setPayment((current) => current && { ...current, paidOn: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>付款方式<select value={payment.method} onChange={(event) => setPayment((current) => current && { ...current, method: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"><option value="CASH">现金</option><option value="BANK">银行转账</option><option value="ALIPAY">支付宝</option><option value="WECHAT">微信支付</option><option value="OTHER">其他</option></select></label>
        <label>付款凭证号（必填）<input required maxLength={200} value={payment.reference} onChange={(event) => setPayment((current) => current && { ...current, reference: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
      </div>{error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}<div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setPayment(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40">{busy ? "登记中…" : "确认登记付款"}</button></div></form> : null}
    </AppDialog>
  </div></main>;
}
