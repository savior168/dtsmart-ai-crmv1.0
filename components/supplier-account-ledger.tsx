"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppSelect } from "@/components/ui/app-select";

type Balance = { supplier_id: string; system_code: string; supplier_name: string | null;
  opening_as_of_date: string | null; opening_balance_cny: number | null; new_due_cny: number;
  adjustment_cny: number; note_payment_cny: number; account_payment_cny: number;
  unallocated_payment_cny: number; balance_cny: number };
type Payment = { id: string; amount_cny: number; paid_on: string; payment_method: string;
  payment_reference: string; explanation: string; reversed_at: string | null;
  reversal_reason: string | null };
type Allocation = { id: string; account_payment_id: string; delivery_note_id: string;
  amount_cny: number; reversed_at: string | null; reversal_reason: string | null };
type Note = { id: string; note_number: string; document_date: string; number_pending: boolean;
  due_cny: number; paid_cny: number };
type Detail = { opening: { as_of_date: string; balance_cny: number; explanation: string } | null;
  adjustments: Array<{ id: string; effective_on: string; amount_cny: number; explanation: string }>;
  payments: Payment[]; allocations: Allocation[]; notes: Note[];
  payment_page: number; payment_count: number; has_more_payments: boolean; has_more_notes: boolean;
  has_more_adjustments: boolean };
