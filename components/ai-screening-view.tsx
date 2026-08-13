"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Home, LoaderCircle, Sparkles } from "lucide-react";
import type { Customer } from "@/lib/types";

type Result = {
  customer_id: string;
  industry_type?: string;
  is_target_customer?: boolean;
  ai_score?: number;
  ai_level?: string;
  ai_reason?: string;
  error?: string;
};

export function AiScreeningView() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/customers?page=1&pageSize=100");
    const body = await response.json();
    setLoading(false);
    if (!response.ok) return setError(body.error || "客户加载失败");
    setCustomers(body.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function analyze() {
    const ids = [...selected];
    if (!ids.length || running) return;
    setRunning(true);
    setCompleted(0);
    setResults([]);
    setError("");
    for (const id of ids) {
      try {
        const response = await fetch("/api/ai/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer_id: id }),
        });
        const body = await response.json();
        setResults((current) => [...current, response.ok ? body : { customer_id: id, error: body.error || "分析失败" }]);
        if (!response.ok && body.error === "OPENAI_NOT_CONFIGURED") {
          setError("尚未配置 OPENAI_API_KEY，请在环境变量中配置后重试。");
          break;
        }
      } catch {
        setResults((current) => [...current, { customer_id: id, error: "网络请求失败" }]);
      }
      setCompleted((value) => value + 1);
    }
    setRunning(false);
    await load();
  }

  const total = selected.size;
  const progress = total ? Math.round((completed / total) * 100) : 0;

  return (
    <main className="min-h-screen p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap gap-2">
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-400/10 px-4 py-2.5 text-sm text-indigo-200 hover:bg-indigo-400/15">
            <Home size={16} />
            返回数据总览
          </Link>
          <Link href="/customers" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[.06]">
            <ArrowLeft size={16} />
            返回客户列表
          </Link>
        </div>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[.22em] text-violet-400">AI Screening</p>
            <h1 className="mt-2 text-3xl font-semibold">AI 客户筛选</h1>
            <p className="mt-2 text-sm text-slate-400">批量识别行业、目标客户价值与跟进优先级。</p>
          </div>
          <button onClick={analyze} disabled={!total || running} className="flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-40">
            {running ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}
            分析已选 {total} 个客户
          </button>
        </header>

        {(running || completed > 0) && (
          <section className="mt-7 rounded-2xl border border-violet-400/20 bg-violet-400/[.06] p-5">
            <div className="flex justify-between text-sm"><span>{running ? "正在分析" : "本次分析完成"}</span><span>{completed} / {total}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${progress}%` }} /></div>
          </section>
        )}
        {error && <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">{error}</p>}

        <section className="mt-7 overflow-hidden rounded-2xl border border-white/10 bg-white/[.035]">
          <div className="flex items-center justify-between border-b border-white/10 p-5">
            <div>
              <h2 className="font-semibold">选择待分析客户</h2>
              <p className="mt-1 text-xs text-slate-500">当前最多加载最近 100 个可访问客户</p>
            </div>
            <button onClick={() => setSelected(selected.size === customers.length ? new Set() : new Set(customers.map((item) => item.id)))} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
              {selected.size === customers.length && customers.length ? "取消全选" : "全选"}
            </button>
          </div>
          <div className="divide-y divide-white/[.06]">
            {customers.map((customer) => {
              const result = results.find((item) => item.customer_id === customer.id);
              return (
                <label key={customer.id} className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-4 p-4 hover:bg-white/[.03]">
                  <input type="checkbox" checked={selected.has(customer.id)} onChange={() => toggle(customer.id)} disabled={running} className="h-4 w-4 accent-violet-500" />
                  <div>
                    <p className="font-medium">{customer.company_name}</p>
                    <p className="mt-1 text-xs text-slate-500">{customer.country || "国家未知"} · {customer.website || customer.google_url || "无网站信息"}</p>
                  </div>
                  <div className="text-right">
                    {result?.error ? <span className="text-sm text-rose-300">{result.error}</span> : result ? (
                      <>
                        <p className="font-semibold text-emerald-300">{result.ai_level} · {result.ai_score}</p>
                        <p className="text-xs text-slate-500">{result.industry_type}</p>
                      </>
                    ) : customer.ai_level ? (
                      <>
                        <p className="text-sm text-slate-300">现有 {customer.ai_level} · {customer.ai_score}</p>
                        <p className="text-xs text-slate-500">{customer.industry}</p>
                      </>
                    ) : <span className="text-xs text-slate-600">待分析</span>}
                  </div>
                </label>
              );
            })}
            {loading && <p className="p-10 text-center text-slate-500">加载客户中...</p>}
            {!loading && !customers.length && <p className="p-10 text-center text-slate-500">暂无可分析客户</p>}
          </div>
        </section>

        {results.some((item) => !item.error) && (
          <section className="mt-7 rounded-2xl border border-emerald-400/20 bg-emerald-400/[.05] p-5">
            <p className="flex items-center gap-2 font-medium text-emerald-300"><CheckCircle2 size={18} />分析结果已写入客户资料和操作日志</p>
          </section>
        )}
      </div>
    </main>
  );
}
