"use client";

export function AppTabs<T extends string>({ value, items, onChange, label }: {
  value: T; items: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void; label: string;
}) {
  return <nav aria-label={label} className="flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
    {items.map((item) => <button key={item.value} type="button" onClick={() => onChange(item.value)} aria-current={value === item.value ? "page" : undefined} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition ${value === item.value ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>{item.label}{item.count !== undefined ? <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">{item.count}</span> : null}</button>)}
  </nav>;
}
