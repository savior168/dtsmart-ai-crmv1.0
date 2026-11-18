"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, LoaderCircle, RefreshCw, ShoppingCart } from "lucide-react";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/types";

type RecentOrder = { id: string; order_number: string; warehouse_reference_number: string | null; customer_short_name: string | null; status: SalesOrderStatus; updated_at: string };
type Overview = { counts: { draft: number; waiting: number; active: number; shipped: number }; recent: RecentOrder[]; scope: "ALL_AUTHORIZED_PI" | "OWN_SCOPE" };

export function OrderClerkDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/dashboard/order-clerk", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.counts || !Array.isArray(body.recent)) throw new Error(body.error || "跟单工作台加载失败");
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "跟单工作台加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const cards = data ? [
    ["PI 草稿", data.counts.draft, "DRAFT"],
    ["待仓库接单", data.counts.waiting, "WAITING_STOCK"],
    ["备货处理中", data.counts.active, "ACTIVE"],
    ["已交货代", data.counts.shipped, "SHIPPED"],
  ] as const : [];
  return <main className="dashboard-page min-h-[calc(100vh-64px)] bg-[#f8fafc] px-4 py-4 xl:px-5"><div className="mx-auto max-w-[1660px]">
    <section className="mb-4 flex flex-wrap items-center gap-3"><span className="rounded-lg border bg-white px-4 py-2.5 text-sm text-slate-600 shadow-sm">统计范围：全部日期 · {data?.scope === "ALL_AUTHORIZED_PI" ? "全部已授权 PI" : "本人可查看的 PI"}</span><button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-500 bg-white px-5 text-sm font-medium text-blue-600"><RefreshCw size={16}/>重置／刷新</button><Link href="/orders" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm text-slate-700"><ClipboardList size={16}/>PI 订单</Link><Link href="/stock-orders" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm text-slate-700"><ShoppingCart size={16}/>备货进度</Link></section>
    {error ? <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}。{data ? "以下保留上次成功加载的数据。" : "请稍后重试。"}</p> : null}
    {loading && !data ? <div className="mt-5 grid min-h-52 place-items-center rounded-xl border bg-white"><LoaderCircle className="animate-spin text-blue-600" aria-label="加载中"/></div> : data ? <>
      <section className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-600">业务快照</p><h1 className="mt-1 text-[17px] font-semibold">PI 跟单</h1><p className="mt-1 text-xs text-slate-500">按权限范围统计当前单据状态；与日期筛选无关，点击指标查看明细。</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.slice(0, 3).map(([label, count, status]) => <Link key={status} href={`/orders?status=${status}`} className="rounded-xl border border-blue-100 bg-blue-50/60 p-4"><small className="text-slate-500">{label}</small><b className="mt-2 block text-2xl text-slate-900">{count}</b></Link>)}</div></section>
      <section className="mt-4"><div className="mb-2"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">运营概览</p><h2 className="mt-1 text-[15px] font-semibold">制单与备货行动</h2></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Link href="/orders?status=WAITING_STOCK" className="min-h-[110px] rounded-xl border bg-white p-4 shadow-sm"><small>待仓库接单</small><b className="mt-2 block text-2xl">{data.counts.waiting}</b></Link><Link href="/orders?status=ACTIVE" className="min-h-[110px] rounded-xl border bg-white p-4 shadow-sm"><small>备货处理中</small><b className="mt-2 block text-2xl">{data.counts.active}</b></Link><Link href="/notifications?status=pending" className="min-h-[110px] rounded-xl border bg-white p-4 shadow-sm"><small>紧急待办</small><b className="mt-2 block text-sm text-blue-600">查看通知与变更</b></Link></div></section>
      <details open className="mt-4 rounded-xl border bg-white p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">PI 订单阶段指标</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, count, status]) => <Link key={status} href={`/orders?status=${status}`} className="rounded-lg border p-3 hover:border-blue-300"><small className="text-slate-500">{label}</small><b className="mt-2 block text-xl">{count}</b></Link>)}</div></details>
      <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-4"><h2 className="flex items-center gap-2 font-semibold"><ClipboardList size={19} className="text-blue-600"/>最近更新的 PI</h2><Link href="/orders" className="text-sm text-blue-600">查看全部</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["PI 编号", "客户", "状态", "最后更新", "操作"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{data.recent.map(order => <tr key={order.id} className="border-t"><td className="px-4 py-3 font-medium">{order.warehouse_reference_number || order.order_number}</td><td className="px-4 py-3">{order.customer_short_name || "未填写"}</td><td className="px-4 py-3">{SALES_ORDER_STATUS_LABELS[order.status] || order.status}</td><td className="px-4 py-3 text-slate-500">{new Date(order.updated_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><Link href={`/orders/${order.id}`} className="text-blue-600">查看订单</Link></td></tr>)}</tbody></table>{!data.recent.length ? <p className="p-10 text-center text-sm text-slate-400">暂无 PI 订单</p> : null}</div></section>
    </> : null}
  </div></main>;
}
