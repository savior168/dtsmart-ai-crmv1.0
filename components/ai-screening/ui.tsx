"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ConfirmDialog as SharedConfirmDialog } from "@/components/ui/app-dialog";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppStatusBadge } from "@/components/ui/app-list";

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
  return <AppStatusBadge status={status}>{config.label}</AppStatusBadge>;
}

export function StrategyBadge({ strategy }: { strategy: string }) {
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${strategy === "DEEP" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>{strategy === "DEEP" ? "深度分析" : "智能分析"} v1.0</span>;
}

export function CostModeBadge({ mode }: { mode?: string | null }) {
  const freeOnly = mode === "FREE_ONLY";
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${freeOnly ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{freeOnly ? "快速分析（完全免费）" : "智能分析（高性价比）"}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-[14px]"><div><h1 className="m-0 text-2xl font-bold leading-tight tracking-[-.25px] text-[#111a2c]">{title}</h1><div className="mt-[5px] text-sm leading-[1.65] text-[#6d798d]">{description}</div></div>{actions && <div className="flex flex-wrap items-center gap-[9px]">{actions}</div>}</header>;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, itemLabel = "条", pageSizes = [10, 20, 50, 100] }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void; itemLabel?: string; pageSizes?: number[] }) {
  return <AppPagination page={page} pageSize={pageSize} total={total} onPage={onPage} onPageSize={onPageSize} itemLabel={itemLabel} pageSizes={pageSizes}/>;
}

export function Loading({ text = "正在加载…" }: { text?: string }) {
  return <div className="grid min-h-56 place-items-center text-sm text-slate-500"><div className="flex items-center gap-2"><LoaderCircle size={18} className="animate-spin text-blue-600"/>{text}</div></div>;
}

export function ErrorState({ message, reload }: { message: string; reload: () => void }) {
  return <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>加载失败</b><p className="mt-1 break-words">{message}</p><button className="mt-3 font-medium underline" onClick={reload}>重新加载</button></div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy, onClose, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; onClose: () => void; onConfirm: () => void }) {
  return <SharedConfirmDialog open={open} title={title} description={description} confirmLabel={confirmLabel} busy={busy} onCancel={onClose} onConfirm={onConfirm}/>;
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.type === "error" ? 4500 : 2400); return () => clearTimeout(timer); }, [toast]);
  const node = toast ? <div className={`fixed z-[90] rounded-xl px-4 py-3 text-sm text-white shadow-xl ${toast.type === "error" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-rose-600" : "bottom-6 right-6 bg-slate-900"}`}>{toast.text}</div> : null;
  return { toast: (text: string, type: "success" | "error" = "success") => setToast({ text, type }), node };
}

export function formatNumber(value: number | null | undefined) { return Number(value || 0).toLocaleString("zh-CN"); }
export function formatTokens(value: number | null | undefined) { const total = Number(value || 0); return total >= 1_000_000 ? `${(total / 1_000_000).toFixed(2)}M` : total >= 1_000 ? `${(total / 1_000).toFixed(2)}K` : String(total); }
export function formatCost(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  const normalized = Number.isFinite(amount) && Math.abs(amount) >= 0.00005 ? amount : 0;
  return `$${normalized.toFixed(4)}`;
}
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
  const terminalAt = task.finished_at || task.completed_at;
  if (terminalAt) {
    if (accumulated > 0) return accumulated;
    const started = new Date(task.started_at || "").getTime();
    const ended = new Date(terminalAt).getTime();
    return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
  }
  if (["RUNNING", "PAUSING"].includes(String(task.status)) && task.started_at) {
    const started = new Date(task.started_at).getTime();
    return accumulated + (Number.isFinite(started) ? Math.max(0, now - started) : 0);
  }
  if (accumulated > 0 || !task.started_at) return accumulated;
  const started = new Date(task.started_at).getTime();
  const ended = new Date(task.finished_at || task.completed_at || task.updated_at || "").getTime();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}

