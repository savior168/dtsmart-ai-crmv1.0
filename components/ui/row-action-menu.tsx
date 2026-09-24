"use client";

import { MoreHorizontal } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type RowActionMenuProps = {
  children: ReactNode;
  label?: string;
  ariaLabel: string;
};

/** Keeps secondary table actions compact without hiding the primary detail link. */
export function RowActionMenu({ children, label = "操作", ariaLabel }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; openUpward: boolean } | null>(null);
  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
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
  useLayoutEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.max(160, menuRef.current?.offsetWidth || 160);
      const menuHeight = Math.max(40, menuRef.current?.offsetHeight || 40);
      const edge = 8;
      const openUpward = rect.top >= menuHeight + edge;
      setPosition({
        top: openUpward ? rect.top - edge : rect.bottom + edge,
        left: Math.max(edge, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - edge)),
        openUpward,
      });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    // Capture inner table scrolling too, so the floating panel never lingers
    // at an old coordinate or becomes clipped by a scroll container.
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
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
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={(event) => { if ((event.target as Element).closest("button")) setOpen(false); }}
          className="fixed z-[100] min-w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          style={position ? {
            top: position.top,
            left: position.left,
            transform: position.openUpward ? "translateY(-100%)" : undefined,
          } : { visibility: "hidden", left: 0, top: 0 }}
        >
          {children}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

export function RowActionItem({ children, tone = "default", onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "warning" | "danger" }) {
  const label = typeof children === "string" ? children : "";
  const semanticTone = tone !== "default" ? tone : /重试/.test(label) ? "warning" : /查看报告/.test(label) ? "info" : /复验|全量复核/.test(label) ? "accent" : "default";
  const color = semanticTone === "danger" ? "text-rose-700 hover:bg-rose-50" : semanticTone === "warning" ? "text-amber-700 hover:bg-amber-50" : semanticTone === "info" ? "text-blue-700 hover:bg-blue-50" : semanticTone === "accent" ? "text-violet-700 hover:bg-violet-50" : "text-slate-700 hover:bg-slate-50";
  return <button type="button" {...props} onClick={onClick} className={`flex w-full items-center px-3 py-2 text-left text-sm transition ${color} ${props.className || ""}`}>{children}</button>;
}