type Action = "OPENING" | "ADJUSTMENT" | "PAYMENT" | "ALLOCATE" | "REVERSE_ALLOCATION" | "REVERSE_PAYMENT";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const money = (value: number) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyInput = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export function SupplierAccountLedger({ canRecordPayment, selectedSupplierId, onLedgerChange }: {
  canRecordPayment: boolean; selectedSupplierId: string; onLedgerChange: () => void;
}) {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [supplierId, setSupplierId] = useState(selectedSupplierId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [noteSearch, setNoteSearch] = useState("");
  const [appliedNoteSearch, setAppliedNoteSearch] = useState("");
  const [paymentPage, setPaymentPage] = useState(1);
  const [dialog, setDialog] = useState<Action | null>(null);
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(today);
  const [method, setMethod] = useState("BANK");
  const [reference, setReference] = useState("");
  const [explanation, setExplanation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [paymentId, setPaymentId] = useState("");
  const [noteId, setNoteId] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadSequence = useRef(0);
  useEffect(() => { setSupplierId(selectedSupplierId); setPaymentPage(1); }, [selectedSupplierId]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (supplierId) params.set("supplier_id", supplierId);
    if (supplierId) params.set("payment_page", String(paymentPage));
    if (supplierId && appliedNoteSearch) params.set("note_search", appliedNoteSearch);
    const response = await fetch(`/api/supplier-reconciliation/account?${params}`, { cache: "no-store" }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (sequence !== loadSequence.current) return;
    setLoading(false);
    if (!response?.ok) { setError(data.error || "供应商总账加载失败"); return; }
    setBalances(data.balances || []);
    setDetail(supplierId ? data as Detail : null);
    setError("");
  }, [supplierId, appliedNoteSearch, paymentPage]);
  useEffect(() => { void load(); }, [load]);
  const selected = balances.find((item) => item.supplier_id === supplierId);
  const activeAllocations = detail?.allocations.filter((item) => !item.reversed_at) || [];
  const unallocated = (payment: Payment) => Number(payment.amount_cny) - activeAllocations
    .filter((item) => item.account_payment_id === payment.id).reduce((sum, item) => sum + Number(item.amount_cny), 0);
  const selectedPayment = detail?.payments.find((item) => item.id === paymentId);
  const selectedNote = detail?.notes.find((item) => item.id === noteId);
  function open(action: Action, options: { paymentId?: string; allocationId?: string } = {}) {
    setDialog(action); setError(""); setAmount(""); setOn(today()); setMethod("BANK");
    setReference(""); setExplanation(""); setConfirmed(false); setNoteId("");
    setPaymentId(options.paymentId || ""); setAllocationId(options.allocationId || "");
    setRequestId(crypto.randomUUID());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || busy || !supplierId) return;
    if (["OPENING", "PAYMENT", "ALLOCATE"].includes(dialog)
      && (!moneyInput.test(amount) || Number(amount) <= 0)) { setError("请输入大于零、最多两位小数的金额"); return; }
    if (dialog === "ADJUSTMENT" && (!moneyInput.test(amount.replace(/^-/, "")) || Number(amount) === 0)) {
      setError("请输入非零调整金额，减少欠款请填负数"); return;
    }
    if ((dialog === "OPENING" || dialog === "PAYMENT") && !confirmed) {
      setError("请先核对并确认金额口径或实际付款"); return;
    }
    setBusy(true); setError("");
    const response = await fetch("/api/supplier-reconciliation/account", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: dialog, supplier_id: supplierId, amount_cny: amount,
        on, payment_method: method, payment_reference: reference, explanation,
        request_id: requestId, account_payment_id: paymentId, delivery_note_id: noteId,
        allocation_id: allocationId, confirmed_overlap: confirmed, confirmed_payment: confirmed }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "登记失败，未写入账本"); return; }
    setDialog(null);
    await load();
    onLedgerChange();
  }
  return <section className="rounded-xl border bg-white p-4 shadow-sm" aria-label="供应商总账">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">供应商总账</h2><p className="mt-1 text-xs text-slate-500">统计当前已登记的期初欠款、送货单应付与实际付款；不受上方送货日期筛选影响。未分配付款降低供应商总欠款，但不代表具体送货单已结清。</p></div>
      <button type="button" disabled={loading} onClick={() => void load()} className="rounded-lg border px-3 py-2 text-xs text-blue-700 disabled:opacity-50">刷新总账</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <AppSelect value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setDetail(null); setPaymentPage(1); setNoteSearch(""); setAppliedNoteSearch(""); }} aria-label="查看供应商总账" className="h-10 min-w-64 rounded-lg border px-3 text-sm" forceSearch>
        <option value="">选择供应商查看总账及付款流水</option>
        {balances.map((item) => <option key={item.supplier_id} value={item.supplier_id}>{item.system_code} · {item.supplier_name || "未补名称"}</option>)}
      </AppSelect>
      {canRecordPayment && supplierId ? <>
        {!detail?.opening ? <button type="button" onClick={() => open("OPENING")} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800">登记历史期初欠款</button> : <button type="button" onClick={() => open("ADJUSTMENT")} className="rounded-lg border px-3 py-2 text-sm text-slate-700">账款调整</button>}
        <button type="button" onClick={() => open("PAYMENT")} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">按供应商总账登记付款</button>
      </> : null}
    </div>
    {selected ? <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg bg-slate-50 p-3">期初欠款 <strong className="block tabular-nums">{selected.opening_balance_cny === null ? "未建期初" : money(selected.opening_balance_cny)}</strong><small className="text-slate-500">{selected.opening_as_of_date || "覆盖全部已录送货单"}</small></div>
      <div className="rounded-lg bg-blue-50 p-3">期初后新增应付 <strong className="block tabular-nums">{money(selected.new_due_cny)}</strong><small>调整 {money(selected.adjustment_cny)}</small></div>
      <div className="rounded-lg bg-emerald-50 p-3">实际已付款 <strong className="block tabular-nums">{money(Number(selected.note_payment_cny) + Number(selected.account_payment_cny))}</strong><small>待分配到单据 {money(selected.unallocated_payment_cny)}</small></div>
      <div className="rounded-lg bg-amber-50 p-3">供应商当前余额 <strong className="block tabular-nums">{money(selected.balance_cny)}</strong><small>{selected.balance_cny < 0 ? "负数为预付／供应商应退" : "正数为尚欠"}</small></div>
    </div> : null}
    {supplierId && detail ? <>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="border-b bg-slate-50"><tr><th className="p-2">付款日期</th><th>方式／凭证号</th><th>实际付款</th><th>已分配至单据</th><th>未分配</th><th>操作</th></tr></thead><tbody>
        {detail.payments.map((payment) => <tr key={payment.id} className={`border-b ${payment.reversed_at ? "text-slate-400" : ""}`}><td className="p-2">{payment.paid_on}</td><td>{payment.payment_method} · {payment.payment_reference || "未填写"}{payment.reversed_at ? <span className="ml-2 text-rose-700">已撤销</span> : null}</td><td>{money(payment.amount_cny)}</td><td>{payment.reversed_at ? "—" : money(payment.amount_cny - unallocated(payment))}</td><td>{payment.reversed_at ? "—" : money(unallocated(payment))}</td><td>{canRecordPayment && !payment.reversed_at && unallocated(payment) > 0 ? <button type="button" onClick={() => open("ALLOCATE", { paymentId: payment.id })} className="text-blue-700 hover:underline">分配到送货单</button> : null}{activeAllocations.filter((entry) => entry.account_payment_id === payment.id).map((entry) => <span key={entry.id} className="mt-1 block text-slate-500">已分配 {detail.notes.find((note) => note.id === entry.delivery_note_id)?.note_number || entry.delivery_note_id.slice(0, 8)}：{money(entry.amount_cny)}{canRecordPayment ? <button type="button" onClick={() => open("REVERSE_ALLOCATION", { allocationId: entry.id })} className="ml-2 text-rose-700 hover:underline">更正分配</button> : null}</span>)}{canRecordPayment && !payment.reversed_at && !activeAllocations.some((entry) => entry.account_payment_id === payment.id) ? <button type="button" onClick={() => open("REVERSE_PAYMENT", { paymentId: payment.id })} className="ml-2 text-rose-700 hover:underline">撤销误登记</button> : null}</td></tr>)}
      </tbody></table>{detail.payment_count > 50 ? <div className="flex items-center justify-end gap-2 p-2 text-xs"><span>共 {detail.payment_count} 笔 · 第 {paymentPage} 页</span><button type="button" disabled={loading || paymentPage <= 1} onClick={() => setPaymentPage((page) => page - 1)} className="rounded border px-2 py-1 disabled:opacity-40">上一页</button><button type="button" disabled={loading || !detail.has_more_payments} onClick={() => setPaymentPage((page) => page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">下一页</button></div> : null}{!detail.payments.length ? <p className="p-3 text-xs text-slate-500">暂无供应商总账付款；按送货单付款仍在下方送货单明细中查看。</p> : null}</div>
      {detail.opening ? <p className="mt-2 text-xs text-slate-500">期初截止 {detail.opening.as_of_date} · {detail.opening.explanation}</p> : null}
      {detail.adjustments.length ? <div className="mt-2 text-xs text-slate-600">账款调整：{detail.adjustments.map((entry) => <span key={entry.id} className="mr-3 inline-block">{entry.effective_on} {money(entry.amount_cny)} · {entry.explanation}</span>)}</div> : null}
      {detail.has_more_adjustments ? <p className="mt-1 text-xs text-amber-700">仅展示最近 100 条调整流水；总账余额已计入全部调整。</p> : null}
    </> : null}
    {error && !dialog ? <p role="alert" className="mt-3 rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
    <AppDialog open={dialog !== null} title={dialog === "OPENING" ? "登记历史期初欠款" : dialog === "PAYMENT" ? "按供应商总账登记付款" : dialog === "ADJUSTMENT" ? "登记账款调整" : dialog === "ALLOCATE" ? "分配付款至送货单" : dialog === "REVERSE_PAYMENT" ? "撤销误登记付款" : "更正付款分配"} onClose={() => { if (!busy) setDialog(null); }}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="font-medium">{selected?.system_code} · {selected?.supplier_name}</p>
        {dialog === "OPENING" ? <p className="rounded bg-amber-50 p-3 text-amber-900">期初余额是截止日尚欠的净额。截止日及以前的已录送货单和已付款均不再重复计入总账，请先与原始账册核对。每家供应商仅能登记一次；错误须留痕调整。</p> : null}
        {dialog === "PAYMENT" ? <p className="rounded bg-blue-50 p-3 text-blue-900">仅登记确实已支付的款项；可以暂不指定送货单。分配到单据不会再生成第二笔付款。</p> : null}
        {dialog === "ALLOCATE" ? <p className="rounded bg-blue-50 p-3 text-blue-900">本笔尚未分配：{money(selectedPayment ? unallocated(selectedPayment) : 0)}。只能分配给同一供应商的送货单，不能超过其未付余额。</p> : null}
        {dialog === "REVERSE_PAYMENT" ? <p className="rounded bg-rose-50 p-3 text-rose-800">仅撤销误登记的系统付款记录，不会撤销真实银行付款。已有送货单分配时须先更正分配；原记录保留审计痕迹。</p> : null}
        {dialog === "OPENING" || dialog === "ADJUSTMENT" || dialog === "PAYMENT" ? <label className="block">{dialog === "OPENING" ? "期初截止日期" : dialog === "PAYMENT" ? "实际付款日期" : "调整生效日期"}<input required type="date" max={today()} value={on} onChange={(event) => setOn(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3"/></label> : null}
        {dialog === "ALLOCATE" ? <>
          <label className="block">查找送货单号<div className="mt-1 flex gap-2"><input value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setAppliedNoteSearch(noteSearch.trim()); setNoteId(""); } }} maxLength={100} placeholder="输入送货单号查找历史单据" className="h-10 min-w-0 flex-1 rounded-lg border px-3"/><button type="button" onClick={() => { setAppliedNoteSearch(noteSearch.trim()); setNoteId(""); }} className="rounded-lg border px-3">查找</button></div></label>
          <div><span>选择送货单</span><AppSelect value={noteId} onChange={(event) => setNoteId(event.target.value)} aria-label="选择送货单分配付款" forceSearch className="mt-1 h-10 w-full rounded-lg border px-3"><option value="">请选择送货单</option>{detail?.notes.filter((note) => !note.number_pending && Number(note.due_cny) > Number(note.paid_cny)).map((note) => <option key={note.id} value={note.id}>{note.note_number} · 未付 {money(note.due_cny - note.paid_cny)}</option>)}</AppSelect>{selectedNote ? <small className="text-slate-500">送货日期 {selectedNote.document_date} · 未付 {money(selectedNote.due_cny - selectedNote.paid_cny)}</small> : null}</div>
          {detail?.has_more_notes ? <p className="text-xs text-amber-700">仅显示最近100张，输入单号可查找其他历史单据。</p> : null}
        </> : null}
        {dialog !== "REVERSE_ALLOCATION" ? <label className="block">{dialog === "ADJUSTMENT" ? "调整金额（减少欠款填负数）" : "金额（CNY）"}<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3"/></label> : null}
        {dialog === "PAYMENT" ? <><div><span>付款方式</span><AppSelect value={method} onChange={(event) => setMethod(event.target.value)} aria-label="供应商总账付款方式" className="mt-1 h-10 w-full rounded-lg border px-3"><option value="BANK">银行转账</option><option value="CASH">现金</option><option value="ALIPAY">支付宝</option><option value="WECHAT">微信支付</option><option value="OTHER">其他</option></AppSelect></div><label className="block">付款凭证号／流水号（选填）<input maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3"/></label></> : null}
        {dialog === "OPENING" || dialog === "ADJUSTMENT" || dialog === "REVERSE_ALLOCATION" || dialog === "REVERSE_PAYMENT" || dialog === "PAYMENT" ? <label className="block">{dialog === "PAYMENT" ? reference.trim() ? "备注（选填）" : "付款说明（未填凭证号时必填）" : "核对说明／更正原因（必填）"}<textarea required={dialog !== "PAYMENT" || !reference.trim()} minLength={dialog === "PAYMENT" && reference.trim() ? undefined : 4} maxLength={500} value={explanation} onChange={(event) => setExplanation(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-3"/></label> : null}
        {dialog === "OPENING" || dialog === "PAYMENT" ? <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1"/><span>{dialog === "OPENING" ? "我已核对该金额与系统已有送货单及付款不存在重复入账" : "我已核对实际付款凭证，本次是真实发生的一笔付款"}</span></label> : null}
        {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setDialog(null)} className="rounded-lg border px-4 py-2">取消</button><button type="submit" disabled={busy || dialog === "ALLOCATE" && !noteId} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{busy ? "处理中…" : "确认登记"}</button></div>
      </form>
    </AppDialog>
  </section>;
}
