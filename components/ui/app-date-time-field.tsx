"use client";

import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { quickLocalDateTime } from "@/lib/date-time";
import { AppSelect } from "@/components/ui/app-select";

const pad = (value: number) => String(value).padStart(2, "0");
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

/** Shared, timezone-explicit date/time input without the browser's combined picker. */
export function AppDateTimeField({ value, onChange, label, help, presets = false }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  help?: string;
  presets?: boolean;
}) {
  const selectedDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value.slice(0, 10) : "";
  const hour = selectedDate ? value.slice(11, 13) : "10";
  const minute = selectedDate ? value.slice(14, 16) : "00";
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const date = selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [position, setPosition] = useState({ top: 0, left: 0, width: 292, maxHeight: 330 });
  const trigger = useRef<HTMLButtonElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const calendarId = useId();

  function closeCalendar() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }

  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const day = calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${pendingFocus.current}"]`);
    day?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [open, month]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !calendar.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    function closeOnScroll(event: Event) { if (!calendar.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  function showCalendar() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(292, window.innerWidth - 16);
    const height = Math.min(350, window.innerHeight - 16);
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + height + 4 < window.innerHeight ? rect.bottom + 4 : Math.max(8, Math.min(rect.top - height - 4, window.innerHeight - height - 8)),
      width,
      maxHeight: height,
    });
    const date = selectedDate ? new Date(`${selectedDate}T12:00:00`) : new Date();
    pendingFocus.current = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setOpen(true);
  }

  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index - firstWeekday + 1);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return <fieldset className="mt-3 rounded-lg border border-slate-200 p-3">
    <legend className="px-1 text-sm font-medium text-slate-700">{label}</legend>
    {presets ? <div className="mb-3 flex flex-wrap gap-2">{[{ days: 1, label: "明天" }, { days: 3, label: "3 天后" }, { days: 7, label: "1 周后" }].map((item) => <button key={item.days} type="button" onClick={() => onChange(quickLocalDateTime(item.days))} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">{item.label} 10:00</button>)}</div> : null}
    <div className="flex flex-wrap items-center gap-2">
      <button ref={trigger} type="button" aria-label={`${label}：${selectedDate || "选择日期"}`} aria-haspopup="dialog" aria-controls={open ? calendarId : undefined} aria-expanded={open} onClick={() => open ? setOpen(false) : showCalendar()} className="inline-flex h-10 min-w-40 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:border-blue-300"><CalendarDays size={16} className="text-blue-600"/>{selectedDate || "选择日期"}</button>
      <AppSelect value={hour} onChange={(event) => selectedDate && onChange(`${selectedDate}T${event.target.value}:${minute}`)} disabled={!selectedDate} aria-label={`${label}：小时`} className="h-10 w-[92px]">{Array.from({ length: 24 }, (_, index) => <option key={index} value={pad(index)}>{pad(index)} 时</option>)}</AppSelect>
      <span className="text-slate-400">:</span>
      <AppSelect value={minute} onChange={(event) => selectedDate && onChange(`${selectedDate}T${hour}:${event.target.value}`)} disabled={!selectedDate} aria-label={`${label}：分钟`} className="h-10 w-[92px]">{Array.from({ length: 60 }, (_, index) => <option key={index} value={pad(index)}>{pad(index)} 分</option>)}</AppSelect>
      {value ? <button type="button" onClick={() => onChange("")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">暂不安排</button> : null}
    </div>
    <p className="mt-2 text-xs text-slate-500">{help ? `${help} ` : ""}按当前设备当地时间选择。</p>
    {open && typeof document !== "undefined" ? createPortal(<div id={calendarId} ref={calendar} role="dialog" aria-modal="true" aria-label={`${label}日历`} className="fixed z-[210] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl" style={position} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeCalendar(); }
      if (event.key === "Tab") {
        const buttons = calendar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="上个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg p-1.5 hover:bg-slate-100"><ChevronLeft size={17}/></button><b aria-live="polite" className="text-sm">{month.getFullYear()} 年 {month.getMonth() + 1} 月</b><button type="button" aria-label="下个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg p-1.5 hover:bg-slate-100"><ChevronRight size={17}/></button></div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">{weekdays.map((day) => <span key={day} className="py-1 text-slate-400">{day}</span>)}{cells.map((day, index) => day < 1 ? <span key={`blank-${index}`}/> : (() => { const dateKey = `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}`; return <button key={dateKey} data-date={dateKey} type="button" aria-label={dateKey} aria-pressed={selectedDate === dateKey} onKeyDown={(event) => {
        const offset = ({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];
        if (offset === undefined) return;
        event.preventDefault();
        const next = new Date(month.getFullYear(), month.getMonth(), day + offset);
        const nextKey = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
        if (next.getMonth() === month.getMonth() && next.getFullYear() === month.getFullYear()) calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${nextKey}"]`)?.focus();
        else { pendingFocus.current = nextKey; setMonth(new Date(next.getFullYear(), next.getMonth(), 1)); }
      }} onClick={() => { onChange(`${dateKey}T${hour}:${minute}`); closeCalendar(); }} className={`h-8 rounded-lg text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${selectedDate === dateKey ? "bg-blue-600 font-semibold text-white" : dateKey === todayKey ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700 hover:bg-slate-100"}`}>{day}</button>; })())}</div>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-2"><button type="button" onClick={() => { onChange(`${todayKey}T${hour}:${minute}`); closeCalendar(); }} className="rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50">选择今天</button><button type="button" onClick={closeCalendar} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"><X size={13}/>关闭</button></div>
    </div>, document.body) : null}
  </fieldset>;
}
