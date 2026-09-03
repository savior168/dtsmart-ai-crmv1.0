"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export const STANDARD_PAGE_SIZES = [10, 20, 30, 50, 100] as const;

export function AppPagination({ page, pageSize, total, onPage, onPageSize, itemLabel = "条", pageSizes = STANDARD_PAGE_SIZES }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void; itemLabel?: string; pageSizes?: readonly number[];
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, index) => start + index);
  return <footer className="grid gap-3 border-t border-slate-100 bg-white px-4 py-3 text-sm text-slate-500 md:grid-cols-[1fr_auto_1fr] md:items-center">
    <span>共 <b className="text-slate-800">{total.toLocaleString("zh-CN")}</b> {itemLabel}</span>
    <div className="flex items-center justify-center gap-1.5">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronLeft size={16}/></button>
      {numbers.map((number) => <button type="button" key={number} onClick={() => onPage(number)} aria-current={number === page ? "page" : undefined} className={`h-9 min-w-9 rounded-lg border px-2 ${number === page ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{number}</button>)}
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="下一页" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronRight size={16}/></button>
    </div>
    <div className="flex items-center gap-2 md:justify-self-end"><label className="flex items-center gap-2">每页<select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700">{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><span>{page}/{pages} 页</span></div>
  </footer>;
}
