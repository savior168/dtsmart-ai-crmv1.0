"use client";

import { useRef, useState } from "react";
import { monthRange } from "@/lib/reports/month-range";

const months = Array.from({ length: 12 }, (_, index) => index + 1);

export function MonthRangeShortcut({ from, to, onApply, embedded = false }: {
  from: string; to: string; onApply: (range: { from: string; to: string }) => void; embedded?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [startMonth, setStartMonth] = useState(new Date().getMonth() + 1);
  const [endMonth, setEndMonth] = useState(new Date().getMonth() + 1);

  function prepareOpen() {
    if (details.current?.open) return;
    const currentYear = Number(from.slice(0, 4));
    const sameYear = /^\d{4}-\d{2}-\d{2}$/.test(from)
      && /^\d{4}-\d{2}-\d{2}$/.test(to) && from.slice(0, 4) === to.slice(0, 4);
    const now = new Date();
    setYear(sameYear ? currentYear : now.getFullYear());
    setStartMonth(sameYear ? Number(from.slice(5, 7)) : now.getMonth() + 1);
    setEndMonth(sameYear ? Number(to.slice(5, 7)) : now.getMonth() + 1);
  }

  return <details ref={details} className="relative shrink-0 text-sm">
    <summary onClick={prepareOpen} className={`flex h-10 cursor-pointer list-none items-center px-3 font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${embedded ? "rounded-r-lg hover:bg-blue-50" : "rounded-lg border border-slate-200 bg-white hover:border-blue-300"}`}>按月选择 <span aria-hidden="true" className="ml-2 text-slate-400">⌄</span></summary>
    <form onSubmit={(event) => { event.preventDefault(); onApply(monthRange(year, startMonth, endMonth)); if (details.current) details.current.open = false; }} className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <p className="mb-3 text-xs text-slate-500">选单月或同一年内连续多个月</p>
      <label className="block text-xs text-slate-600">年份<input type="number" min={1900} max={2100} required value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"/></label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-600">起始月<select value={startMonth} onChange={(event) => { const month = Number(event.target.value); setStartMonth(month); if (endMonth < month) setEndMonth(month); }} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm">{months.map((month) => <option key={month} value={month}>{month} 月</option>)}</select></label>
        <label className="text-xs text-slate-600">结束月<select value={endMonth} onChange={(event) => setEndMonth(Number(event.target.value))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm">{months.filter((month) => month >= startMonth).map((month) => <option key={month} value={month}>{month} 月</option>)}</select></label>
      </div>
      <button type="submit" className="mt-3 h-9 w-full rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700">应用月份范围</button>
    </form>
  </details>;
}
