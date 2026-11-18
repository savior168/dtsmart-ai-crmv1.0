"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellRing, Building2, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";

type Summary = { note_count: number; supplier_count: number; allocated_cny: number; paid_cny: number; unpaid_cny: number; cash_paid_reported_cny: number };

function currentMonthRange() {
  const now = new Date();
  const date = (day: number) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { from: date(1), to: date(now.getDate()) };
}

const amount = (value: number) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FinanceDashboard({ canViewReconciliation, canViewSuppliers, canViewNotifications }: { canViewReconciliation: boolean; canViewSuppliers: boolean; canViewNotifications: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [range] = useState(currentMonthRange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/supplier-reconciliation?from=${range.from}&to=${range.to}&page_size=10`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.summary) throw new Error(body.error || "供应商对账摘要加载失败");
      setSummary(body.summary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "财务工作台加载失败"); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { if (canViewReconciliation) void load(); else setLoading(false); }, [canViewReconciliation, load]);

  return <main className="dashboard-page min-h-[calc(100vh-64px)] bg-[#f8fafc] px-4 py-4 xl:px-5"><div className="mx-auto max-w-[1660px]">
    <section className="mb-4 flex flex-wrap items-center gap-3"><span className="rounded-lg border bg-white px-4 py-2.5 text-sm text-slate-600 shadow-sm">送货日期 {range.from} — {range.to}</span><button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-500 bg-white px-5 text-sm font-medium text-blue-600"><RefreshCw size={16}/>重置／刷新</button></section>
    {!canViewReconciliation ? <p className="mb-3 rounded-xl border bg-white p-4 text-sm text-slate-600">当前未授权查看供应商对账数据，请联系系统管理员配置权限。</p> : null}
    {error ? <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}。{summary ? "当前保留上次成功加载的数据。" : "请稍后重试。"}</p> : null}
    {loading && !summary ? <div className="grid min-h-[520px] place-items-center rounded-xl border bg-white"><LoaderCircle className="animate-spin text-blue-600" aria-label="加载中"/></div> : summary ? <>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-600">财务快照</p><h1 className="mt-1 text-[17px] font-semibold">供应商对账</h1><p className="mt-1 text-xs text-slate-500">仅统计所选送货日期内的送货单；付款与未付金额均对应这些送货单，不代表全公司历史余额。</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[["本月应付货款", amount(summary.allocated_cny)], ["本月已登记付款", amount(summary.paid_cny)], ["本月送货单未付", amount(summary.unpaid_cny)]].map(([label,value],index) => <Link key={label} href="/supplier-reconciliation" className={`rounded-xl border p-4 ${index===2 ? "border-amber-100 bg-amber-50/70" : index===1 ? "border-emerald-100 bg-emerald-50/70" : "border-blue-100 bg-blue-50/70"}`}><small className="text-slate-500">{label}</small><b className="mt-2 block text-xl tabular-nums">{value}</b></Link>)}</div></section>
      <section className="mt-4"><div className="mb-2"><p className="text-xs uppercase tracking-[0.16em] text-slate-400">运营概览</p><h2 className="mt-1 text-[15px] font-semibold">对账与待办</h2></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[["本月送货单", `${summary.note_count || 0} 张`, "核对纸单与分配金额"], ["涉及供应商", `${summary.supplier_count || 0} 家`, "查看供应商结算"], ["现场报付待核", amount(summary.cash_paid_reported_cny), "需与财务登记付款核对"]].map(([label,value,hint]) => <Link key={label} href="/supplier-reconciliation" className="min-h-[110px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"><p className="text-sm text-slate-600">{label}</p><b className="mt-2 block text-2xl">{value}</b><p className="mt-1 text-xs text-slate-500">{hint}</p></Link>)}</div></section>
    </> : null}
    <section className="mt-4 rounded-xl border bg-white p-3"><h2 className="text-sm font-medium text-slate-700">财务快捷入口</h2><div className="mt-3 grid gap-3 sm:grid-cols-3">{canViewReconciliation ? <Link href="/supplier-reconciliation" className="flex items-center gap-3 rounded-lg border p-3 text-sm text-blue-700 hover:border-blue-300"><WalletCards size={18}/>供应商对账与付款</Link> : null}{canViewSuppliers ? <Link href="/suppliers" className="flex items-center gap-3 rounded-lg border p-3 text-sm text-blue-700 hover:border-blue-300"><Building2 size={18}/>供应商档案</Link> : null}{canViewNotifications ? <Link href="/notifications" className="flex items-center gap-3 rounded-lg border p-3 text-sm text-blue-700 hover:border-blue-300"><BellRing size={18}/>待办与通知</Link> : null}</div></section>
  </div></main>;
}
