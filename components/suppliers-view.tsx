"use client";

import { useCallback, useEffect, useState } from "react";
import { AppDialog, ConfirmDialog } from "@/components/ui/app-dialog";

type Supplier = {
  id: string; system_code: string; legacy_code: string | null; short_name: string | null;
  english_short_name: string | null; main_products: string | null;
  settlement_cycle: string; settlement_days: number | null;
  settlement_terms_original: string | null; cooperation_note: string | null;
  after_sales_note: string | null; price_advantage_note: string | null; is_active: boolean;
};
type Draft = {
  id?: string; system_code: string; legacy_code: string; short_name: string;
  english_short_name: string; main_products: string; settlement_cycle: string;
  settlement_days: string; settlement_terms_original: string; cooperation_note: string;
  after_sales_note: string; price_advantage_note: string; is_active: boolean;
};
const emptyDraft: Draft = { system_code: "", legacy_code: "", short_name: "", english_short_name: "",
  main_products: "", settlement_cycle: "", settlement_days: "",
  settlement_terms_original: "", cooperation_note: "", after_sales_note: "",
  price_advantage_note: "", is_active: true };
const cycleLabels: Record<string, string> = { CASH: "现金结", WEEKLY: "周结", SEMI_MONTHLY: "半月结",
  MONTHLY: "月结", NET_DAYS: "按天账期", OTHER: "其他", UNSET: "待补充" };

export function SuppliersView({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deactivating, setDeactivating] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all: Supplier[] = [];
      for (let page = 1; page <= 10000; page++) {
        const response = await fetch(`/api/suppliers?page=${page}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "供应商档案加载失败");
        all.push(...(body.data || []));
        if (all.length >= body.count || !(body.data || []).length) break;
      }
      setRows(all);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "供应商档案加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = rows.filter((row) => [row.system_code, row.legacy_code,
    row.short_name, row.english_short_name, row.main_products]
    .some((value) => String(value || "").toLowerCase().includes(query.trim().toLowerCase())));
  function edit(row: Supplier) {
    setDraft({ id: row.id, system_code: row.system_code, legacy_code: row.legacy_code || "",
      short_name: row.short_name || "", english_short_name: row.english_short_name || "",
      main_products: row.main_products || "", settlement_cycle: row.settlement_cycle,
      settlement_days: row.settlement_days === null ? "" : String(row.settlement_days),
      settlement_terms_original: row.settlement_terms_original || "",
      cooperation_note: row.cooperation_note || "", after_sales_note: row.after_sales_note || "",
      price_advantage_note: row.price_advantage_note || "", is_active: row.is_active });
  }
  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current && { ...current, [key]: value });
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError("");
    const response = await fetch(draft.id ? `/api/suppliers/${draft.id}` : "/api/suppliers", {
      method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "供应商档案保存失败"); return; }
    setDraft(null);
    await load();
  }
  async function deactivate() {
    if (!deactivating || busy) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/suppliers/${deactivating.id}`, { method: "DELETE" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "停用失败"); return; }
    setDeactivating(null);
    await load();
  }
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold">供应商档案</h1><p className="mt-1 text-sm text-slate-600">已有供应商代码直接沿用；仅无代码的现金结供应商自动生成 CASH 编号。</p></div>
      {canManage ? <button onClick={() => setDraft({ ...emptyDraft })} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">新增供应商</button> : null}</div>
    <div className="rounded-xl border bg-white p-4"><label className="text-sm text-slate-600">搜索供应商代码、历史代码、名称或产品
      <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 h-10 w-full max-w-md rounded-lg border px-3" /></label>
      <p className="mt-2 text-xs text-slate-500">{loading ? "正在加载…" : `共 ${filtered.length} 家；停用档案保留历史送货单与对账记录。`}</p>
      {error && !draft ? <p role="alert" className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[840px] text-left text-sm"><thead><tr className="border-b bg-slate-50 text-slate-600"><th className="p-3">系统代码</th><th>原代码</th><th>供应商</th><th>主供产品</th><th>商务条件</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="p-3 font-medium">{row.system_code}</td><td>{row.legacy_code || "—"}</td><td>{row.short_name || row.english_short_name || "未填写"}</td><td className="max-w-64 truncate" title={row.main_products || ""}>{row.main_products || "—"}</td><td>{cycleLabels[row.settlement_cycle] || row.settlement_cycle}{row.settlement_days ? ` ${row.settlement_days} 天` : ""}</td><td>{row.is_active ? <span className="text-emerald-700">启用</span> : <span className="text-slate-500">停用</span>}</td><td>{canManage ? <div className="flex gap-3"><button onClick={() => edit(row)} className="text-blue-700">编辑</button>{row.is_active ? <button onClick={() => setDeactivating(row)} className="text-rose-700">停用</button> : null}</div> : "—"}</td></tr>)}</tbody></table>{!loading && !filtered.length ? <p className="py-8 text-center text-sm text-slate-500">没有匹配的供应商</p> : null}</div>
    </div>
    <AppDialog open={draft !== null} title={draft?.id ? "编辑供应商" : "新增供应商"} description="已关联送货单的系统代码与结算类型不可直接修改；可停用旧档案并新建。" onClose={() => { if (!busy) { setDraft(null); setError(""); } }}>
      {draft ? <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3 text-sm"><div className="grid gap-3 sm:grid-cols-2">
        <label>商务条件（必填）<select required value={draft.settlement_cycle} onChange={(event) => setDraft((current) => current && { ...current, settlement_cycle: event.target.value, settlement_days: event.target.value === "NET_DAYS" ? "15" : "" })} className="mt-1 h-10 w-full rounded border px-3"><option value="" disabled>请选择结算方式</option>{Object.entries(cycleLabels).filter(([code]) => code !== "UNSET" || draft.id).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>
        <label>供应商代码{draft.settlement_cycle === "CASH" ? "（无代码时自动生成）" : "（必填）"}<input required={draft.settlement_cycle !== "CASH"} value={draft.system_code} placeholder={draft.settlement_cycle === "CASH" ? "已有代码请填写；留空自动生成" : "填写供应商代码"} onChange={(event) => field("system_code", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>原代码<input value={draft.legacy_code} onChange={(event) => field("legacy_code", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>供应商简称<input value={draft.short_name} onChange={(event) => field("short_name", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>英文简称<input value={draft.english_short_name} onChange={(event) => field("english_short_name", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        {draft.settlement_cycle === "NET_DAYS" ? <label>账期天数（如 15 天）<input required type="number" min={1} max={365} value={draft.settlement_days} onChange={(event) => field("settlement_days", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label> : null}
      </div>
      <label className="block">主供产品（必填）<input required value={draft.main_products} onChange={(event) => field("main_products", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
      <label className="block">原结算说明<input value={draft.settlement_terms_original} onChange={(event) => field("settlement_terms_original", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.is_active} onChange={(event) => field("is_active", event.target.checked)}/>启用供应商（停用档案保留历史送货单）</label>
      {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setDraft(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{busy ? "保存中…" : "保存档案"}</button></div></form> : null}
    </AppDialog>
    <ConfirmDialog open={deactivating !== null} title="停用供应商？" description={`停用 ${deactivating?.system_code || ""} 后不可用于新回货，已有送货单和对账记录不受影响。`} confirmLabel="确认停用" busy={busy} onCancel={() => setDeactivating(null)} onConfirm={() => void deactivate()}/>
  </div></main>;
}
