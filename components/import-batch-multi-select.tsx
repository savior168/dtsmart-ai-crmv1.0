"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ImportBatchOption = {
  id: string;
  filename: string;
  created_at: string | null;
  success_count?: number | null;
  pending_count?: number;
  customer_count?: number;
  legacy?: boolean;
  display_time?: string;
};

function compactTime(value: string | null) {
  if (!value) return "历史批次";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "历史批次";
  const part = (number: number) => String(number).padStart(2, "0");
  return `${part(date.getFullYear() % 100)}${part(date.getMonth() + 1)}${part(date.getDate())}${part(date.getHours())}${part(date.getMinutes())}`;
}

export function ImportBatchMultiSelect({
  options,
  value,
  onChange,
  placeholder = "选择历史导入批次",
  emptyText = "暂无可选导入批次",
  className = "",
}: {
  options: ImportBatchOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selected = new Set(value);
  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 outline-none transition hover:border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <span className="min-w-0 truncate">{value.length ? `已选择 ${value.length} 个批次` : placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 top-full z-50 mt-1 max-h-72 w-[min(540px,90vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {value.length ? (
            <button type="button" onClick={() => onChange([])} className="mb-1 w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50">
              清空批次选择
            </button>
          ) : null}
          {options.length ? options.map((batch) => {
            const checked = selected.has(batch.id);
            const countText = batch.pending_count != null
              ? `待筛选 ${batch.pending_count} 条`
              : `客户 ${batch.customer_count ?? 0} 条`;
            return (
              <button
                key={batch.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => onChange(checked ? value.filter((id) => id !== batch.id) : [...value, batch.id])}
                className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <span className="min-w-0">
                  <b className={`block truncate text-sm font-medium ${checked ? "text-blue-700" : "text-slate-800"}`}>{batch.filename}｜{batch.display_time || compactTime(batch.created_at)}</b>
                  <small className="mt-0.5 block text-xs text-slate-500">{batch.legacy ? "历史批次" : new Date(batch.created_at || "").toLocaleString("zh-CN")}｜{batch.success_count != null ? `成功导入 ${batch.success_count} 条｜` : ""}{countText}</small>
                </span>
                <span className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-transparent"}`}>
                  <Check size={13} strokeWidth={3} />
                </span>
              </button>
            );
          }) : <p className="px-3 py-6 text-center text-sm text-slate-400">{emptyText}</p>}
        </div>
      ) : null}
    </div>
  );
}
