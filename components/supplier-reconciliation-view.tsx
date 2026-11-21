"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { SupplierDeliveryNoteFiles, type SupplierDeliveryNoteView } from "@/components/supplier-delivery-note-files";
import { SupplierMonthlyMatrix } from "@/components/supplier-monthly-matrix";
import { SupplierAccountLedger } from "@/components/supplier-account-ledger";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { AppSelect } from "@/components/ui/app-select";
import { AppPagination } from "@/components/ui/app-pagination";
import { BUSINESS_DATE_PRESETS, businessDatePreset, type BusinessDatePreset } from "@/lib/reports/date-presets";
import { settlementDisplay } from "@/lib/suppliers/settlement";
import { SUPPLIER_NOTE_CHECK_LABELS, SUPPLIER_NOTE_CHECK_STATUSES, checkStatusRequiresDocuments, type SupplierNoteCheckStatus } from "@/lib/suppliers/note-check-status";

type Allocation = { id: string; pi_number: string; system_pi_number: string; pi_id: string; product: string; quantity: number;
  unit_price_cny: number; amount_cny: number; cash_paid_reported_cny: number | null;
  correction_of: string | null; correction_reason: string | null; recorded_at: string };
type Payment = { id: string; amount_cny: number; paid_on: string; method: string; reference: string; documents_pending_at_payment: boolean | null; source?: "ACCOUNT" };
type Note = { id: string; supplier_id: string; supplier_code: string; supplier_name: string;
  number_pending: boolean;
  settlement_cycle: string; settlement_days: number | null; settlement_terms_original?: string | null; note_number: string; document_date: string; updated_at: string;
  paper_total_cny: number | null; allocated_quantity: number; allocated_cny: number; goods_allocated_cny?: number; packaging_charges_cny?: number;
  cash_paid_reported_cny: number; paid_cny: number; unpaid_cny: number; allocations: Allocation[]; payments: Payment[]; attachments: SupplierDeliveryNoteView["attachments"] };
type Summary = { note_count: number; supplier_count: number; quantity: number;
  allocated_cny: number; cash_paid_reported_cny: number; paid_cny: number; unpaid_cny: number };
type SupplierSummary = { supplier_id: string; system_code: string; supplier_name: string | null;
  settlement_cycle: string; settlement_days: number | null; settlement_terms_original?: string | null; note_count: number; quantity: number;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };
type MonthlySummary = { month: string; supplier_id: string; system_code: string;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };
type PaymentDraft = { noteId: string; noteNumber: string; amount: string;
  paidOn: string; method: string; reference: string; documentsPending: boolean; confirmedPending: boolean };
type BatchPaymentDraft = { supplierId: string; supplierCode: string; paidOn: string; method: string;
  reference: string; confirmed: boolean; lines: { noteId: string; noteNumber: string; unpaid: number; amount: string }[] };
