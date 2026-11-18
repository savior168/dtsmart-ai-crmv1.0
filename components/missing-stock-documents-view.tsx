"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LegacySupplierSourcesView } from "@/components/legacy-supplier-sources-view";

type Row = { stock_order_id: string; order_number: string; missing_number_count: number; missing_image_count: number };

export function MissingStockDocumentsView({ showLegacySources = false }: { showLegacySources?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/stock-orders/missing-documents?page=${page}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setLoading(false);
    if (!response?.ok) { setRows([]); setError(body.error || "待补清单加载失败"); return; }
    setRows(body.data || []); setCount(Number(body.count || 0)); setError("");
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  return <main className="mx-auto max-w-7xl p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">待补送货单与历史回货来源</h1><p className="mt-1 text-sm text-slate-600">已交货代的 PI 逐笔核对真实送货单号及纸单照片；已登记实收但缺来源的产品须核实后关联纸单，不重复登记回货。</p><div className="mt-3 flex flex-wrap gap-2 text-sm"><a href="#missing-delivery-documents" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-800">待补送货单凭证</a>{showLegacySources ? <a href="#legacy-receipt-sources" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">历史回货来源待补</a> : null}</div></div><Link href="/stock-orders" className="rounded-lg border px-3 py-2 text-sm text-blue-700">返回备货单</Link></div>
    {error ? <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p> : null}
    <div id="missing-delivery-documents" className="mt-5 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">PI / 备货单号</th><th>待补单号来源</th><th>待补纸单照片来源</th><th>操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={4} className="p-8 text-center">加载中…</td></tr> : rows.length ? rows.map((row) => <tr key={row.stock_order_id} className="border-t"><td className="p-3 font-medium">{row.order_number}</td><td>{row.missing_number_count}</td><td>{row.missing_image_count}</td><td><Link href={`/stock-orders/${row.stock_order_id}`} className="text-blue-700 hover:underline">查看并补齐</Link></td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">当前没有待补凭证</td></tr>}</tbody></table></div>
    <div className="mt-3 flex items-center justify-end gap-3 text-sm"><span>共 {count} 张订单</span><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">上一页</button><span>{page}</span><button type="button" disabled={page * 50 >= count || loading} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">下一页</button></div>
    {showLegacySources ? <LegacySupplierSourcesView /> : null}
  </main>;
}
