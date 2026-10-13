"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Boxes, LoaderCircle, RefreshCw } from "lucide-react";
import { STOCK_STATUS_LABELS, type StockOrderStatus } from "@/lib/types";

type Order = { id: string; stock_number: string; order_number: string; customer_short_name: string; status: StockOrderStatus; stocking_requirements: string | null; status_note: string | null; updated_at: string; sales?: { name: string | null; email: string } | null };
type Payload = { counts: Record<StockOrderStatus, number>; recent: Order[] };
const cardStatuses: StockOrderStatus[] = ["WAITING", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED", "SHORTAGE", "READY"];

export function WarehouseDashboard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/stock-orders?view=dashboard", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "备货工作台加载失败");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "备货工作台加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">采购备货工作台</h1><p className="mt-1 text-sm text-slate-500">只展示仓库必要数据；不显示客户联系方式、销售价格和利润。</p></div><button onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"><RefreshCw size={16}/>刷新</button></header>
    {error ? <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
    {loading ? <div className="grid min-h-72 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div> : data ? <>
      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cardStatuses.map((status) => <Link key={status} href={`/stock-orders?status=${status}`} className="rounded-xl border bg-white p-5 shadow-sm transition hover:border-blue-300"><small className="text-slate-500">{STOCK_STATUS_LABELS[status]}</small><b className="mt-2 block text-3xl">{data.counts[status] || 0}</b></Link>)}</section>
      <section className="mt-5 overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-4"><h2 className="flex items-center gap-2 font-semibold"><Boxes className="text-blue-600" size={19}/>最近更新的备货单</h2><Link href="/stock-orders" className="text-sm text-blue-600">查看全部</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50"><tr>{["备货编号", "订单编号", "客户简称", "销售员", "状态", "备货要求/说明", "更新时间", "操作"].map((head) => <th key={head} className="px-4 py-3 font-medium">{head}</th>)}</tr></thead><tbody>{data.recent.map((order) => <tr key={order.id} className="border-t"><td className="px-4 py-3 font-medium text-blue-700">{order.stock_number}</td><td className="px-4 py-3">{order.order_number}</td><td className="max-w-52 truncate px-4 py-3">{order.customer_short_name}</td><td className="px-4 py-3">{order.sales?.name || order.sales?.email || "-"}</td><td className="px-4 py-3">{STOCK_STATUS_LABELS[order.status]}</td><td className="max-w-72 px-4 py-3"><p className="line-clamp-2">{order.status_note || order.stocking_requirements || "-"}</p></td><td className="px-4 py-3 text-slate-500">{new Date(order.updated_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><Link href={`/stock-orders/${order.id}`} className="text-blue-600">处理</Link></td></tr>)}</tbody></table>{!data.recent.length ? <div className="p-12 text-center text-slate-400">暂无备货单</div> : null}</div></section>
    </> : null}
  </div></main>;
}
