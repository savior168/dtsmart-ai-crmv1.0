"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SALES_ORDER_STATUS_LABELS, STOCK_STATUS_LABELS } from "@/lib/types";

type Row = { id: string; warehouse_reference_number?: string | null; stock_number?: string | null; customer_name?: string | null; customer_short_name?: string | null; status: string };
type Result = { count: number; data: Row[] };
type Key = "allPi" | "ownPi" | "draftPi" | "allStock" | "waiting" | "active" | "shortage" | "shipped";
type Props = { role: "ORDER_CLERK" | "WAREHOUSE"; userId: string; canViewOrders: boolean; canFilterCreator: boolean; canViewStock: boolean; report?: boolean };

function listHref(path: "/orders" | "/stock-orders", from: string, to: string, filters: Record<string, string> = {}) {
  const query = new URLSearchParams();
  if (from) query.set("date_from", from);
  if (to) query.set("date_to", to);
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.size ? `${path}?${query}` : path;
}

export function OperationsOverview({ role, userId, canViewOrders, canFilterCreator, canViewStock, report = false }: Props) {
  const warehouse = role === "WAREHOUSE";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [results, setResults] = useState<Partial<Record<Key, Result>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (from && to && from > to) {
      setError("开始日期不能晚于结束日期");
      setResults({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const range = new URLSearchParams({ page_size: "10", sort_by: "created_at", sort_dir: "desc" });
    if (from) range.set("date_from", from);
    if (to) range.set("date_to", to);
    const request = async (path: string, filters: Record<string, string> = {}): Promise<Result> => {
      const query = new URLSearchParams(range);
      for (const [key, value] of Object.entries(filters)) query.set(key, value);
      const response = await fetch(`${path}?${query}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "数据加载失败");
      return { count: Number(body.count || 0), data: Array.isArray(body.data) ? body.data : [] };
    };
    try {
      const jobs: Array<Promise<[Key, Result]>> = [];
      const add = (key: Key, path: string, filters: Record<string, string> = {}) =>
        jobs.push(request(path, filters).then((data) => [key, data]));
      if (!warehouse && canViewOrders) {
        add("allPi", "/api/orders", { type: "PI" });
        if (canFilterCreator) {
          add("ownPi", "/api/orders", { type: "PI", creator_id: userId });
          add("draftPi", "/api/orders", { type: "PI", creator_id: userId, status: "DRAFT" });
        }
      }
      if (canViewStock) {
        add("allStock", "/api/stock-orders");
        add("waiting", "/api/stock-orders", { status: "WAITING" });
        add("active", "/api/stock-orders", { status: "ACTIVE" });
        add("shortage", "/api/stock-orders", { status: "SHORTAGE" });
        add("shipped", "/api/stock-orders", { status: "SHIPPED" });
      }
      const entries = await Promise.all(jobs);
      if (!signal?.aborted) setResults(Object.fromEntries(entries));
    } catch (cause) {
      if (!signal?.aborted) {
        setResults({});
        setError(cause instanceof Error ? cause.message : "数据加载失败");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [from, to, userId, warehouse, canViewOrders, canFilterCreator, canViewStock]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reportCards: Array<{ key: Key; label: string; href: string; hint: string }> = [
    ...(!warehouse && canViewOrders ? [
      { key: "allPi" as const, label: "可查看 PI", href: listHref("/orders", from, to), hint: "权限范围内全部制单人" },
      ...(canFilterCreator ? [
        { key: "ownPi" as const, label: "本人制作 PI", href: listHref("/orders", from, to, { creator_id: userId }), hint: "只按制单人统计" },
        { key: "draftPi" as const, label: "本人待提交草稿", href: listHref("/orders", from, to, { creator_id: userId, status: "DRAFT" }), hint: "仅本人制作的草稿" },
      ] : []),
    ] : []),
    ...(canViewStock ? [
      { key: "allStock" as const, label: "可查看备货单", href: listHref("/stock-orders", from, to), hint: "权限范围内全部状态" },
      { key: "waiting" as const, label: "待仓库接单", href: listHref("/stock-orders", from, to, { status: "WAITING" }), hint: "当前待接单" },
      { key: "active" as const, label: "采购／理货／待交货代", href: listHref("/stock-orders", from, to, { status: "ACTIVE" }), hint: "当前执行中" },
      { key: "shortage" as const, label: "缺货异常", href: listHref("/stock-orders", from, to, { status: "SHORTAGE" }), hint: "当前缺货异常" },
      { key: "shipped" as const, label: "已交货代", href: listHref("/stock-orders", from, to, { status: "SHIPPED" }), hint: "当前已交货代" },
    ] : []),
  ];
  const workCards = reportCards.filter((card) => warehouse
    ? ["waiting", "active", "shortage"].includes(card.key)
    : [canFilterCreator ? "draftPi" : "allPi", "waiting", "active", "shortage"].includes(card.key));
  const cards = report ? [] : workCards;
  const stockTotal = results.allStock?.count || 0;
  const stockBreakdown = reportCards.filter((card) => ["waiting", "active", "shortage", "shipped"].includes(card.key));
  const piTotal = results.allPi?.count || 0;
  const ownPi = results.ownPi?.count || 0;
  const shipped = results.shipped?.count || 0;
  const shortage = results.shortage?.count || 0;
  const shippedRate = stockTotal ? Math.round(shipped / stockTotal * 100) : 0;
  const shortageRate = stockTotal ? Math.round(shortage / stockTotal * 100) : 0;
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1400px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">{report ? warehouse ? "备货业务报表" : "PI 跟单报表" : warehouse ? "采购备货工作台" : "PI 跟单工作台"}</h1><p className="mt-1 text-sm text-slate-600">{report ? "按创建日期回看权限范围内的单据规模与当前状态分布；不包含销售金额或利润。" : warehouse ? "优先处理接单、采购、理货和异常；不展示客户联系方式、销售价格和利润。" : "优先处理本人待提交草稿及待接单、执行中、异常备货；查看范围不代表可修改他人单据。"}</p></div><button type="button" onClick={() => void load()} className="rounded-lg border bg-white px-4 py-2 text-sm hover:border-blue-300">刷新</button></header>
    {report ? <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 text-sm"><label>创建开始日期<input className="mt-1 block rounded border px-3 py-2" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>创建结束日期<input className="mt-1 block rounded border px-3 py-2" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><span className="pb-2 text-slate-500">按单据创建日期筛选，显示这些单据的当前状态；点击数字进入相同筛选范围。</span></section> : null}
    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p> : null}
    {!report && !cards.length ? <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">当前未开通该岗位的业务数据页面。请联系系统管理员配置权限。</p> : null}
    {!report ? <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <Link key={card.key} href={card.href} className="rounded-xl border bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"><p className="text-sm text-slate-600">{card.label}</p><p className="mt-2 text-3xl font-semibold text-blue-700">{loading || error ? "…" : results[card.key]?.count ?? "—"}</p><p className="mt-2 text-xs text-slate-500">{card.hint} · 点击查看明细</p></Link>)}</section> : null}
    {report ? <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="岗位业务报表核心指标">
      {!warehouse && canViewOrders ? <Link href={listHref("/orders", from, to, { type: "PI" })} className="rounded-xl border bg-white p-5 hover:border-blue-300"><small className="text-slate-500">期间可见 PI</small><b className="mt-2 block text-3xl text-blue-700">{loading || error ? "…" : piTotal}</b><span className="mt-2 block text-xs text-slate-500">按制单日期 · 查看同口径明细</span></Link> : null}
      {!warehouse && canViewOrders && canFilterCreator ? <Link href={listHref("/orders", from, to, { type: "PI", creator_id: userId })} className="rounded-xl border bg-white p-5 hover:border-blue-300"><small className="text-slate-500">本人制作占可见 PI</small><b className="mt-2 block text-3xl text-indigo-700">{loading || error ? "…" : `${piTotal ? Math.round(ownPi / piTotal * 100) : 0}%`}</b><span className="mt-2 block text-xs text-slate-500">{ownPi} / {piTotal} 张 · 查看本人明细</span></Link> : null}
      {canViewStock ? <Link href={listHref("/stock-orders", from, to)} className="rounded-xl border bg-white p-5 hover:border-blue-300"><small className="text-slate-500">期间可见备货单</small><b className="mt-2 block text-3xl text-blue-700">{loading || error ? "…" : stockTotal}</b><span className="mt-2 block text-xs text-slate-500">按创建日期 · 查看同口径明细</span></Link> : null}
      {canViewStock ? <Link href={listHref("/stock-orders", from, to, { status: "SHIPPED" })} className="rounded-xl border bg-white p-5 hover:border-blue-300"><small className="text-slate-500">已交货代占比</small><b className="mt-2 block text-3xl text-emerald-700">{loading || error ? "…" : `${shippedRate}%`}</b><span className="mt-2 block text-xs text-slate-500">{shipped} / {stockTotal} 张 · 查看明细</span></Link> : null}
      {canViewStock ? <Link href={listHref("/stock-orders", from, to, { status: "SHORTAGE" })} className="rounded-xl border bg-white p-5 hover:border-blue-300"><small className="text-slate-500">缺货异常占比</small><b className="mt-2 block text-3xl text-rose-700">{loading || error ? "…" : `${shortageRate}%`}</b><span className="mt-2 block text-xs text-slate-500">{shortage} / {stockTotal} 张 · 查看明细</span></Link> : null}
    </section> : null}
    {report && canViewStock ? <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">备货状态分布</h2><p className="mt-1 text-xs text-slate-500">所选期间创建的 {stockTotal} 张备货单，按当前状态分组；点击分类可核对同范围明细。</p><div className="mt-4 grid items-center gap-8 md:grid-cols-[180px_1fr]"><div className="mx-auto grid h-44 w-44 place-items-center rounded-full" role="img" aria-label={`备货状态占比：已交货代 ${shippedRate}%，缺货异常 ${shortageRate}%`} style={{ background: `conic-gradient(#10b981 0 ${shippedRate}%, #ef4444 ${shippedRate}% ${shippedRate + shortageRate}%, #e2e8f0 ${shippedRate + shortageRate}% 100%)` }}><div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center"><span className="text-xs text-slate-500">期间备货单<strong className="block text-3xl text-slate-900">{stockTotal}</strong></span></div></div><div className="space-y-3">{stockBreakdown.map((card) => { const count = results[card.key]?.count || 0; const percent = stockTotal ? Math.round(count / stockTotal * 100) : 0; return <Link key={card.key} href={card.href} className="grid grid-cols-[minmax(110px,180px)_1fr_72px] items-center gap-3 rounded-lg p-2 text-sm hover:bg-blue-50"><span className="truncate">{card.label}</span><span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} /></span><span className="text-right tabular-nums">{count} · {percent}%</span></Link>; })}</div></div></section> : null}
    {report && !warehouse && canViewOrders && canFilterCreator ? <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">PI 制单构成</h2><p className="mt-1 text-xs text-slate-500">本人制作按制单人统计，待提交草稿是本人制作中的一部分；下方占比不是相加指标。</p><div className="mt-5 space-y-5"><div><div className="mb-2 flex justify-between text-sm"><span>本人制作 / 其他可见 PI</span><span>{ownPi} / {Math.max(0, piTotal - ownPi)}</span></div><div className="flex h-5 overflow-hidden rounded-full bg-slate-100"><span className="bg-indigo-500" style={{ width: `${piTotal ? ownPi / piTotal * 100 : 0}%` }} /><span className="bg-slate-300" style={{ width: `${piTotal ? Math.max(0, piTotal - ownPi) / piTotal * 100 : 100}%` }} /></div><Link href={listHref("/orders", from, to, { type: "PI", creator_id: userId })} className="mt-1 block text-xs text-blue-700">查看本人制作明细 →</Link></div><div><div className="mb-2 flex justify-between text-sm"><span>本人待提交草稿 / 本人其他 PI</span><span>{results.draftPi?.count || 0} / {Math.max(0, ownPi - (results.draftPi?.count || 0))}</span></div><div className="flex h-5 overflow-hidden rounded-full bg-slate-100"><span className="bg-amber-400" style={{ width: `${ownPi ? (results.draftPi?.count || 0) / ownPi * 100 : 0}%` }} /><span className="bg-blue-300" style={{ width: `${ownPi ? Math.max(0, ownPi - (results.draftPi?.count || 0)) / ownPi * 100 : 100}%` }} /></div><Link href={listHref("/orders", from, to, { type: "PI", creator_id: userId, status: "DRAFT" })} className="mt-1 block text-xs text-blue-700">查看待提交草稿明细 →</Link></div></div></section> : null}
    {!report ? <div className="grid gap-4 lg:grid-cols-2">
      {!warehouse && canViewOrders ? <section className="rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><h2 className="font-semibold">近期 PI</h2><Link href={listHref("/orders", from, to)} className="text-sm text-blue-700">查看全部</Link></div><div className="mt-3 divide-y">{results.allPi?.data.map((row) => <Link key={row.id} href={`/orders/${row.id}`} className="flex justify-between gap-3 py-3 text-sm hover:text-blue-700"><span>{row.warehouse_reference_number || "未编号"} · {row.customer_name || row.customer_short_name || "客户"}</span><span className="shrink-0 text-slate-500">{SALES_ORDER_STATUS_LABELS[row.status as keyof typeof SALES_ORDER_STATUS_LABELS] || row.status}</span></Link>)}{!loading && !results.allPi?.data.length ? <p className="py-4 text-sm text-slate-500">暂无 PI</p> : null}</div></section> : null}
      {canViewStock ? <section className="rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><h2 className="font-semibold">近期备货</h2><Link href={listHref("/stock-orders", from, to)} className="text-sm text-blue-700">查看全部</Link></div><div className="mt-3 divide-y">{results.allStock?.data.map((row) => <Link key={row.id} href={`/stock-orders/${row.id}`} className="flex justify-between gap-3 py-3 text-sm hover:text-blue-700"><span>{row.stock_number || "未编号"} · {warehouse ? "备货单" : row.customer_name || row.customer_short_name || "客户"}</span><span className="shrink-0 text-slate-500">{STOCK_STATUS_LABELS[row.status as keyof typeof STOCK_STATUS_LABELS] || row.status}</span></Link>)}{!loading && !results.allStock?.data.length ? <p className="py-4 text-sm text-slate-500">暂无备货单</p> : null}</div></section> : null}
    </div> : null}
  </div></main>;
}
