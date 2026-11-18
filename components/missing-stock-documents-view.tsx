"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { LegacySupplierSourcesView } from "@/components/legacy-supplier-sources-view";
import { SupplierDeliveryNoteFiles, type SupplierDeliveryNoteView } from "@/components/supplier-delivery-note-files";

type DocumentRow = { stock_order_id: string; order_number: string; missing_number_count: number; missing_image_count: number; missing_photo_note_numbers?: string[]; pending_note_number_count?: number; pending_note_photo_count?: number; unlinked_shipped_item_count?: number };
type LegacyRow = { order: { id: string; order_number: string; warehouse_reference_number: string | null }; stock_order_item_id: string };
type QueueRow = DocumentRow & { legacy_count: number };
type OrderDetail = { delivery_notes?: SupplierDeliveryNoteView[]; can_upload_delivery_note_files?: boolean };

async function fetchAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 2000; page++) {
    const response = await fetch(`${path}?page=${page}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "补录清单加载失败");
    rows.push(...(body.data || []));
    if (page * 50 >= Number(body.count || 0)) return rows;
  }
  throw new Error("补录清单超过分页上限，请联系管理员");
}

export function MissingStockDocumentsView({ showLegacySources = false }: { showLegacySources?: boolean }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [documents, legacy] = await Promise.all([
        fetchAll<DocumentRow>("/api/stock-orders/missing-documents"),
        showLegacySources ? fetchAll<LegacyRow>("/api/stock-orders/legacy-receipt-sources") : Promise.resolve([]),
      ]);
      const byOrder = new Map<string, QueueRow>();
      for (const row of documents) byOrder.set(row.stock_order_id, { ...row, legacy_count: 0 });
      for (const row of legacy) {
        const existing = byOrder.get(row.order.id);
        if (existing) existing.legacy_count += 1;
        else byOrder.set(row.order.id, { stock_order_id: row.order.id, order_number: row.order.warehouse_reference_number || row.order.order_number,
          missing_number_count: 0, missing_image_count: 0, legacy_count: 1 });
      }
      setRows([...byOrder.values()].sort((a, b) => a.order_number.localeCompare(b.order_number, "zh-CN")));
      setPage((current) => Math.max(1, Math.min(current, Math.ceil(byOrder.size / 50))));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "补录清单加载失败"); }
    finally { setLoading(false); }
  }, [showLegacySources]);

  const loadDetail = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    setDetailLoading(true); setDetailError("");
    const response = await fetch(`/api/stock-orders/${id}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (request !== detailRequest.current) return;
    if (!response?.ok) { setDetail(null); setDetailError(body.error || "送货单详情加载失败"); }
    else setDetail(body);
    setDetailLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (expanded) void loadDetail(expanded); }, [expanded, loadDetail]);
  useEffect(() => { if (expanded && !loading && !rows.some((row) => row.stock_order_id === expanded)) setExpanded(null); }, [expanded, loading, rows]);
  const visible = rows.slice((page - 1) * 50, page * 50);

  return <main className="mx-auto max-w-7xl p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">待补录清单</h1>
        <p className="mt-1 text-sm text-slate-600">每张 PI 合并一行；展开后直接补送货单号、送货单照片及历史实收来源。历史来源关联不重复增加回货数量。</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-2 text-sm text-blue-700">刷新清单</button>
        <Link href="/stock-orders" className="rounded-lg border px-3 py-2 text-sm text-blue-700">返回备货单</Link>
      </div>
    </div>
    {error ? <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p> : null}
    <div className="mt-5 overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[650px] text-left text-sm">
        <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">PI / 备货单号</th><th>待补事项</th><th className="w-36">操作</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={3} className="p-8 text-center">加载中…</td></tr> : visible.length ? visible.map((row) => <Fragment key={row.stock_order_id}>
            <tr className="border-t">
              <td className="p-3 font-medium"><Link href={`/stock-orders/${row.stock_order_id}`} target="_blank" rel="noopener noreferrer" aria-label={`新页签查看备货单 ${row.order_number}`} className="text-blue-700 hover:underline">{row.order_number}</Link></td>
              <td className="py-3"><div className="flex flex-wrap gap-1.5">
                {row.pending_note_number_count ? <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">送货单号待补 {row.pending_note_number_count} 张</span> : null}
                {row.pending_note_photo_count ? <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">待补单号的送货单缺照片 {row.pending_note_photo_count} 张</span> : null}
                {row.legacy_count > 0 ? <span className="rounded bg-rose-50 px-2 py-1 text-rose-800">历史回货来源待归属 {row.legacy_count} 项</span> : row.unlinked_shipped_item_count ? <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">待核送货单来源 {row.unlinked_shipped_item_count} 项</span> : null}
                {row.missing_photo_note_numbers?.length ? <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">送货单 {row.missing_photo_note_numbers.join("、")} 缺照片</span> : null}
              </div></td>
              <td className="py-3"><button type="button" aria-expanded={expanded === row.stock_order_id} aria-controls={`remediation-${row.stock_order_id}`} onClick={() => { setDetail(null); setExpanded((value) => value === row.stock_order_id ? null : row.stock_order_id); }} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-800">{expanded === row.stock_order_id ? "收起" : "展开补录"}</button></td>
            </tr>
            {expanded === row.stock_order_id ? <tr><td colSpan={3} className="border-t bg-slate-50 p-3 sm:p-4"><div id={`remediation-${row.stock_order_id}`} className="space-y-3">
              {detailLoading ? <p>加载送货单…</p> : detailError ? <p role="alert" className="text-rose-700">{detailError}</p> : <>
                {detail?.delivery_notes?.some((note) => note.number_pending || !note.attachments.length) ? <div><p className="mb-2 font-medium">关联送货单 · 直接补单号与照片</p><div className="grid gap-2 lg:grid-cols-2">
                  {detail.delivery_notes.filter((note) => note.number_pending || !note.attachments.length).map((note) => <SupplierDeliveryNoteFiles key={note.id} note={note} canUpload={detail.can_upload_delivery_note_files} onUploaded={() => { void loadDetail(row.stock_order_id); void load(); }}/>)}
                </div></div> : row.legacy_count > 0 ? <p className="text-amber-800">请在下方按产品核对供应商、真实送货单号和采购价；关联后可直接上传照片。</p> : row.missing_number_count || row.missing_image_count ? <p className="text-amber-800">尚无可补录的关联送货单或历史实收来源，请打开备货单核对回货记录。</p> : null}
              </>}
              {showLegacySources && row.legacy_count > 0 ? <LegacySupplierSourcesView orderId={row.stock_order_id} onUpdated={() => { void load(); void loadDetail(row.stock_order_id); }}/> : null}
              <Link href={`/stock-orders/${row.stock_order_id}`} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-blue-700 hover:underline">查看完整备货单</Link>
            </div></td></tr> : null}
          </Fragment>) : <tr><td colSpan={3} className="p-8 text-center text-emerald-700">当前没有待补录事项</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="mt-3 flex items-center justify-end gap-3 text-sm">
      <span>共 {rows.length} 张 PI</span>
      <button type="button" disabled={page <= 1 || loading} onClick={() => { setExpanded(null); setPage(page - 1); }} className="rounded border px-3 py-1 disabled:opacity-40">上一页</button>
      <span>{page}</span>
      <button type="button" disabled={page * 50 >= rows.length || loading} onClick={() => { setExpanded(null); setPage(page + 1); }} className="rounded border px-3 py-1 disabled:opacity-40">下一页</button>
    </div>
  </main>;
}
