"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type RowActionMenuProps = {
  children: ReactNode;
  label?: string;
  ariaLabel: string;
};

/** Keeps secondary table actions compact without hiding the primary detail link. */
export function RowActionMenu({ children, label = "操作", ariaLabel }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={ariaLabel}
        title="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        {label}
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open ? <div className="absolute right-0 z-50 mt-1.5 min-w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">{children}</div> : null}
    </div>
  );
}

export function RowActionItem({ children, tone = "default", onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "warning" | "danger" }) {
  const color = tone === "danger" ? "text-rose-700 hover:bg-rose-50" : tone === "warning" ? "text-amber-700 hover:bg-amber-50" : "text-slate-700 hover:bg-slate-50";
  return <button type="button" {...props} onClick={onClick} className={`flex w-full items-center px-3 py-2 text-left text-sm transition ${color} ${props.className || ""}`}>{children}</button>;
}
