"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, LoaderCircle, Medal } from "lucide-react";
import type { SalesMetrics, SalesRankingRow } from "@/lib/reports/sales";

type Report = { profile: { role: string }; range: { from: string; to: string }; totals: SalesMetrics; ranking: SalesRankingRow[] };
type Preset = "today" | "week" | "month" | "custom";
const pad = (value: number) => String(value).padStart(2, "0");
const inputDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function presetRange(preset: Exclude<Preset, "custom">) {
  const end = new Date(), start = new Date(end);
  if (preset === "today") start.setHours(0, 0, 0, 0);
  if (preset === "week") { const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day); start.setHours(0, 0, 0, 0); }
  if (preset === "month") { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return { from: start.toISOString(), to: end.toISOString(), fromInput: inputDate(start), toInput: inputDate(end) };
}

export function SalesReportsView() {
  const initial = presetRange("month");
  const [preset, setPreset] = useState<Preset>("month"), [fromDate, setFromDate] = useState(initial.fromInput), [toDate, setToDate] = useState(initial.toInput), [report, setReport] = useState<Report | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const load = useCallback(async (from: string, to: string) => { setLoading(true); setError(""); const response = await fetch(`/api/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); const body = await response.json(); setLoading(false); if (!response.ok) return setError(body.error || "报表加载失败"); setReport(body); }, []);
  useEffect(() => { load(initial.from, initial.to); }, [load, initial.from, initial.to]);
  function choose(next: Exclude<Preset, "custom">) { const range = presetRange(next); setPreset(next); setFromDate(range.fromInput); setToDate(range.toInput); load(range.from, range.to); }
  function custom() { const from = new Date(`${fromDate}T00:00:00`); const to = new Date(`${toDate}T23:59:59.999`); if (from > to) return setError("开始日期不能晚于结束日期"); setPreset("custom"); load(from.toISOString(), to.toISOString()); }
  const cards = report ? [["新增客户", report.totals.new_customers], ["认领客户", report.totals.claimed], ["释放客户", report.totals.released], ["跟进次数", report.totals.followups], ["报价数量", report.totals.quotes], ["成交数量", report.totals.deals], ["成交率", `${report.totals.conversion_rate}%`], ["AI有效客户", report.totals.ai_valid]] : [];
  return <main className="min-h-screen p-5 lg:p-8"><div className="mx-auto max-w-7xl"><Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16}/>返回Dashboard</Link><header className="mt-5 flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-[.22em] text-indigo-400">Sales Performance</p><h1 className="mt-2 text-3xl font-semibold">销售业绩报表</h1><p className="mt-2 text-sm text-slate-400">{report?.profile.role === "ADMIN" ? "全部销售数据" : "我的销售数据"}</p></div><div className="flex flex-wrap gap-2">{(["today", "week", "month"] as const).map((item) => <button key={item} onClick={() => choose(item)} className={`rounded-xl border px-4 py-2 text-sm ${preset === item ? "border-indigo-400 bg-indigo-400/15 text-indigo-200" : "border-white/10"}`}>{item === "today" ? "今天" : item === "week" ? "本周" : "本月"}</button>)}</div></header>
    <section className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-4"><CalendarDays className="mb-2 text-indigo-300"/><label className="text-xs text-slate-400">开始日期<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"/></label><label className="text-xs text-slate-400">结束日期<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 block rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"/></label><button onClick={custom} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium">应用自定义日期</button></section>
    {error && <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-rose-300">{error}</p>}{loading && <div className="py-20 text-center text-slate-400"><LoaderCircle className="mx-auto animate-spin"/><p className="mt-3">统计中…</p></div>}
    {!loading && report && <><section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><p className="text-xs text-slate-500">{label}</p><strong className="mt-3 block text-3xl">{value}</strong></article>)}</section><section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[.035]"><div className="flex items-center gap-2 border-b border-white/10 p-5"><Medal size={19} className="text-amber-300"/><h2 className="font-semibold">销售排行榜</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-white/10 text-xs text-slate-500"><tr>{["排名", "销售姓名", "客户数量", "跟进数量", "成交数量", "成交率"].map((heading) => <th key={heading} className="px-5 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{report.ranking.map((row, index) => <tr key={row.user_id} className="border-b border-white/[.06]"><td className="px-5 py-4"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${index < 3 ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-slate-400"}`}>{index + 1}</span></td><td className="px-5"><b>{row.name}</b><p className="text-xs text-slate-500">{row.email}</p></td><td className="px-5">{row.customer_count}</td><td className="px-5">{row.followups}</td><td className="px-5 font-semibold text-emerald-300">{row.deals}</td><td className="px-5">{row.conversion_rate}%</td></tr>)}</tbody></table>{!report.ranking.length && <p className="p-10 text-center text-slate-500">该时间范围暂无销售数据</p>}</div></section></>}
  </div></main>;
}
