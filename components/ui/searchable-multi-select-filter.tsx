"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

export type SearchableFilterOption = {
  value: string;
  label?: string;
  count?: number;
};

export function SearchableMultiSelectFilter({
  label,
  value,
  options,
  onChange,
  className = "",
  emptyText = "当前范围暂无可选项",
}: {
  label: string;
  value: string[];
  options: SearchableFilterOption[];
  onChange: (value: string[]) => void;
  className?: string;
  emptyText?: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return keyword
      ? options.filter((item) => `${item.label || item.value} ${item.value}`.toLocaleLowerCase().includes(keyword))
      : options;
  }, [options, query]);
  const selectedLabel = value.length === 0
    ? `全部${label}`
    : value.length === 1
      ? options.find((item) => item.value === value[0])?.label || value[0]
      : `${label}（${value.length}）`;
  const total = options.reduce((sum, item) => sum + Math.max(0, Number(item.count || 0)), 0);

  function toggle(next: string) {
    onChange(value.includes(next) ? value.filter((item) => item !== next) : [...value, next]);
  }

  return <details ref={details} className={`group relative min-w-0 ${className}`}>
    <summary aria-label={`${label}筛选`} className="flex h-10 w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 outline-none transition hover:border-blue-300 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100">
      <span className="truncate">{selectedLabel}</span>
      <ChevronDown size={15} className="shrink-0 text-slate-400 transition group-open:rotate-180"/>
    </summary>
    <div className="absolute left-0 top-full z-50 mt-1 w-[290px] max-w-[min(290px,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <label className="relative block">
        <Search className="absolute left-2.5 top-2.5 text-slate-400" size={14}/>
        <input value={query} onChange={(event) => setQuery(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder={`搜索${label}`} className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm text-slate-700 outline-none focus:border-blue-500"/>
      </label>
      <div className="mt-2 max-h-64 overflow-y-auto">
        <button type="button" onClick={() => onChange([])} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${value.length === 0 ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
          <span>全部{label}</span>{total > 0 ? <small className="text-slate-400">{total}</small> : null}
        </button>
        {visible.map((item) => {
          const selected = value.includes(item.value);
          return <button key={item.value} type="button" role="option" aria-selected={selected} onClick={() => toggle(item.value)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{selected ? <Check size={11}/> : null}</span>
            <span className="min-w-0 flex-1 truncate" title={item.label || item.value}>{item.label || item.value}</span>
            {item.count != null ? <small className="shrink-0 text-slate-400">{item.count}</small> : null}
          </button>;
        })}
        {visible.length === 0 ? <p className="px-3 py-5 text-center text-xs text-slate-400">{emptyText}</p> : null}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-1 pt-2">
        <button type="button" onClick={() => onChange([])} className="text-xs text-blue-600 hover:underline">清空</button>
        <button type="button" onClick={() => { setQuery(""); details.current?.removeAttribute("open"); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">完成</button>
      </div>
    </div>
  </details>;
}
