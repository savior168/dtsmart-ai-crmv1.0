import type { ReactNode } from "react";

export const appFieldClass = "h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

export function AppFilterBar({ children }: { children: ReactNode }) {
  return <section className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center">{children}</section>;
}

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "violet";

const tones: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function statusTone(status: string): StatusTone {
  if (["DEAL", "CONFIRMED", "READY", "COMPLETED", "ACTIVE", "APPROVED"].includes(status)) return "success";
  if (["SHORTAGE", "EXPIRED", "PENDING", "WAITING", "WAITING_STOCK", "FOLLOWUP_REQUIRED"].includes(status)) return "warning";
  if (["CANCELLED", "FAILED", "REJECTED", "RELEASED", "DISABLED", "DEPARTED"].includes(status)) return "danger";
  if (["FOLLOWING", "PREPARING"].includes(status)) return "violet";
  if (["DRAFT", "SUPERSEDED", "UNCLAIMED"].includes(status)) return "neutral";
  return "info";
}

export function AppStatusBadge({ status, children, tone }: { status: string; children: ReactNode; tone?: StatusTone }) {
  const resolved = tone || statusTone(status);
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${tones[resolved]}`}>{children}</span>;
}
