"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export const panel = "rounded-[10px] border border-[#e1e6ef] bg-white";
export const input = "h-[38px] rounded-[7px] border border-[#dbe2ec] bg-white px-[10px] text-sm text-[#334157] outline-none transition focus:border-[#1763e8] focus:ring-2 focus:ring-blue-100";
export const button = "inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[7px] border border-[#d8dfe9] bg-white px-[14px] text-sm font-medium text-[#314057] transition hover:border-[#1763e8] hover:text-[#1763e8] disabled:cursor-not-allowed disabled:opacity-45";
export const primaryButton = `${button} border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700 hover:text-white`;

const statusMap: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "排队中", className: "bg-amber-50 text-amber-700" },
  PENDING: { label: "等待分析", className: "bg-slate-100 text-slate-600" },
  RUNNING: { label: "执行中", className: "bg-blue-50 text-blue-700" },
  PAUSING: { label: "正在安全停止", className: "bg-amber-50 text-amber-700" },
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

export function PageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-[14px]"><div><h1 className="m-0 text-2xl font-bold leading-tight tracking-[-.25px] text-[#111a2c]">{title}</h1><div className="mt-[5px] text-sm leading-[1.65] text-[#6d798d]">{description}</div></div>{actions && <div className="flex flex-wrap items-center gap-[9px]">{actions}</div>}</header>;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, itemLabel = "条", pageSizes = [10, 20, 50, 100] }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void; itemLabel?: string; pageSizes?: number[] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((value) => value >= 1 && value <= pages))];
  return <footer className="grid grid-cols-1 items-center gap-3 border-t border-[#e8ecf2] px-4 py-[14px] text-sm text-[#657187] md:grid-cols-[1fr_auto_1fr]"><span>共 {total.toLocaleString("zh-CN")} {itemLabel}</span><div className="flex items-center justify-center gap-[5px]"><button className="grid h-[34px] min-w-[34px] place-items-center rounded-md border border-[#dbe1ea] bg-white disabled:opacity-45" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页"><ChevronLeft size={16}/></button>{nums.map((value, index) => <span key={`${value}-${index}`} className="contents">{index > 0 && value - nums[index - 1] > 1 ? <span className="grid h-[34px] w-8 place-items-center">…</span> : null}<button onClick={() => onPage(value)} className={`h-[34px] min-w-[34px] rounded-md border px-2 ${value === page ? "border-[#1763e8] bg-[#1763e8] text-white" : "border-[#dbe1ea] bg-white text-[#46536a]"}`}>{value}</button></span>)}<button className="grid h-[34px] min-w-[34px] place-items-center rounded-md border border-[#dbe1ea] bg-white disabled:opacity-45" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="下一页"><ChevronRight size={16}/></button></div><div className="flex items-center justify-self-end gap-2"><select className={`${input} h-[34px]`} value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}条/页</option>)}</select><label className="flex items-center gap-1">跳至 <input className="h-[34px] w-12 rounded-md border border-[#dbe1ea] px-2 text-center" defaultValue={page} key={page} onKeyDown={(event) => { if (event.key === "Enter") { const value = Math.min(pages, Math.max(1, Number(event.currentTarget.value) || 1)); onPage(value); } }}/> 页</label></div></footer>;
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
export function formatDuration(value: number | null | undefined) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

export function effectiveElapsedMs(task: { status?: string; elapsed_ms?: number | null; started_at?: string | null; finished_at?: string | null; completed_at?: string | null; updated_at?: string | null }, now = Date.now()) {
  const accumulated = Number(task.elapsed_ms || 0);
  if (["RUNNING", "PAUSING"].includes(String(task.status)) && task.started_at) {
    const started = new Date(task.started_at).getTime();
    return accumulated + (Number.isFinite(started) ? Math.max(0, now - started) : 0);
  }
  if (accumulated > 0 || !task.started_at) return accumulated;
  const started = new Date(task.started_at).getTime();
  const ended = new Date(task.finished_at || task.completed_at || task.updated_at || "").getTime();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}
