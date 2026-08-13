"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, BriefcaseBusiness, CircleDollarSign, LoaderCircle, LogOut, MessageSquareText, Sparkles, Target, UserCheck, UserPlus } from "lucide-react";
import type { SalesMetrics } from "@/lib/reports/sales";

type Stats = SalesMetrics & { scope: "ALL" | "SELF"; role: string };

export function CrmDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => response.ok ? setStats(body) : setError(body.error || "统计加载失败"))
      .catch(() => setError("统计加载失败"));
  }, []);

  const cards = stats ? [
    ["新增客户", stats.new_customers, UserPlus, "text-cyan-300"],
    ["认领客户", stats.claimed, UserCheck, "text-indigo-300"],
    ["释放客户", stats.released, LogOut, "text-slate-300"],
    ["跟进次数", stats.followups, MessageSquareText, "text-violet-300"],
    ["报价数量", stats.quotes, BriefcaseBusiness, "text-amber-300"],
    ["成交数量", stats.deals, CircleDollarSign, "text-emerald-300"],
    ["成交率", `${stats.conversion_rate}%`, Target, "text-orange-300"],
    ["AI有效客户", stats.ai_valid, Sparkles, "text-fuchsia-300"],
  ] as const : [];

  return (
    <main className="w-full p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[.24em] text-indigo-400">Sales Performance</p>
          <h1 className="mt-2 text-3xl font-semibold">销售业绩总览</h1>
          <p className="mt-2 text-sm text-slate-400">本月 · {stats?.scope === "ALL" ? "全部销售数据" : "我的销售数据"}</p>
        </div>
        <Link href="/reports" className="flex items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-400/10 px-4 py-2.5 text-indigo-200">
          <BarChart3 size={17} />
          查看排行榜
        </Link>
      </header>

      {error && <p className="mt-6 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-rose-300">{error}</p>}
      {!stats && !error && (
        <div className="mt-16 text-center text-slate-400">
          <LoaderCircle className="mx-auto animate-spin" />
          <p className="mt-3 text-sm">加载统计中...</p>
        </div>
      )}

      {stats && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value, Icon, color]) => (
            <article key={label} className="rounded-2xl border border-white/10 bg-white/[.035] p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{label}</span>
                <Icon size={19} className={color} />
              </div>
              <strong className="mt-4 block text-3xl">{value}</strong>
            </article>
          ))}
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-indigo-400/20 bg-gradient-to-r from-indigo-500/10 to-violet-500/[.06] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">销售工作台</h2>
            <p className="mt-2 text-sm text-slate-400">批量筛选客户、分配负责人，并推进跟进、报价与成交。</p>
          </div>
          <Link href="/customers" className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium">进入客户中心</Link>
        </div>
      </section>
    </main>
  );
}
