"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CountryLabel } from "@/components/country-label";

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
  showCounts = false,
}: {
  label: string;
  value: string[];
  options: SearchableFilterOption[];
  onChange: (value: string[]) => void;
  className?: string;
  emptyText?: string;
  /** Only enable when every option count is computed with the same scope and
   * predicates as the list query. Misleading facet counts are worse than no
   * count, so list filters hide them by default. */
  showCounts?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
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
  const selectedCountry = /国家/.test(label) && value.length === 1
    ? options.find((item) => item.value === value[0])
    : null;
  const total = showCounts ? options.reduce((sum, item) => sum + Math.max(0, Number(item.count || 0)), 0) : 0;

  function toggle(next: string) {
    onChange(value.includes(next) ? value.filter((item) => item !== next) : [...value, next]);
  }

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(290, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const estimatedHeight = 360;
      const opensAbove = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight;
      setPosition({ top: opensAbove ? Math.max(12, rect.top - estimatedHeight - 4) : rect.bottom + 4, left });
    };
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    place();
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const dropdown = open ? <div ref={menu} id={menuId} role="listbox" aria-label={`${label}选项`} className="fixed z-[100] w-[290px] max-w-[calc(100vw-24px)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl" style={position}>
      <label className="relative block">
        <Search className="absolute left-2.5 top-2.5 text-slate-400" size={14}/>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm text-slate-700 outline-none focus:border-blue-500"/>
      </label>
      <div className="mt-2 max-h-64 overflow-y-auto">
        <button type="button" onClick={() => onChange([])} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${value.length === 0 ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
          <span>全部{label}</span>{total > 0 ? <small className="text-slate-400">{total}</small> : null}
        </button>
        {visible.map((item) => {
          const selected = value.includes(item.value);
          return <button key={item.value} type="button" role="option" aria-selected={selected} onClick={() => toggle(item.value)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{selected ? <Check size={11}/> : null}</span>
            <span className="min-w-0 flex-1 truncate" title={item.label || item.value}>{/国家/.test(label) ? <CountryLabel value={item.value} className="!text-sm" /> : item.label || item.value}</span>
            {showCounts && item.count != null ? <small className="shrink-0 text-slate-400">{item.count}</small> : null}
          </button>;
        })}
        {visible.length === 0 ? <p className="px-3 py-5 text-center text-xs text-slate-400">{emptyText}</p> : null}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-1 pt-2">
        <button type="button" onClick={() => onChange([])} className="text-xs text-blue-600 hover:underline">清空</button>
        <button type="button" onClick={() => { setQuery(""); setOpen(false); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">完成</button>
      </div>
    </div> : null;

  return <div className={`relative min-w-0 ${className}`}>
    <button ref={trigger} type="button" aria-label={`${label}筛选`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 outline-none transition hover:border-blue-300 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100">
      <span className="truncate">{selectedCountry ? <CountryLabel value={selectedCountry.value} className="!text-sm" /> : selectedLabel}</span>
      <ChevronDown size={15} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}/>
    </button>
    {typeof document !== "undefined" ? createPortal(dropdown, document.body) : null}
  </div>;
}
