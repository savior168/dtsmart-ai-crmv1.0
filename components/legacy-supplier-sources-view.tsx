"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SupplierDeliveryNoteFiles, type SupplierDeliveryNoteView } from "@/components/supplier-delivery-note-files";
import { AppSelect } from "@/components/ui/app-select";

type Row = {
  stock_order_item_id: string; quantity: number;
  item: { id: string; line_number: number; item_name: string | null; brand: string | null;
    model: string | null; quality: string | null; received_quantity: number; shipped_quantity: number;
    warehouse_supplier_code: string | null; procurement_cost: number; procurement_cost_confirmed: boolean };
  order: { id: string; order_number: string; warehouse_reference_number: string | null;
    status: string; updated_at: string };
};
type Supplier = { id: string; system_code: string };
type Draft = { row: Row; supplierId: string; noteNumber: string; date: string; quantity: string; unitPrice: string; adjustDetails: boolean };
type BatchDraft = { orderRows: Row[]; selectedIds: string[]; supplierId: string; noteNumber: string;
  date: string; quantities: Record<string, string>; prices: Record<string, string>; confirmed: boolean; adjustDetails: boolean };
type SplitSource = { id: string; row: Row; supplierId: string; noteNumber: string; date: string; quantity: string; unitPrice: string };

export function LegacySupplierSourcesView({ orderId, onUpdated, readOnly = false }: { orderId?: string; onUpdated?: () => void; readOnly?: boolean } = {}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(orderId || null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [batchDraft, setBatchDraft] = useState<BatchDraft | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitSource[] | null>(null);
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
    if (readOnly) return;
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
  }, [readOnly]);

  async function showLinkedNote(stockOrderId: string, noteId: string) {
    const response = await fetch(`/api/stock-orders/${stockOrderId}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    const linked = response?.ok ? (body.delivery_notes as SupplierDeliveryNoteView[] | undefined)?.find((note) => note.id === noteId) : null;
    setNewNote(linked || null);
    setMessage(linked?.attachments?.length ? "已关联已有送货单，照片已存在，无需重复上传。" : linked ? "已关联历史回货，实收数量未增加；请在下方直接上传送货单照片。" : "关联已保存，但送货单详情未能加载；请刷新清单后再核对照片，勿重复上传。");
  }

  async function submit() {
    if (!draft || busy) return;
    if (!draft.supplierId || !draft.noteNumber.trim() || !draft.date || !/^\d+$/.test(draft.quantity)
      || Number(draft.quantity) < 1 || Number(draft.quantity) > draft.row.quantity
      || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(draft.unitPrice)) {
      setError("请核对送货单供应商，填写真实单号、日期、待归属数量及采购单价"); return;
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
    await showLinkedNote(draft.row.order.id, body.data.delivery_note_id);
    setDraft(null);
    await load();
  }

  function openBatch(orderRows: Row[]) {
    setDraft(null); setSplitDraft(null); setNewNote(null); setError(""); setMessage("");
    const codes = [...new Set(orderRows.map((row) => row.item.warehouse_supplier_code).filter(Boolean))];
    const supplierId = codes.length === 1 ? suppliers.find((supplier) => supplier.system_code === codes[0])?.id || "" : "";
    setBatchDraft({ orderRows, selectedIds: orderRows.map((row) => row.stock_order_item_id),
      supplierId, noteNumber: "", date: "",
      quantities: Object.fromEntries(orderRows.map((row) => [row.stock_order_item_id, String(row.quantity)])),
      prices: Object.fromEntries(orderRows.filter((row) => row.item.procurement_cost_confirmed)
        .map((row) => [row.stock_order_item_id, Number(row.item.procurement_cost).toFixed(2)])),
      confirmed: false, adjustDetails: orderRows.some((row) => !row.item.procurement_cost_confirmed) });
  }

  function openSplit(orderRows: Row[]) {
    setDraft(null); setBatchDraft(null); setNewNote(null); setError("");
    setMessage(orderRows.length > 50 ? "单次最多处理 50 条产品；已先载入前 50 条，请保存后继续补录。" : "");
    setSplitDraft(orderRows.slice(0, 50).map((row) => ({
      id: crypto.randomUUID(), row,
      supplierId: suppliers.find((supplier) => supplier.system_code === row.item.warehouse_supplier_code)?.id || "",
      noteNumber: "", date: "", quantity: String(row.quantity),
      unitPrice: row.item.procurement_cost_confirmed ? Number(row.item.procurement_cost).toFixed(2) : "",
    })));
  }

  function updateSplit(id: string, changes: Partial<SplitSource>) {
    setSplitDraft((current) => current?.map((source) => source.id === id ? { ...source, ...changes } : source) || null);
  }

  function addSplitSource(id: string) {
    setSplitDraft((current) => {
      if (!current || current.length >= 50) return current;
      const source = current.find((entry) => entry.id === id);
      if (!source || current.filter((entry) => entry.row.stock_order_item_id === source.row.stock_order_item_id).length >= source.row.quantity) return current;
      const insertAt = current.findLastIndex((entry) => entry.row.stock_order_item_id === source.row.stock_order_item_id) + 1;
      const canMoveOne = Number.isSafeInteger(Number(source.quantity)) && Number(source.quantity) >= 2;
      const next = current.map((entry) => entry.id === id && canMoveOne
        ? { ...entry, quantity: String(Number(entry.quantity) - 1) } : entry);
      next.splice(insertAt, 0, { ...source, id: crypto.randomUUID(), noteNumber: "", quantity: canMoveOne ? "1" : "" });
      return next;
    });
  }

  async function submitSplit() {
    if (!splitDraft?.length || busy) return;
    const pricePattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
    const invalid = splitDraft.some((source) => !source.supplierId || !source.noteNumber.trim()
      || !source.date || !/^\d+$/.test(source.quantity) || Number(source.quantity) < 1
      || !pricePattern.test(source.unitPrice));
    const overflow = splitDraft.some((source) => splitDraft
      .filter((entry) => entry.row.stock_order_item_id === source.row.stock_order_item_id)
      .reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0) > source.row.quantity);
    if (invalid || overflow) {
      setError(overflow ? "同一产品各来源数量合计不能超过待归属数量" : "请逐行核对供应商、送货单、日期、数量和采购价");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    const response = await fetch("/api/stock-orders/legacy-receipt-sources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_stock_updated_at: splitDraft[0].row.order.updated_at,
        split_lines: splitDraft.map((source) => ({ stock_order_item_id: source.row.stock_order_item_id,
          supplier_id: source.supplierId, note_number: source.noteNumber.trim(),
          document_date: source.date, quantity: Number(source.quantity),
          purchase_unit_price_cny: source.unitPrice })) }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "多来源补录失败，所有来源均未保存"); return; }
    setMessage(`已关联 ${body.data?.line_count || splitDraft.length} 条来源；请核对送货单照片。`);
    setSplitDraft(null);
    await load(); onUpdated?.();
  }

  async function submitBatch() {
    if (!batchDraft || busy) return;
    const selected = batchDraft.orderRows.filter((row) => batchDraft.selectedIds.includes(row.stock_order_item_id));
    const pricePattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
    if (!batchDraft.confirmed || !batchDraft.supplierId || !batchDraft.noteNumber.trim() || !batchDraft.date
      || selected.length < 1 || selected.length > 50 || selected.some((row) => {
        const quantity = batchDraft.quantities[row.stock_order_item_id];
        return !/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > row.quantity
          || !pricePattern.test(batchDraft.prices[row.stock_order_item_id] || "");
      })) {
      setError("请选产品并核对供应商、真实送货单号、日期，以及每项数量和采购价后确认"); return;
    }
    setBusy(true); setError(""); setMessage("");
    const response = await fetch("/api/stock-orders/legacy-receipt-sources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier_id: batchDraft.supplierId,
        note_number: batchDraft.noteNumber.trim(), document_date: batchDraft.date,
        expected_stock_updated_at: selected[0].order.updated_at,
        lines: selected.map((row) => ({ stock_order_item_id: row.stock_order_item_id,
          quantity: Number(batchDraft.quantities[row.stock_order_item_id]),
          purchase_unit_price_cny: batchDraft.prices[row.stock_order_item_id] })) }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "批量补录失败，所有产品均未保存，请刷新后核对"); return; }
    await showLinkedNote(selected[0].order.id, body.data.delivery_note_id);
    setBatchDraft(null);
    await load();
  }

  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.order.id, [...(grouped.get(row.order.id) || []), row]);

  return <section id={orderId ? undefined : "legacy-receipt-sources"} className={orderId ? "mt-3" : "mt-5 scroll-mt-5 rounded-xl border border-amber-200 bg-white p-4"} aria-label="历史回货来源待补清单">
    {orderId ? null : <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold text-amber-900">历史回货来源待补 · {count} 张 PI</h2><p className="mt-1 text-xs text-slate-600">仅仓库员可处理。已登记实收但未归属真实送货单的产品才列入；未回货的备货产品无需补录。展开 PI 后按送货单核对供应商代码、单号、日期、数量和采购单价，再上传送货单照片；不会增加库存。</p></div><button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-1.5 text-xs text-blue-700">刷新</button></div>}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
    {newNote ? <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><SupplierDeliveryNoteFiles note={newNote} canUpload onUploaded={() => { setNewNote(null); setMessage("送货单照片已保存，可继续核对其他历史来源。"); void load(); onUpdated?.(); }}/></div> : null}
    <div className="mt-3 space-y-2">{loading ? <p className="p-5 text-center text-sm text-slate-500">加载中…</p> : error ? null : grouped.size ? [...grouped].map(([groupOrderId, orderRows]) => <div key={groupOrderId} className="rounded-lg border text-sm">
      {!orderId ? <div className="flex flex-wrap items-center justify-between gap-3 p-3"><div><Link href={`/stock-orders/${groupOrderId}`} className="font-medium text-blue-700 hover:underline">{orderRows[0].order.warehouse_reference_number || orderRows[0].order.order_number}</Link><span className="ml-3 text-slate-600">待补 {orderRows.length} 项 · {orderRows.reduce((sum, row) => sum + row.quantity, 0)} 件</span></div><button type="button" aria-expanded={expandedOrder === groupOrderId} aria-controls={`legacy-items-${groupOrderId}`} onClick={() => setExpandedOrder((current) => current === groupOrderId ? null : groupOrderId)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">{expandedOrder === groupOrderId ? "收起产品" : "展开补录产品"}</button></div> : <p className="px-3 pt-3 text-xs font-medium text-amber-900">历史实收来源 · 待补 {orderRows.length} 项 / {orderRows.reduce((sum, row) => sum + row.quantity, 0)} 件</p>}
      {(expandedOrder === groupOrderId || Boolean(orderId)) && orderRows.length > 1 && !readOnly ? <div className="flex justify-end gap-2 border-t px-3 pt-3"><button type="button" onClick={() => openBatch(orderRows)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">同送货单批量补录 {orderRows.length} 项</button><button type="button" onClick={() => openSplit(orderRows)} className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-900">多来源批量补录</button></div> : null}
      {(expandedOrder === groupOrderId || Boolean(orderId)) ? <div id={`legacy-items-${groupOrderId}`} className="space-y-2 border-t bg-slate-50/60 p-3">
      {splitDraft?.[0]?.row.order.id === groupOrderId ? <div className="rounded-lg border border-cyan-200 bg-white p-3 text-xs">
        <p className="font-semibold text-cyan-950">多来源补录 · 同一产品可对应多家供应商或多张送货单</p>
        <p className="mt-1 text-slate-600">每条来源最少 1 件；同一产品合计不得超过待归属数量。整批一次提交，任一行失败则全部不保存。</p>
        <div className="mt-3 space-y-2">{splitDraft.map((source) => {
          const sourceRows = splitDraft.filter((entry) => entry.row.stock_order_item_id === source.row.stock_order_item_id);
          const sourceIndex = sourceRows.findIndex((entry) => entry.id === source.id) + 1;
          const allocated = sourceRows.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
          return <div key={source.id} className="rounded-lg border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>第 {source.row.item.line_number} 项 · 来源 {sourceIndex}/{sourceRows.length} · 待归属 {source.row.quantity} 件 · 已分配 {allocated} 件</strong><div className="flex gap-2">{sourceIndex === sourceRows.length && sourceRows.length < source.row.quantity && splitDraft.length < 50 ? <button type="button" onClick={() => addSplitSource(source.id)} className="text-blue-700 hover:underline">＋ 拆分来源</button> : null}{sourceRows.length > 1 ? <button type="button" onClick={() => setSplitDraft((current) => current?.filter((entry) => entry.id !== source.id) || null)} className="text-rose-700 hover:underline">移除此来源</button> : null}</div></div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <label>供应商代码<AppSelect aria-label={`第 ${source.row.item.line_number} 项来源 ${sourceIndex} 供应商`} required forceSearch value={source.supplierId} onChange={(event) => updateSplit(source.id, { supplierId: event.target.value })} className="mt-1 h-9 w-full" placeholderValue=""><option value="">选择供应商</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.system_code}</option>)}</AppSelect></label>
              <label>真实送货单号<input aria-label={`第 ${source.row.item.line_number} 项来源 ${sourceIndex} 送货单号`} required maxLength={100} value={source.noteNumber} onChange={(event) => updateSplit(source.id, { noteNumber: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
              <label>送货单日期<input aria-label={`第 ${source.row.item.line_number} 项来源 ${sourceIndex} 日期`} required type="date" max={new Date().toISOString().slice(0, 10)} value={source.date} onChange={(event) => updateSplit(source.id, { date: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
              <label>归属数量<input aria-label={`第 ${source.row.item.line_number} 项来源 ${sourceIndex} 数量`} required type="number" min={1} max={source.row.quantity} step={1} value={source.quantity} onChange={(event) => updateSplit(source.id, { quantity: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
              <label>采购单价（CNY/件）<input aria-label={`第 ${source.row.item.line_number} 项来源 ${sourceIndex} 采购单价`} required type="number" min={0} step="0.01" value={source.unitPrice} onChange={(event) => updateSplit(source.id, { unitPrice: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
            </div>
          </div>;
        })}</div>
        <div className="mt-3 flex gap-2"><button type="button" disabled={busy || !suppliers.length} onClick={() => void submitSplit()} className="rounded-lg bg-cyan-700 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? "保存中…" : `确认关联 ${splitDraft.length} 条来源`}</button><button type="button" disabled={busy} onClick={() => setSplitDraft(null)} className="rounded-lg border px-4 py-2">取消</button></div>
      </div> : null}
      {batchDraft?.orderRows[0]?.order.id === groupOrderId ? <div className="rounded-lg border border-blue-200 bg-white p-3 text-xs">
        <p className="font-semibold text-blue-900">同一张送货单批量补录 · 任一行失败则全部不保存</p>
        <p className="mt-1 text-slate-600">只勾选属于同一供应商、同一送货单的产品；原回货数量与仓库已确认采购价自动带入，不采用 PI 预估成本。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label>供应商代码（核对原记录）<AppSelect aria-label="批量历史来源供应商" required forceSearch value={batchDraft.supplierId} onChange={(event) => setBatchDraft({ ...batchDraft, supplierId: event.target.value, confirmed: false })} className="mt-1 h-9 w-full" placeholderValue=""><option value="">选择已核对供应商</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.system_code}</option>)}</AppSelect></label>
          <label>真实送货单号<input aria-label="批量历史来源送货单号" maxLength={100} value={batchDraft.noteNumber} onChange={(event) => setBatchDraft({ ...batchDraft, noteNumber: event.target.value, confirmed: false })} className="mt-1 h-9 w-full rounded border px-2"/></label>
          <label>送货单日期<input aria-label="批量历史来源送货单日期" type="date" max={new Date().toISOString().slice(0, 10)} value={batchDraft.date} onChange={(event) => setBatchDraft({ ...batchDraft, date: event.target.value, confirmed: false })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        </div>
        <div className="mt-3 space-y-1.5">{batchDraft.orderRows.map((row) => <div key={row.stock_order_item_id} className={`grid items-center gap-2 rounded border p-2 ${batchDraft.adjustDetails ? "sm:grid-cols-[minmax(0,1fr)_110px_130px]" : "sm:grid-cols-1"}`}>
          <label className="flex min-w-0 items-center gap-2"><input type="checkbox" checked={batchDraft.selectedIds.includes(row.stock_order_item_id)} onChange={(event) => setBatchDraft({ ...batchDraft, selectedIds: event.target.checked ? [...batchDraft.selectedIds, row.stock_order_item_id] : batchDraft.selectedIds.filter((id) => id !== row.stock_order_item_id), confirmed: false })}/><span className="min-w-0 truncate">第 {row.item.line_number} 行 · {[row.item.item_name, row.item.brand, row.item.model].filter(Boolean).join(" / ")} · 已实收待归属 {row.quantity} 件 · {row.item.procurement_cost_confirmed ? `已确认采购价 ¥${Number(row.item.procurement_cost).toFixed(2)}` : "采购价待核"}</span></label>
          {batchDraft.adjustDetails ? <label>本次归属数量<input aria-label={`第 ${row.item.line_number} 行归属数量`} type="number" min={1} max={row.quantity} step={1} disabled={!batchDraft.selectedIds.includes(row.stock_order_item_id)} value={batchDraft.quantities[row.stock_order_item_id] || ""} onChange={(event) => setBatchDraft({ ...batchDraft, quantities: { ...batchDraft.quantities, [row.stock_order_item_id]: event.target.value }, confirmed: false })} className="mt-1 h-8 w-full rounded border px-2"/></label> : null}
          {batchDraft.adjustDetails ? <label>实际采购单价 ¥<input aria-label={`第 ${row.item.line_number} 行实际采购单价`} type="number" min={0} step="0.01" disabled={!batchDraft.selectedIds.includes(row.stock_order_item_id)} value={batchDraft.prices[row.stock_order_item_id] || ""} onChange={(event) => setBatchDraft({ ...batchDraft, prices: { ...batchDraft.prices, [row.stock_order_item_id]: event.target.value }, confirmed: false })} className="mt-1 h-8 w-full rounded border px-2"/></label> : null}
        </div>)}</div>
        {!batchDraft.orderRows.some((row) => !row.item.procurement_cost_confirmed) ? <button type="button" className="mt-2 text-xs text-blue-700 hover:underline" onClick={() => setBatchDraft({ ...batchDraft, adjustDetails: !batchDraft.adjustDetails, confirmed: false })}>{batchDraft.adjustDetails ? "收起数量与价格调整" : "需要拆分数量或更正采购价？"}</button> : null}
        <label className="mt-3 flex items-center gap-2 text-slate-700"><input type="checkbox" checked={batchDraft.confirmed} onChange={(event) => setBatchDraft({ ...batchDraft, confirmed: event.target.checked })}/>我已按送货单核对所选产品、数量和采购单价</label>
        <div className="mt-3 flex gap-2"><button type="button" disabled={busy || !suppliers.length} onClick={() => void submitBatch()} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? "保存中…" : "批量确认关联"}</button><button type="button" disabled={busy} onClick={() => setBatchDraft(null)} className="rounded-lg border px-4 py-2">取消</button></div>
      </div> : null}
      {orderRows.sort((a, b) => a.item.line_number - b.item.line_number).map((row) => <div key={row.stock_order_item_id} className="rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium">第 {row.item.line_number} 行 · {[row.item.item_name, row.item.brand, row.item.model, row.item.quality].filter(Boolean).join(" / ") || "产品项"}</span><small className="ml-2 text-amber-800">待归属 {row.quantity} 件 · 已实收 {row.item.received_quantity} 件</small></div>{readOnly ? <span className="text-xs text-slate-600">请仓库员核对并补录</span> : <div className="flex gap-2"><button type="button" onClick={() => { setError(""); setNewNote(null); setBatchDraft(null); setSplitDraft(null); setDraft({ row, supplierId: suppliers.find((supplier) => supplier.system_code === row.item.warehouse_supplier_code)?.id || "", noteNumber: "", date: "", quantity: String(row.quantity), unitPrice: row.item.procurement_cost_confirmed ? Number(row.item.procurement_cost).toFixed(2) : "", adjustDetails: !row.item.procurement_cost_confirmed }); }} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">单项补充</button>{row.quantity > 1 ? <button type="button" onClick={() => openSplit([row])} className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-900">拆分来源</button> : null}</div>}</div>
      {draft?.row.stock_order_item_id === row.stock_order_item_id ? <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs">供应商代码<AppSelect aria-label="历史来源供应商" required forceSearch value={draft.supplierId} onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })} className="mt-1 h-9 w-full" placeholderValue=""><option value="">选择已核对供应商</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.system_code}</option>)}</AppSelect></label>
        <label className="text-xs">真实送货单号<input aria-label="历史来源送货单号" required maxLength={100} value={draft.noteNumber} onChange={(event) => setDraft({ ...draft, noteNumber: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        <label className="text-xs">送货单日期<input aria-label="历史来源送货单日期" required type="date" max={new Date().toISOString().slice(0, 10)} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label>
        {draft.adjustDetails ? <label className="text-xs">本次归属数量（最多 {row.quantity}）<input aria-label="历史来源数量" required type="number" min={1} max={row.quantity} step={1} value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label> : null}
        {draft.adjustDetails ? <label className="text-xs">实际采购单价 ¥<input aria-label="历史来源采购单价" required type="number" min={0} step="0.01" value={draft.unitPrice} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} className="mt-1 h-9 w-full rounded border px-2"/></label> : null}
        {!draft.adjustDetails ? <div className="self-end text-xs text-slate-600">已实收待归属 {row.quantity} 件 · 仓库已确认采购价 ¥{Number(row.item.procurement_cost).toFixed(2)}<button type="button" className="ml-2 text-blue-700 hover:underline" onClick={() => setDraft({ ...draft, adjustDetails: true })}>{row.quantity > 1 ? "调整本次数量或更正价格" : "更正价格"}</button></div> : null}
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-5"><button type="button" disabled={busy || !suppliers.length} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "保存中…" : "确认关联，不增加回货数量"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)} className="rounded-lg border px-4 py-2 text-xs">取消</button></div>
      </div> : null}
    </div>)}</div> : null}</div>) : <p className="p-5 text-center text-sm text-emerald-700">历史回货来源已补齐</p>}</div>
    {orderId ? null : <div className="mt-3 flex items-center justify-end gap-3 text-sm"><span>共 {count} 张 PI</span><button type="button" disabled={page <= 1 || loading} onClick={() => { setExpandedOrder(null); setPage(page - 1); }} className="rounded border px-3 py-1 disabled:opacity-40">上一页</button><span>{page}</span><button type="button" disabled={page * 50 >= count || loading} onClick={() => { setExpandedOrder(null); setPage(page + 1); }} className="rounded border px-3 py-1 disabled:opacity-40">下一页</button></div>}
  </section>;
}