type PaperDraft = { noteId: string; noteNumber: string; amount: string; version: string; reason: string };
const money = (value: number) => `${Number(value || 0) < 0 ? "−" : ""}¥${Math.abs(Number(value || 0)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function SummaryMetric({ label, value, loading, hint, onClick, selected = false, tone = "text-slate-900" }: {
  label: string; value: string; loading: boolean; hint: string; onClick: () => void; selected?: boolean; tone?: string;
}) {
  return <button type="button" onClick={onClick} title={hint} aria-pressed={selected} className={`group flex min-h-24 min-w-0 flex-col justify-between rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200" : ""}`} aria-label={`${label}：${loading ? "加载中" : value}，${hint}`}>
    <span className="flex w-full items-center justify-between gap-2 text-xs font-medium text-slate-500"><span>{label}</span><span aria-hidden="true" className="text-base font-normal text-slate-400 group-hover:text-blue-700">↗</span></span>
    <strong className={`block break-all text-2xl font-semibold tabular-nums ${tone}`}>{loading ? "—" : value}</strong>
  </button>;
}
const settlementLabel = settlementDisplay;
function noteChecks(note: Note, canViewDocuments: boolean) {
  const checks: string[] = [];
  if (note.number_pending) checks.push("待补送货单号");
  if (canViewDocuments && !note.attachments?.length) checks.push("缺纸单图片");
  if (!canViewDocuments) checks.push("无纸单查看权限");
  if (note.paper_total_cny === null) checks.push("待录纸单金额");
  else if (Math.abs(note.paper_total_cny - Number(note.goods_allocated_cny ?? note.allocated_cny)) > 0.005) checks.push("货款金额有差异");
  return checks;
}
function groupAllocations(allocations: Allocation[]) {
  const groups = new Map<string, { piId: string; piNumber: string; systemPiNumber: string; items: Allocation[]; quantity: number; amount: number }>();
  for (const item of allocations) {
    const group = groups.get(item.pi_id) || { piId: item.pi_id, piNumber: item.pi_number, systemPiNumber: item.system_pi_number, items: [], quantity: 0, amount: 0 };
    group.items.push(item);
    group.quantity += Number(item.quantity || 0);
    group.amount += Number(item.amount_cny || 0);
    groups.set(item.pi_id, group);
  }
  return [...groups.values()];
}
function NoteDetails({ note }: { note: Note }) {
  const groups = groupAllocations(note.allocations);
  return <div className="rounded-lg border border-blue-100 bg-white p-4 text-sm">
    <h3 className="font-semibold">{note.supplier_code} · {note.note_number} · 关联 PI（{groups.length} 单）</h3>
    <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs">
      <thead><tr className="border-b"><th className="py-2">PI订单号 / 产品</th><th>回货数量</th><th>采购单价</th><th>金额</th></tr></thead>
      <tbody>{groups.map((group) => <Fragment key={group.piId}>
        <tr className="border-b bg-blue-50/70 font-semibold"><td className="py-2"><Link href={`/orders/${group.piId}`} className="text-blue-700 hover:underline">{group.piNumber || group.systemPiNumber}</Link>{group.systemPiNumber && group.systemPiNumber !== group.piNumber ? <small className="ml-2 font-normal text-slate-500">系统号 {group.systemPiNumber}</small> : null}</td><td>{group.quantity}</td><td>—</td><td>{money(group.amount)}</td></tr>
        {group.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-2 pl-4 text-slate-700">{item.product}{item.correction_of ? <small className="block text-rose-700">冲正原记录 {item.correction_of.slice(0, 8)} · {item.correction_reason}</small> : null}</td><td>{item.quantity}</td><td>{money(item.unit_price_cny)}</td><td>{money(item.amount_cny)}</td></tr>)}
      </Fragment>)}</tbody>
    </table></div>
    {Number(note.packaging_charges_cny || 0) > 0 ? <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-amber-900">本送货单关联包装费用：{money(note.packaging_charges_cny || 0)} · 已计入应付金额</p> : null}
    {groups.length === 0 ? <p className="mt-2 text-xs text-amber-700">这张送货单尚未关联 PI。</p> : null}
    <h4 className="mt-4 font-medium">付款流水</h4>
    {note.payments.length ? note.payments.map((entry) => <p key={entry.id} className="mt-1 text-xs">{entry.paid_on} · {money(entry.amount_cny)} · {entry.method} · 依据 {entry.reference || "未填写"}{entry.source === "ACCOUNT" ? <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">供应商总账付款分配，未重复付款</span> : null}{entry.documents_pending_at_payment ? <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">付款时单据待补</span> : null}</p>) : <p className="mt-1 text-xs text-slate-500">暂无已确认付款</p>}
  </div>;
}
const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function SupplierReconciliationView({ canRecordPayment, canViewAccount = false }: { canRecordPayment: boolean; canViewAccount?: boolean }) {
  const initial = businessDatePreset("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selectedPreset, setSelectedPreset] = useState<BusinessDatePreset | "">("month");
  const [supplierId, setSupplierId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [checkStatus, setCheckStatus] = useState<SupplierNoteCheckStatus | "">("");
  const [filters, setFilters] = useState({ ...initial, supplierId: "", search: "", checkStatus: "" as SupplierNoteCheckStatus | "", amountFocus: "" as "" | "PAID" | "UNPAID" });
  const [matrixOrigin, setMatrixOrigin] = useState<typeof filters | null>(null);
  const [matrixMetric, setMatrixMetric] = useState<"allocated_cny" | "paid_cny" | "unpaid_cny">("allocated_cny");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryFrom = params.get("from") || "";
    const queryTo = params.get("to") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(queryFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(queryTo) || queryFrom > queryTo) return;
    const querySupplierId = params.get("supplier_id") || "";
    const querySearch = (params.get("search") || "").trim().slice(0, 80);
    const validSupplierId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(querySupplierId) ? querySupplierId : "";
    setFrom(queryFrom);
    setTo(queryTo);
    setSupplierId(validSupplierId);
    setSearchText(querySearch);
    setSelectedPreset("");
    setFilters({ from: queryFrom, to: queryTo, supplierId: validSupplierId, search: querySearch, checkStatus: "", amountFocus: "" });
  }, []);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [supplierSummary, setSupplierSummary] = useState<SupplierSummary[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierSummary[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary[]>([]);
  const [canViewDocuments, setCanViewDocuments] = useState(false);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [detailCount, setDetailCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [batchPayment, setBatchPayment] = useState<BatchPaymentDraft | null>(null);
  const [paperDraft, setPaperDraft] = useState<PaperDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const params = new URLSearchParams({ from: filters.from, to: filters.to, page: String(page), page_size: String(pageSize) });
    if (filters.supplierId) params.set("supplier_id", filters.supplierId);
    if (filters.search) params.set("search", filters.search);
    if (filters.checkStatus) params.set("check_status", filters.checkStatus);
    if (filters.amountFocus) params.set("amount_focus", filters.amountFocus);
    const response = await fetch(`/api/supplier-reconciliation?${params}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (sequence !== loadSequence.current) return;
    setLoading(false);
    if (!response?.ok) { setError(body.error || "供应商对账加载失败"); setSummary(null); setSupplierSummary([]); setMonthlySummary([]); setNotes([]); setDetailCount(0); setCanViewDocuments(false); return; }
    setSummary(body.summary || null);
    setSupplierSummary(body.supplier_summary || []);
    if (!filters.supplierId && !filters.search) setSupplierOptions(body.supplier_summary || []);
    setMonthlySummary(body.monthly_summary || []);
    setCanViewDocuments(body.can_view_documents === true);
    setNotes(body.notes || []);
    setDetailCount(Number(body.detail_count || 0));
    setSelectedNotes([]);
    setError("");
  }, [filters, page, pageSize]);
  useEffect(() => { void load(); }, [load]);
  function search() {
    if (!from || !to || from > to) { setError("请选择有效的送货日期范围"); return; }
    setMatrixOrigin(null);
    setPage(1); setExpanded(null); setExpandedSupplier(null); setFilters({ from, to, supplierId, search: searchText.trim(), checkStatus, amountFocus: filters.amountFocus });
  }
  function selectPreset(value: string) {
    if (!value) { setSelectedPreset(""); return; }
    const preset = value as BusinessDatePreset;
    const range = businessDatePreset(preset);
    setFrom(range.from); setTo(range.to); setSelectedPreset(preset);
    setMatrixOrigin(null);
    setPage(1); setExpanded(null); setExpandedSupplier(null);
    setFilters({ ...range, supplierId, search: searchText.trim(), checkStatus, amountFocus: filters.amountFocus });
  }
  function reset() {
    const range = businessDatePreset("month");
    setFrom(range.from); setTo(range.to); setSelectedPreset("month"); setSupplierId(""); setSearchText(""); setCheckStatus("");
    setMatrixOrigin(null);
    setPage(1); setExpanded(null); setExpandedSupplier(null);
    setFilters({ ...range, supplierId: "", search: "", checkStatus: "", amountFocus: "" });
  }
  function clearSupplierFilter() {
    setMatrixOrigin(null); setSupplierId(""); setPage(1); setExpanded(null);
    setFilters((current) => ({ ...current, supplierId: "" }));
  }
  function showSupplierNotes(id: string) {
    setMatrixOrigin(null);
    setSupplierId(id); setPage(1); setExpanded(null);
    setFilters((current) => ({ ...current, supplierId: id }));
    document.getElementById("supplier-delivery-notes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function drillToMonth(id: string, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const [year, monthNumber] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    const next = { from: filters.from > monthStart ? filters.from : monthStart,
      to: filters.to < monthEnd ? filters.to : monthEnd, supplierId: id, search: filters.search, checkStatus: filters.checkStatus, amountFocus: filters.amountFocus };
    if (!matrixOrigin) setMatrixOrigin(filters);
    setFrom(next.from); setTo(next.to); setSupplierId(id); setSelectedPreset("");
    setPage(1); setExpanded(null); setExpandedSupplier(null); setFilters(next);
    window.setTimeout(() => document.getElementById("supplier-delivery-notes")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  function returnToMatrix() {
    if (!matrixOrigin) return;
    setFrom(matrixOrigin.from); setTo(matrixOrigin.to); setSupplierId(matrixOrigin.supplierId); setSearchText(matrixOrigin.search); setCheckStatus(matrixOrigin.checkStatus);
    setPage(1); setExpanded(null); setExpandedSupplier(null); setFilters(matrixOrigin);
    setMatrixOrigin(null);
    window.setTimeout(() => document.getElementById("supplier-monthly-matrix")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  function focusDetail(amountFocus: "" | "PAID" | "UNPAID") {
    setPage(1); setExpanded(null); setSelectedNotes([]);
    setFilters((current) => ({ ...current, amountFocus }));
    window.setTimeout(() => document.getElementById("supplier-delivery-notes")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  function openPayment(note: Note) {
    setError("");
    setPayment({ noteId: note.id, noteNumber: note.note_number,
      amount: Number(note.unpaid_cny).toFixed(2), paidOn: localDate(new Date()),
      method: note.settlement_cycle === "CASH" ? "CASH" : "BANK", reference: "",
      documentsPending: note.number_pending || !note.attachments?.length, confirmedPending: false });
  }
  async function submitPayment() {
    if (!payment || busy) return;
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(payment.amount)
      || Number(payment.amount) <= 0 || payment.reference.trim().length > 200
      || payment.documentsPending && !payment.reference.trim() && !payment.confirmedPending) {
      setError("请填写有效付款金额；单据待补且无凭证号时，请确认已核实真实付款（凭证号最多200字）"); return;
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
  function toggleSelectedNote(note: Note) {
    if (note.number_pending || !note.attachments?.length || note.unpaid_cny <= 0) return;
    setSelectedNotes((current) => current.includes(note.id)
      ? current.filter((id) => id !== note.id)
      : current.length >= 50 || current.some((id) => notes.find((item) => item.id === id)?.supplier_id !== note.supplier_id)
        ? current : [...current, note.id]);
  }
  function openBatchPayment() {
    const selected = notes.filter((note) => selectedNotes.includes(note.id));
    if (selected.length < 2 || selected.length > 50 || selected.some((note) => note.supplier_id !== selected[0].supplier_id || note.number_pending || !note.attachments?.length || note.unpaid_cny <= 0)) return;
    setError("");
    setBatchPayment({ supplierId: selected[0].supplier_id, supplierCode: selected[0].supplier_code,
      paidOn: localDate(new Date()), method: selected[0].settlement_cycle === "CASH" ? "CASH" : "BANK", reference: "", confirmed: false,
      lines: selected.map((note) => ({ noteId: note.id, noteNumber: note.note_number,
        unpaid: note.unpaid_cny, amount: Number(note.unpaid_cny).toFixed(2) })) });
  }
  async function submitBatchPayment() {
    if (!batchPayment || busy) return;
    if (!batchPayment.confirmed || batchPayment.reference.trim().length > 200 || batchPayment.lines.some((line) =>
      !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(line.amount)
      || Number(line.amount) <= 0 || Number(line.amount) > line.unpaid)) {
      setError("请核对并确认逐张金额不超过未付余额；凭证号最多200字"); return;
    }
    setBusy(true); setError("");
    const response = await fetch("/api/supplier-reconciliation/payments/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier_id: batchPayment.supplierId, paid_on: batchPayment.paidOn,
        payment_method: batchPayment.method, payment_reference: batchPayment.reference.trim(),
        lines: batchPayment.lines.map((line) => ({ delivery_note_id: line.noteId,
          amount_cny: line.amount, expected_unpaid_cny: line.unpaid.toFixed(2) })) }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "批量付款失败，整批未入账"); return; }
    setBatchPayment(null); setSelectedNotes([]);
    await load();
  }
  async function submitPaperTotal() {
    if (!paperDraft || busy) return;
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(paperDraft.amount)
      || paperDraft.reason.trim().length > 500) {
      setError("请填写纸单金额；核对说明最多500字"); return;
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
    <div><h1 className="text-xl font-semibold">供应商对账</h1><p className="mt-1 text-sm text-slate-600">{canViewAccount ? "供应商总账显示当前余额；" : ""}送货单报表按送货日期归属，未分配到单据的总账付款不会伪装成某张单据已结清。</p></div>
    <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center gap-2 text-sm">
      <CompactDateRange label="送货日期" fromLabel="送货开始日期" toLabel="送货结束日期" from={from} to={to} onFromChange={(value) => { setFrom(value); setSelectedPreset(""); }} onToChange={(value) => { setTo(value); setSelectedPreset(""); }} presets={BUSINESS_DATE_PRESETS} selectedPreset={selectedPreset} onPresetChange={selectPreset} onMonthRangeApply={(range) => { setFrom(range.from); setTo(range.to); setSelectedPreset(""); setMatrixOrigin(null); setPage(1); setExpanded(null); setExpandedSupplier(null); setFilters({ ...range, supplierId, search: searchText.trim(), checkStatus, amountFocus: filters.amountFocus }); }}/>
      <AppSelect aria-label="按供应商筛选送货单" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="h-10 min-w-44 rounded-lg border border-slate-200 bg-white px-3 text-slate-700" forceSearch><option value="">全部供应商</option>{supplierOptions.map((option) => <option key={option.supplier_id} value={option.supplier_id}>{option.system_code}{option.supplier_name ? ` · ${option.supplier_name}` : ""}</option>)}{supplierId && !supplierOptions.some((option) => option.supplier_id === supplierId) ? <option value={supplierId}>当前选定供应商</option> : null}</AppSelect>
      <AppSelect aria-label="按采购明细核对状态筛选" value={checkStatus} onChange={(event) => setCheckStatus(event.target.value as SupplierNoteCheckStatus | "")} className="h-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 text-slate-700"><option value="">全部核对状态</option>{SUPPLIER_NOTE_CHECK_STATUSES.filter((status) => canViewDocuments || !checkStatusRequiresDocuments(status)).map((status) => <option key={status} value={status}>{SUPPLIER_NOTE_CHECK_LABELS[status]}</option>)}</AppSelect>
      <input aria-label="搜索送货单号、供应商代码或PI订单号" maxLength={80} value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search(); }} placeholder="搜索送货单号 / 供应商代码 / PI订单号" className="h-10 min-w-64 flex-1 rounded-lg border border-slate-200 px-3 text-slate-700 placeholder:text-slate-400"/>
      <button onClick={search} className="h-10 rounded-lg bg-blue-600 px-4 text-white">查询</button>
      <button type="button" onClick={reset} className="h-10 rounded-lg border px-3 text-slate-700">重置</button>
    </div><p className="mt-2 text-xs text-slate-500">日期、供应商及搜索词作用于汇总和明细；核对状态与金额卡片只筛选采购明细，不改变上方金额汇总。</p></section>
    {error && !payment ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {canViewAccount ? <SupplierAccountLedger canRecordPayment={canRecordPayment}
      selectedSupplierId={filters.supplierId} onLedgerChange={() => { void load(); }} /> : null}
    <section className="space-y-2" aria-label="供应商对账概览">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-white px-4 py-2.5 text-xs text-slate-600">
        <span>送货单 <strong className="ml-1 text-sm text-slate-900 tabular-nums">{loading || !summary ? "—" : `${summary.note_count} 张`}</strong></span>
        <span>供应商 <strong className="ml-1 text-sm text-slate-900 tabular-nums">{loading || !summary ? "—" : `${summary.supplier_count} 家`}</strong></span>
        <span>实收 <strong className="ml-1 text-sm text-slate-900 tabular-nums">{loading || !summary ? "—" : `${summary.quantity} 件`}</strong></span>
        {!loading && summary && summary.cash_paid_reported_cny > 0 ? <button type="button" onClick={() => document.getElementById("supplier-delivery-notes")?.scrollIntoView({ behavior: "smooth" })} className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100">现场报付待核 {money(summary.cash_paid_reported_cny)} · 不冲减应付 ↗</button> : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryMetric label="应付金额" value={money(summary?.allocated_cny || 0)} loading={loading || !summary} hint="查看全部采购明细；含已关联供应商送货单的包装费" selected={!filters.amountFocus} onClick={() => focusDetail("")} tone="text-blue-700"/>
        <SummaryMetric label="已分配至送货单付款" value={money(summary?.paid_cny || 0)} loading={loading || !summary} hint="筛选有付款分配的送货单；部分付款也会显示" selected={filters.amountFocus === "PAID"} onClick={() => focusDetail("PAID")} tone="text-emerald-700"/>
        <SummaryMetric label="送货单未付余额" value={money(summary?.unpaid_cny || 0)} loading={loading || !summary} hint="筛选仍有未付余额的送货单；部分付款也会显示" selected={filters.amountFocus === "UNPAID"} onClick={() => focusDetail("UNPAID")} tone="text-rose-700"/>
      </div>
    </section>
    <section id="supplier-purchase-summary" className="scroll-mt-20 rounded-xl border bg-white p-4" aria-label="供应商采购货款汇总">
      <h2 className="font-semibold">供应商采购货款汇总</h2>
      <p className="mt-1 text-xs text-slate-500">与下方采购明细共用日期和供应商筛选；汇总覆盖全部匹配送货单，不受明细分页影响。</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b bg-slate-50 text-slate-600"><tr><th className="p-3">供应商代码 / 名称</th><th>结算方式</th><th>送货单</th><th>回货数量</th><th>应付</th><th>财务已付</th><th>未付</th><th>操作</th></tr></thead>
        <tbody>{supplierSummary.map((supplier) => <tr key={supplier.supplier_id} className="border-b last:border-0"><td className="p-3 font-medium">{supplier.system_code} · {supplier.supplier_name || "未补名称"}</td><td>{settlementLabel(supplier.settlement_cycle, supplier.settlement_days, supplier.settlement_terms_original)}</td><td>{supplier.note_count} 张</td><td>{supplier.quantity} 件</td><td className="tabular-nums">{money(supplier.allocated_cny)}</td><td className="tabular-nums">{money(supplier.paid_cny)}</td><td className="tabular-nums">{money(supplier.unpaid_cny)}</td><td className="whitespace-nowrap"><button type="button" onClick={() => showSupplierNotes(supplier.supplier_id)} className="font-medium text-blue-700 hover:underline" aria-label={`查看${supplier.system_code}的采购明细`}>查看明细</button><button type="button" onClick={() => setExpandedSupplier((current) => current === supplier.supplier_id ? null : supplier.supplier_id)} className="ml-3 text-slate-600 hover:underline">月度</button></td></tr>)}</tbody>
      </table>{!loading && !supplierSummary.length ? <p className="py-8 text-center text-sm text-slate-500">所选日期范围没有供应商回货分配</p> : null}</div>
      {expandedSupplier ? <div className="mt-3 rounded-lg bg-slate-50 p-3"><h3 className="text-sm font-medium">{supplierSummary.find((row) => row.supplier_id === expandedSupplier)?.system_code} · 月度采购与付款</h3><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr className="border-b"><th className="py-2">月份</th><th>应付</th><th>已付</th><th>未付</th></tr></thead><tbody>{monthlySummary.filter((row) => row.supplier_id === expandedSupplier).map((row) => <tr key={row.month} className="border-b last:border-0"><td className="py-2">{row.month.slice(0, 7)}</td><td>{money(row.allocated_cny)}</td><td>{money(row.paid_cny)}</td><td>{money(row.unpaid_cny)}</td></tr>)}</tbody></table></div></div> : null}
    </section>
    <div id="supplier-monthly-matrix" className="scroll-mt-20" aria-busy={loading}>{loading ? <p role="status" className="mb-2 text-xs text-slate-600">正在更新月度对账数据…</p> : null}<div className={loading ? "pointer-events-none opacity-50" : ""}><SupplierMonthlyMatrix suppliers={supplierSummary} monthly={monthlySummary} metric={matrixMetric} dateFrom={filters.from} dateTo={filters.to} supplierId={filters.supplierId} onMetricChange={setMatrixMetric} onDrill={drillToMonth}/></div></div>
    {matrixOrigin ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"><span>正在核对：{filters.supplierId ? supplierSummary.find((item) => item.supplier_id === filters.supplierId)?.system_code || "所选供应商" : "全部供应商"} · {filters.from} 至 {filters.to}。上方汇总与下方明细均已切换到同一范围。</span><button type="button" onClick={returnToMatrix} className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 font-medium text-blue-700">返回原汇总范围</button></div> : null}
    <section id="supplier-delivery-notes" className="scroll-mt-20 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><h2 className="font-semibold">采购明细</h2><span tabIndex={0} aria-label="采购明细说明" className="group relative inline-flex cursor-help rounded-full text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Info size={15}/><span role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border bg-white p-3 text-xs leading-5 text-slate-700 shadow-lg group-hover:block group-focus:block">每张真实送货单一行；展开可核对关联 PI、产品分配及付款流水。缺件不等于未付款；付款与纸单核对分别记录。明细分页不改变上方汇总金额。</span></span></div>{filters.supplierId ? <button type="button" onClick={clearSupplierFilter} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700">{supplierSummary.find((item) => item.supplier_id === filters.supplierId)?.system_code || "所选供应商"} · 清除筛选</button> : null}</div>
      <p className="mt-1 text-xs text-slate-500">当前明细 {loading ? "加载中" : `${detailCount} / ${summary?.note_count || 0} 张`}；{filters.amountFocus === "PAID" ? "已付含部分付款" : filters.amountFocus === "UNPAID" ? "未付含部分付款" : "全部付款状态"}{filters.checkStatus ? ` · ${SUPPLIER_NOTE_CHECK_LABELS[filters.checkStatus]}` : ""}。上方汇总金额不受明细筛选影响。</p>
      {canRecordPayment ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs"><span>已选 {selectedNotes.length} 张同一供应商送货单（仅当前页，最多 50 张）</span><button type="button" disabled={selectedNotes.length < 2 || loading} onClick={openBatchPayment} className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40">批量登记付款</button>{selectedNotes.length ? <button type="button" onClick={() => setSelectedNotes([])} className="text-slate-600 hover:underline">清空选择</button> : null}</div> : null}
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1760px] text-left text-sm"><thead><tr className="border-b bg-slate-50 text-slate-600"><th className="p-3">选择 / 送货日期</th><th>供应商</th><th>当时商务条件</th><th>送货单号</th><th className="min-w-44">关联 PI</th><th className="min-w-52">纸单影像</th><th className="min-w-52">核对状态</th><th>数量</th><th>应付金额</th><th>纸单金额 / 差额</th><th>已付</th><th>未付</th><th className="sticky right-0 z-20 w-[192px] min-w-[192px] border-l bg-slate-50 px-3 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.12)]">操作</th></tr></thead><tbody>{notes.map((note) => <Fragment key={note.id}><tr className="border-b align-top"><td className="p-3"><div className="flex items-center gap-2">{canRecordPayment ? <input type="checkbox" aria-label={`选择送货单 ${note.note_number} 批量付款`} checked={selectedNotes.includes(note.id)} disabled={loading || note.number_pending || !note.attachments?.length || note.unpaid_cny <= 0 || selectedNotes.length >= 50 && !selectedNotes.includes(note.id) || selectedNotes.some((id) => notes.find((item) => item.id === id)?.supplier_id !== note.supplier_id)} onChange={() => toggleSelectedNote(note)} className="h-4 w-4 accent-emerald-700"/> : null}<span>{note.document_date}</span></div></td><td>{note.supplier_code}<small className="block text-slate-500">{note.supplier_name}</small></td><td>{settlementLabel(note.settlement_cycle, note.settlement_days, note.settlement_terms_original)}</td><td>{note.note_number}</td><td className="max-w-56 py-2 pr-3"><div className="flex flex-wrap gap-1.5">{groupAllocations(note.allocations).slice(0, 2).map((group) => <Link key={group.piId} href={`/orders/${group.piId}`} className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 hover:underline" title={`打开 PI ${group.piNumber || group.systemPiNumber}`}>{group.piNumber || group.systemPiNumber}</Link>)}{groupAllocations(note.allocations).length > 2 ? <button type="button" onClick={() => setExpanded(note.id)} className="text-xs text-blue-700 hover:underline">另 {groupAllocations(note.allocations).length - 2} 单 ↓</button> : null}{!note.allocations.length ? <span className="text-xs text-amber-700">未关联 PI</span> : null}</div></td><td className="w-52 min-w-52 max-w-52 p-2 align-top"><SupplierDeliveryNoteFiles note={{ id: note.id, supplier_code: note.supplier_code, note_number: note.note_number, document_date: note.document_date, attachments: note.attachments || [] }} compact/></td><td className="w-52 min-w-52 max-w-52 px-2 py-3 align-top">{noteChecks(note, canViewDocuments).length ? noteChecks(note, canViewDocuments).map((check) => <span key={check} title={check === "待补送货单号" ? "送货单号待补；已发生付款应单笔登记并填写付款依据，纸单核对待补号后完成" : check === "缺纸单图片" ? "纸单影像待补；已付款不代表纸单已核对" : check === "待录纸单金额" ? "纸单金额尚未录入，请核对实物凭证" : "纸单金额与系统分配金额不同，请核查"} className="mb-1 inline-block max-w-full truncate rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{check}</span>) : <span className="text-xs text-emerald-700">已核对 · 金额一致</span>}</td><td>{note.allocated_quantity}</td><td>{money(note.allocated_cny)}{Number(note.packaging_charges_cny || 0) > 0 ? <small className="block text-amber-700">含包装费 {money(note.packaging_charges_cny || 0)}</small> : null}</td><td>{note.paper_total_cny === null ? "未录入" : <>{money(note.paper_total_cny)}<small className={`block ${Math.abs(note.paper_total_cny - Number(note.goods_allocated_cny ?? note.allocated_cny)) > 0.005 ? "text-amber-700" : "text-emerald-700"}`}>{Math.abs(note.paper_total_cny - Number(note.goods_allocated_cny ?? note.allocated_cny)) > 0.005 ? `货款差额 ${money(note.paper_total_cny - Number(note.goods_allocated_cny ?? note.allocated_cny))}` : "货款一致"}</small></>}</td><td>{money(note.paid_cny)}</td><td className="font-medium">{money(note.unpaid_cny)}</td><td className="sticky right-0 z-10 w-[192px] min-w-[192px] space-x-2 whitespace-nowrap border-l bg-white px-3 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.12)]"><button onClick={() => setExpanded((value) => value === note.id ? null : note.id)} className="text-blue-700">{expanded === note.id ? "收起" : `查看PI（${groupAllocations(note.allocations).length}）`}</button>{canRecordPayment && !note.number_pending ? <button disabled={!note.attachments?.length} title={!note.attachments?.length ? "请先上传此送货单对应的纸单影像" : undefined} onClick={() => { setError(""); setPaperDraft({ noteId: note.id, noteNumber: note.note_number, amount: note.paper_total_cny === null ? "" : Number(note.paper_total_cny).toFixed(2), version: note.updated_at, reason: "" }); }} className="text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400">核对纸单</button> : null}{canRecordPayment && note.unpaid_cny > 0 ? <button onClick={() => openPayment(note)} className="text-emerald-700">登记付款</button> : null}</td></tr>{expanded === note.id ? <tr className="bg-slate-50"><td colSpan={13} className="p-3"><NoteDetails note={note}/></td></tr> : null}</Fragment>)}</tbody></table>
        {!loading && notes.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">当前筛选条件下没有匹配送货单</p> : null}</div>
      <div className="mt-4"><AppPagination page={page} pageSize={pageSize} total={detailCount} itemLabel="张送货单" pageSizes={[10, 20, 50, 100]} onPage={(next) => { setPage(next); setExpanded(null); }} onPageSize={(size) => { setPageSize(size); setPage(1); setExpanded(null); }}/></div>
    </section>
    <AppDialog open={batchPayment !== null} title="批量登记供应商付款" description="仅限同一供应商；逐张分摊，整批成功或整批不入账。提交后不可覆盖或删除。" onClose={() => { if (!busy) { setBatchPayment(null); setError(""); } }}>
      {batchPayment ? <form onSubmit={(event) => { event.preventDefault(); void submitBatchPayment(); }} className="space-y-3 text-sm">
        <p className="font-medium">供应商 {batchPayment.supplierCode} · {batchPayment.lines.length} 张送货单 · 合计 {money(batchPayment.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0))}</p>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded border p-2">{batchPayment.lines.map((line) => <label key={line.noteId} className="flex items-center justify-between gap-3"><span>送货单 {line.noteNumber}<small className="block text-slate-500">未付 {money(line.unpaid)}</small></span><input required inputMode="decimal" aria-label={`送货单 ${line.noteNumber} 付款金额`} value={line.amount} onChange={(event) => setBatchPayment((current) => current && { ...current, lines: current.lines.map((item) => item.noteId === line.noteId ? { ...item, amount: event.target.value } : item) })} className="h-9 w-32 rounded border px-2 text-right"/></label>)}</div>
        <div className="grid gap-3 sm:grid-cols-2"><label>付款日期<input required type="date" max={localDate(new Date())} value={batchPayment.paidOn} onChange={(event) => setBatchPayment((current) => current && { ...current, paidOn: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label><div><span>付款方式</span><AppSelect value={batchPayment.method} onChange={(event) => setBatchPayment((current) => current && { ...current, method: event.target.value })} aria-label="批量付款方式" className="mt-1 h-10 w-full rounded border px-3"><option value="CASH">现金</option><option value="BANK">银行转账</option><option value="ALIPAY">支付宝</option><option value="WECHAT">微信支付</option><option value="OTHER">其他</option></AppSelect></div></div>
        <label className="block">付款凭证号（选填，同一凭证号关联所选送货单）<input maxLength={200} value={batchPayment.reference} onChange={(event) => setBatchPayment((current) => current && { ...current, reference: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label className="flex items-start gap-2"><input required type="checkbox" checked={batchPayment.confirmed} onChange={(event) => setBatchPayment((current) => current && { ...current, confirmed: event.target.checked })} className="mt-1"/><span>我已核对付款日期、供应商、每张送货单分摊金额及凭证，确认不是重复登记。</span></label>
        {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setBatchPayment(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40">{busy ? "登记中…" : "确认整批登记"}</button></div>
      </form> : null}
    </AppDialog>
    <AppDialog open={paperDraft !== null} title="核对纸质送货单金额" description="录入纸单金额后与系统已分配货款比对；差额不会自动改写 PI、回货或付款记录。" onClose={() => { if (!busy) { setPaperDraft(null); setError(""); } }}>
      {paperDraft ? <form onSubmit={(event) => { event.preventDefault(); void submitPaperTotal(); }} className="space-y-3 text-sm">
        <p>送货单号：{paperDraft.noteNumber}</p>
        <label className="block">纸质单据总金额 ¥（必填）<input required inputMode="decimal" value={paperDraft.amount} onChange={(event) => setPaperDraft((current) => current && { ...current, amount: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label className="block">核对说明（选填）<textarea maxLength={500} value={paperDraft.reason} onChange={(event) => setPaperDraft((current) => current && { ...current, reason: event.target.value })} className="mt-1 min-h-20 w-full rounded border px-3 py-2"/></label>
        {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setPaperDraft(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-40">{busy ? "保存中…" : "确认核对"}</button></div>
      </form> : null}
    </AppDialog>
    <AppDialog open={payment !== null} title="登记供应商付款" description="付款流水提交后不可覆盖或删除；请与银行或现金凭证核对。" onClose={() => { if (!busy) { setPayment(null); setError(""); } }}>
      {payment ? <form onSubmit={(event) => { event.preventDefault(); void submitPayment(); }} className="space-y-3 text-sm"><p>送货单号：{payment.noteNumber}</p>{payment.documentsPending ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">此单送货单号或纸单影像待补。只登记已核实的真实付款；登记后仍须补齐单据，不能视为纸单核对完成。</p> : null}<div className="grid gap-3 sm:grid-cols-2">
        <label>付款金额（CNY）<input required inputMode="decimal" value={payment.amount} onChange={(event) => setPayment((current) => current && { ...current, amount: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>付款日期<input required type="date" max={localDate(new Date())} value={payment.paidOn} onChange={(event) => setPayment((current) => current && { ...current, paidOn: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <div><span>付款方式</span><AppSelect value={payment.method} onChange={(event) => setPayment((current) => current && { ...current, method: event.target.value })} aria-label="付款方式" className="mt-1 h-10 w-full rounded border px-3"><option value="CASH">现金</option><option value="BANK">银行转账</option><option value="ALIPAY">支付宝</option><option value="WECHAT">微信支付</option><option value="OTHER">其他</option></AppSelect></div>
        <label>付款凭证号／流水号（选填）<input maxLength={200} value={payment.reference} onChange={(event) => setPayment((current) => current && { ...current, reference: event.target.value })} className="mt-1 h-10 w-full rounded border px-3"/></label>
      </div>{payment.documentsPending && !payment.reference.trim() ? <label className="flex items-start gap-2 rounded bg-amber-50 p-3 text-amber-900"><input type="checkbox" checked={payment.confirmedPending} onChange={(event) => setPayment((current) => current && { ...current, confirmedPending: event.target.checked })} className="mt-1"/><span>我已核实实际付款；凭证号暂未取得，送货单资料仍待补。</span></label> : null}{error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}<div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setPayment(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40">{busy ? "登记中…" : "确认登记付款"}</button></div></form> : null}
    </AppDialog>
  </div></main>;
}
