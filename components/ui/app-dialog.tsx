"use client";

import { useEffect, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

export function AppDialog({ open = true, title, description, children, onClose, width = "max-w-xl" }: {
  open?: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = previous; };
  }, [onClose, open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl`}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4">
        <div><h2 id="app-dialog-title" className="text-lg font-semibold text-slate-900">{title}</h2>{description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}</div>
        <button type="button" onClick={onClose} aria-label="关闭弹窗" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18}/></button>
      </header>
      <div className="p-5">{children}</div>
    </section>
  </div>;
}

export function DialogActions({ busy = false, disabled = false, onCancel, confirmLabel = "确认", tone = "primary" }: {
  busy?: boolean; disabled?: boolean; onCancel: () => void; confirmLabel?: string; tone?: "primary" | "danger";
}) {
  return <footer className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
    <button type="button" onClick={onCancel} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">取消</button>
    <button disabled={busy||disabled} className={`h-10 rounded-lg px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"}`}>{busy ? "处理中…" : confirmLabel}</button>
  </footer>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy, danger = false, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel?: string; busy?: boolean; danger?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <AppDialog open={open} title={title} onClose={onCancel} width="max-w-md">
    <div className={`flex items-start gap-3 rounded-xl p-4 text-sm leading-6 ${danger ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}><AlertTriangle className="mt-0.5 shrink-0" size={19}/><p>{description}</p></div>
    <form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}><DialogActions busy={busy} onCancel={onCancel} confirmLabel={confirmLabel} tone={danger ? "danger" : "primary"}/></form>
  </AppDialog>;
}
