"use client";

import { CalendarRange } from "lucide-react";

export function CompactDateRange({
  from,
  to,
  onFromChange,
  onToChange,
  label = "日期范围",
  fromLabel = "开始日期",
  toLabel = "结束日期",
  className = "",
  presets,
  selectedPreset = "",
  onPresetChange,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
  className?: string;
  presets?: ReadonlyArray<{ value: string; label: string; title?: string }>;
  selectedPreset?: string;
  onPresetChange?: (value: string) => void;
}) {
  return (
    <fieldset
      className={`flex h-10 min-w-0 shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-sm text-slate-700 transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 ${className}`}
      title={label}
    >
      <legend className="sr-only">{label}</legend>
      <CalendarRange aria-hidden="true" size={15} className="ml-2.5 shrink-0 text-slate-400" />
      <span className="ml-1.5 shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <input
        type="date"
        aria-label={fromLabel}
        value={from}
        max={to || undefined}
        onChange={(event) => onFromChange(event.target.value)}
        className="h-full min-w-0 w-[122px] border-0 bg-transparent px-2 text-sm outline-none"
      />
      <span aria-hidden="true" className="shrink-0 text-slate-300">—</span>
      <input
        type="date"
        aria-label={toLabel}
        value={to}
        min={from || undefined}
        onChange={(event) => onToChange(event.target.value)}
        className="h-full min-w-0 w-[122px] border-0 bg-transparent px-2 text-sm outline-none"
      />
      {presets?.length && onPresetChange ? <>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-slate-200" />
        <select aria-label={`${label}快捷范围`} value={selectedPreset} onChange={(event) => onPresetChange(event.target.value)} className="h-full max-w-[100px] shrink-0 border-0 bg-transparent px-2 text-xs font-medium text-blue-700 outline-none">
          <option value="">自定义</option>
          {presets.map((preset) => <option key={preset.value} value={preset.value} title={preset.title}>{preset.label}</option>)}
        </select>
      </> : null}
    </fieldset>
  );
}
