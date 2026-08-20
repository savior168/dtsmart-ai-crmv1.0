"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export const panel = "rounded-xl border border-slate-200 bg-white shadow-sm";
export const input = "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
export const button = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-45";
export const primaryButton = `${button} border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700 hover:text-white`;

const statusMap: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "排队中", className: "bg-amber-50 text-amber-700" },
  PENDING: { label: "等待分析", className: "bg-slate-100 text-slate-600" },
  RUNNING: { label: "执行中", className: "bg-blue-50 text-blue-700" },
  PAUSED: { label: "已停止", className: "bg-slate-100 text-slate-700" },
  COMPLETED: { label: "已完成", className: "bg-emerald-50 text-emerald-700" },
  FAILED: { label: "执行失败", className: "bg-rose-50 text-rose-700" },
  CANCELLED: { label: "已取消", className: "bg-slate-100 text-slate-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusMap[status] || { label: status || "未知", className: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${config.className}`}>{config.label}</span>;
}

export function StrategyBadge({ strategy }: { strategy: string }) {
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${strategy === "DEEP" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>{strategy === "DEEP" ? "深度分析" : "智能分析"} v1.0</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-[26px] font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1.5 text-sm text-slate-500">{description}</p></div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</header>;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((value) => value >= 1 && value <= pages))];
  return <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">共 {total.toLocaleString("zh-CN")} 条</span><div className="flex items-center gap-1"><button className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-35" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页"><ChevronLeft size={16}/></button>{nums.map((value, index) => <span key={`${value}-${index}`} className="contents">{index > 0 && value - nums[index - 1] > 1 ? <span className="grid h-9 w-8 place-items-center">…</span> : null}<button onClick={() => onPage(value)} className={`h-9 min-w-9 rounded-lg border px-2 ${value === page ? "border-blue-600 bg-blue-600 text-white" : "bg-white"}`}>{value}</button></span>)}<button className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-35" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="下一页"><ChevronRight size={16}/></button></div><div className="flex items-center gap-2"><select className={input} value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[10,20,50,100].map((size) => <option key={size} value={size}>{size}条/页</option>)}</select><span className="text-slate-500">第 {page}/{pages} 页</span></div></footer>;
}

export function Loading({ text = "正在加载…" }: { text?: string }) {
  return <div className="grid min-h-56 place-items-center text-sm text-slate-500"><div className="flex items-center gap-2"><LoaderCircle size={18} className="animate-spin text-blue-600"/>{text}</div></div>;
}

export function ErrorState({ message, reload }: { message: string; reload: () => void }) {
  return <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>加载失败</b><p className="mt-1 break-words">{message}</p><button className="mt-3 font-medium underline" onClick={reload}>重新加载</button></div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy, onClose, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; onClose: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></div><button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}><X size={18}/></button></div><div className="mt-6 flex justify-end gap-2"><button className={button} onClick={onClose}>取消</button><button disabled={busy} className={primaryButton} onClick={onConfirm}>{busy ? "处理中…" : confirmLabel}</button></div></div></div>;
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.type === "error" ? 4500 : 2400); return () => clearTimeout(timer); }, [toast]);
  const node = toast ? <div className={`fixed z-[90] rounded-xl px-4 py-3 text-sm text-white shadow-xl ${toast.type === "error" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-rose-600" : "bottom-6 right-6 bg-slate-900"}`}>{toast.text}</div> : null;
  return { toast: (text: string, type: "success" | "error" = "success") => setToast({ text, type }), node };
}

export function formatNumber(value: number | null | undefined) { return Number(value || 0).toLocaleString("zh-CN"); }
export function formatTokens(value: number | null | undefined) { const total = Number(value || 0); return total >= 1_000_000 ? `${(total / 1_000_000).toFixed(2)}M` : total >= 1_000 ? `${(total / 1_000).toFixed(2)}K` : String(total); }
export function formatCost(value: number | string | null | undefined) { return `$${Number(value || 0).toFixed(4)}`; }

