"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SupplierDeliveryNoteFiles, type SupplierDeliveryNoteView } from "@/components/supplier-delivery-note-files";
import { AppSelect } from "@/components/ui/app-select";

type Row = {
  stock_order_item_id: string; quantity: number;
  item: { id: string; line_number: number; item_name: string | null; brand: string | null;
    model: string | null; quality: string | null; received_quantity: number; shipped_quantity: number };
  order: { id: string; order_number: string; warehouse_reference_number: string | null;
    status: string; updated_at: string };
};
type Supplier = { id: string; system_code: string };
type Draft = { row: Row; supplierId: string; noteNumber: string; date: string; quantity: string; unitPrice: string };

export function LegacySupplierSourcesView({ orderId, onUpdated }: { orderId?: string; onUpdated?: () => void } = {}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(orderId || null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newNote, setNewNote] = useState<SupplierDeliveryNoteView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/stock-orders/legacy-receipt-sources?page=${page}${orderId ? `&order_id=${encodeURIComponent(orderId)}` : ""}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setLoading(false);
    if (!response?.ok) { setError(body.error || "历史来源清单加载失败"); return; }
    if (page > 1 && !(body.data || []).length && Number(body.count || 0) > 0) {
      setPage(Math.ceil(Number(body.count) / 50));
      return;
    }
    setRows(body.data || []); setCount(Number(body.count || 0)); setError("");
  }, [page, orderId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    async function loadSuppliers() {
      try {
        const all: Supplier[] = [];
        for (let current = 1; current <= 100; current++) {
          const response = await fetch(`/api/suppliers?page=${current}&active=true`, { cache: "no-store" });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || "供应商代码加载失败");
          all.push(...(body.data || []));
          if (all.length >= Number(body.count || 0) || !(body.data || []).length) break;
        }
        if (!cancelled) setSuppliers(all);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "供应商代码加载失败");
      }
    }
    void loadSuppliers();
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    if (!draft || busy) return;
    if (!draft.supplierId || !draft.noteNumber.trim() || !draft.date || !/^\d+$/.test(draft.quantity)
      || Number(draft.quantity) < 1 || Number(draft.quantity) > draft.row.quantity
      || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(draft.unitPrice)) {
      setError("请按纸单选择供应商，填写真实单号、日期、待归属数量及采购单价"); return;
    }
    setBusy(true); setError(""); setMessage("");
    const response = await fetch("/api/stock-orders/legacy-receipt-sources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock_order_item_id: draft.row.stock_order_item_id,
        supplier_id: draft.supplierId, note_number: draft.noteNumber.trim(),
        document_date: draft.date, quantity: Number(draft.quantity),
        purchase_unit_price_cny: draft.unitPrice,
        expected_stock_updated_at: draft.row.order.updated_at }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "历史来源补全失败，请刷新后重试"); return; }
    const supplierCode = suppliers.find((item) => item.id === draft.supplierId)?.system_code || "供应商";
    setNewNote({ id: body.data.delivery_note_id, supplier_code: supplierCode,
      note_number: draft.noteNumber.trim(), document_date: draft.date, attachments: [] });
    setMessage(`已关联 ${draft.quantity} 件历史回货，实收及交货数量未增加；请继续上传对应纸单照片。`);
    setDraft(null);
    await load();
  }

  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.order.id, [...(grouped.get(row.order.id) || []), row]);

  return <section id={orderId ? undefined : "legacy-receipt-sources"} className={orderId ? "mt-3" : "mt-5 scroll-mt-5 rounded-xl border border-amber-200 bg-white p-4"} aria-label="历史回货来源待补清单">
    {orderId ? null : <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold text-amber-900">历史回货来源待补 · {count} 张 PI</h2><p className="mt-1 text-xs text-slate-600">仅仓库员可处理。已登记实收但未归属真实送货单的产品才列入；未回货的备货产品无需补录。展开 PI 后按纸单核对供应商代码、单号、日期、数量和采购单价，再上传纸单照片；不会增加库存。</p></div><button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-1.5 text-xs text-blue-700">刷新</button></div>}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
    {newNote ? <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><SupplierDeliveryNoteFiles note={newNote} canUpload onUploaded={() => { setNewNote(null); setMessage("纸单照片已保存，可继续核对其他历史来源。"); void load(); onUpdated?.(); }}/></div> : null}
    <div className="mt-3 space-y-2">{loading ? <p className="p-5 text-center text-sm text-slate-500">加载中…</p> : error ? null : grouped.size ? [...grouped].map(([groupOrderId, orderRows]) => <div key={groupOrderId} className="rounded-lg border text-sm">
      {!orderId ? <div className="flex flex-wrap items-center justify-between gap-3 p-3"><div><Link href={`/stock-orders/${groupOrderId}`} className="font-medium text-blue-700 hover:underline">{orderRows[0].order.warehouse_reference_number || orderRows[0].order.order_number}</Link><span className="ml-3 text-slate-600">待补 {orderRows.length} 项 · {orderRows.reduce((sum, row) => sum + row.quantity, 0)} 件</span></div><button type="button" aria-expanded={expandedOrder === groupOrderId} aria-controls={`legacy-items-${groupOrderId}`} onClick={() => setExpandedOrder((current) => current === groupOrderId ? null : groupOrderId)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">{expandedOrder === groupOrderId ? "收起产品" : "展开补录产品"}</button></div> : <p className="px-3 pt-3 text-xs font-medium text-amber-900">历史实收来源 · 待补 {orderRows.length} 项 / {orderRows.reduce((sum, row) => sum + row.quantity, 0)} 件</p>}
      {(expandedOrder === groupOrderId || Boolean(orderId)) ? <div id={`legacy-items-${groupOrderId}`} className="space-y-2 border-t bg-slate-50/60 p-3">{orderRows.sort((a, b) => a.item.line_number - b.item.line_number).map((row) => <div key={row.stock_order_item_id} className="rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium">第 {row.item.line_number} 行 · {[row.item.item_name, row.item.brand, row.item.model, row.item.quality].filter(Boolean).join(" / ") || "产品项"}</span><small className="ml-2 text-amber-800">待归属 {row.quantity} 件 · 已实收 {row.item.received_quantity} 件</small></div><button type="button" onClick={() => { setError(""); setNewNote(null); setDraft({ row, supplierId: "", noteNumber: "", date: "", quantity: String(row.quantity), unitPrice: "" }); }} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">补充真实来源</button></div>
      {draft?.row.stock_order_item_id === row.stock_order_item_id ? <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs">供应商代码<AppSelect aria-label="历史来源供应商" required forceSearch value={draft.supplierId} onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })} className="mt-1 h-9 w-full" placeholderValue=""><option value="">选择已核对供应商</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.system_code}</option>)}</AppSelect></label>
        <label className="text-xs">真实送货单号<input aria-label="历史来源送货单号" required maxLength={100} value={draft.noteNumber} onChange={(event) => setDraft({ ...draft, noteNumber: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        <label className="text-xs">纸单日期<input aria-label="历史来源纸单日期" required type="date" max={new Date().toISOString().slice(0, 10)} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        <label className="text-xs">本次归属数量（最多 {row.quantity}）<input aria-label="历史来源数量" required type="number" min={1} max={row.quantity} step={1} value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        <label className="text-xs">实际采购单价 ¥<input aria-label="历史来源采购单价" required type="number" min={0} step="0.01" value={draft.unitPrice} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-5"><button type="button" disabled={busy || !suppliers.length} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "保存中…" : "确认关联，不增加回货数量"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)} className="rounded-lg border px-4 py-2 text-xs">取消</button></div>
      </div> : null}
    </div>)}</div> : null}</div>) : <p className="p-5 text-center text-sm text-emerald-700">历史回货来源已补齐</p>}</div>
    {orderId ? null : <div className="mt-3 flex items-center justify-end gap-3 text-sm"><span>共 {count} 张 PI</span><button type="button" disabled={page <= 1 || loading} onClick={() => { setExpandedOrder(null); setPage(page - 1); }} className="rounded border px-3 py-1 disabled:opacity-40">上一页</button><span>{page}</span><button type="button" disabled={page * 50 >= count || loading} onClick={() => { setExpandedOrder(null); setPage(page + 1); }} className="rounded border px-3 py-1 disabled:opacity-40">下一页</button></div>}
  </section>;
}
