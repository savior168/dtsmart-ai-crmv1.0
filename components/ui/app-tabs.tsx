"use client";

export function AppTabs<T extends string>({ value, items, onChange, label }: {
  value: T; items: readonly { value: T; label: string; description?: string; count?: number; countTone?: "success" | "warning" | "danger" }[]; onChange: (value: T) => void; label: string;
}) {
  return <nav aria-label={label} className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
    {items.map((item) => { const active=value===item.value; const countClass=item.countTone === "danger" ? "bg-rose-50 text-rose-700 ring-rose-200" : item.countTone === "warning" ? "bg-amber-50 text-amber-700 ring-amber-200" : item.countTone === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : active ? "bg-white text-blue-700 ring-blue-200" : "bg-slate-50 text-slate-500 ring-slate-200"; return <button key={item.value} type="button" onClick={() => onChange(item.value)} aria-current={active ? "page" : undefined} className={`relative flex min-h-11 min-w-max shrink-0 items-center gap-3 rounded-lg border px-4 py-2 text-left transition ${active ? "border-blue-200 bg-blue-50/90 text-blue-800 shadow-sm" : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"}`}><span className="min-w-0"><span className="block text-sm font-semibold">{item.label}</span>{item.description ? <span className={`mt-0.5 block max-w-64 text-xs ${active ? "text-blue-600" : "text-slate-400"}`}>{item.description}</span> : null}</span>{item.count !== undefined ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${countClass}`}>{item.count}</span> : null}{active ? <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-blue-500"/> : null}</button>})}
  </nav>;
}
