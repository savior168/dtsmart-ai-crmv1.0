"use client";

import { Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type CostFilterOption = { id: string; label: string; description?: string | null };
const MAX_SELECTED = 50;

export function CostFilterMultiSelect({
  kind,
  value,
  onChange,
  placeholder,
  filters,
}: {
  kind: "task" | "customer";
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  filters: {
    from: string;
    to: string;
    provider: string;
    operation: string;
    userId: string;
    taskIds: string[];
    customerIds: string[];
  };
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CostFilterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          type: kind,
          q: search.trim(),
          from: filters.from,
          to: filters.to,
        });
        if (filters.provider) params.set("provider", filters.provider);
        if (filters.operation) params.set("operation", filters.operation);
        if (filters.userId) params.set("user_id", filters.userId);
        filters.taskIds.forEach((id) => params.append("task_id", id));
        filters.customerIds.forEach((id) => params.append("customer_id", id));
        value.forEach((id) => params.append("selected_id", id));
        const response = await fetch(`/api/cost-center/options?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (response.ok) setOptions(body.data || []);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filters, kind, open, search, value]);

  const selected = new Set(value);
  return (
    <div ref={rootRef} className="relative min-w-0">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 outline-none transition hover:border-blue-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
        <span className="truncate">{value.length ? `已选 ${value.length} 项` : placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}/>
      </button>
      {open ? <div className="absolute left-0 top-full z-50 mt-1 w-[min(430px,88vw)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
        <label className="relative block"><Search className="absolute left-3 top-2.5 text-slate-400" size={15}/><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === "task" ? "搜索任务名称或任务编号" : "搜索客户名称"} className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"/></label>
        <div role="listbox" aria-multiselectable="true" className="mt-2 max-h-64 overflow-y-auto">
          {value.length ? <button type="button" onClick={() => onChange([])} className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50">清空已选</button> : null}
          {loading ? <div className="grid h-20 place-items-center"><LoaderCircle className="animate-spin text-blue-600" size={18}/></div> : options.length ? options.map((option) => {
            const checked = selected.has(option.id);
            const disabled = !checked && value.length >= MAX_SELECTED;
            return <button key={option.id} type="button" role="option" aria-selected={checked} disabled={disabled} onClick={() => onChange(checked ? value.filter((id) => id !== option.id) : [...value, option.id])} className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}>
              <span className="min-w-0"><b className={`block truncate text-sm font-medium ${checked ? "text-blue-700" : "text-slate-800"}`}>{option.label}</b>{option.description ? <small className="mt-0.5 block truncate text-xs text-slate-500">{option.description}</small> : null}</span>
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-transparent"}`}><Check size={13} strokeWidth={3}/></span>
            </button>;
          }) : <p className="px-3 py-6 text-center text-sm text-slate-400">没有匹配结果</p>}
        </div>
        <p className="border-t px-3 pt-2 text-[11px] text-slate-400">最多选择 {MAX_SELECTED} 项</p>
      </div> : null}
    </div>
  );
}
