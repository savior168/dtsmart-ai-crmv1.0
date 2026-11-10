"use client";

import { useCallback, useEffect, useState } from "react";
import { AppDialog, ConfirmDialog } from "@/components/ui/app-dialog";
import { AppPagination } from "@/components/ui/app-pagination";
import { isHalfMonthSettlement, settlementDisplay } from "@/lib/suppliers/settlement";

type Supplier = {
  id: string; system_code: string; legacy_code: string | null; short_name: string | null;
  english_short_name: string | null; main_products: string | null;
  settlement_cycle: string; settlement_days: number | null;
  settlement_terms_original: string | null; cooperation_note: string | null;
  after_sales_note: string | null; price_advantage_note: string | null; is_active: boolean;
  private_contacts?: PrivateContact[];
};
type Draft = {
  id?: string; system_code: string; legacy_code: string; short_name: string;
  english_short_name: string; main_products: string; settlement_cycle: string;
  settlement_days: string; settlement_terms_original: string; cooperation_note: string;
  after_sales_note: string; price_advantage_note: string; is_active: boolean;
};
type PrivateContact = { id: string; kind: "PHONE" | "WECHAT"; value: string };
const emptyDraft: Draft = { system_code: "", legacy_code: "", short_name: "", english_short_name: "",
  main_products: "", settlement_cycle: "", settlement_days: "",
  settlement_terms_original: "", cooperation_note: "", after_sales_note: "",
  price_advantage_note: "", is_active: true };
const cycleLabels: Record<string, string> = { CASH: "现金结", WEEKLY: "周结", SEMI_MONTHLY: "半月结（15天）",
  MONTHLY: "月结", NET_DAYS: "其他固定天数", OTHER: "其他", UNSET: "待补充" };
type SortKey = "system_code" | "short_name" | "english_short_name" | "settlement_cycle" | "main_products";
const supplierCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const supplierColumns: { label: string; sortKey?: SortKey }[] = [
  { label: "供应商代码", sortKey: "system_code" }, { label: "供应商名称", sortKey: "short_name" },
  { label: "英文简称", sortKey: "english_short_name" }, { label: "商务条件", sortKey: "settlement_cycle" },
  { label: "主供产品", sortKey: "main_products" }, { label: "售后服务" },
  { label: "合作程度" }, { label: "优势" }, { label: "操作" },
];

export function SuppliersView({ canManage, isAdmin }: { canManage: boolean; isAdmin: boolean }) {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [cycleFilter, setCycleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<SortKey>("system_code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deactivating, setDeactivating] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [contactSupplier, setContactSupplier] = useState<Supplier | null>(null);
  const [contacts, setContacts] = useState<PrivateContact[]>([]);
  const [contactKind, setContactKind] = useState<PrivateContact["kind"]>("PHONE");
  const [contactValue, setContactValue] = useState("");
  const [contactError, setContactError] = useState("");
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
  const filtered = rows.filter((row) => (cycleFilter === "ALL" || (cycleFilter === "SEMI_MONTHLY"
    ? isHalfMonthSettlement(row.settlement_cycle, row.settlement_days)
    : cycleFilter === "NET_DAYS" ? row.settlement_cycle === "NET_DAYS" && row.settlement_days !== 15
    : row.settlement_cycle === cycleFilter))
    && (statusFilter === "ALL" || row.is_active === (statusFilter === "ACTIVE"))
    && [row.system_code, row.short_name, row.english_short_name, row.main_products,
      row.settlement_terms_original, row.cooperation_note, row.after_sales_note, row.price_advantage_note]
      .some((value) => String(value || "").toLowerCase().includes(query.trim().toLowerCase())))
    .sort((left, right) => {
      const value = (row: Supplier) => sortKey === "settlement_cycle"
        ? settlementDisplay(row.settlement_cycle, row.settlement_days, row.settlement_terms_original)
        : String(row[sortKey] || "");
      const compared = supplierCollator.compare(value(left), value(right)) || supplierCollator.compare(left.system_code, right.system_code);
      return sortDirection === "asc" ? compared : -compared;
    });
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  function toggleSort(key: SortKey) {
    setSortDirection((current) => sortKey === key && current === "asc" ? "desc" : "asc");
    setSortKey(key);
    setPage(1);
  }
  function edit(row: Supplier) {
    setDraft({ id: row.id, system_code: row.system_code, legacy_code: row.legacy_code || "",
      short_name: row.short_name || "", english_short_name: row.english_short_name || "",
      main_products: row.main_products || "", settlement_cycle: isHalfMonthSettlement(row.settlement_cycle, row.settlement_days) ? "SEMI_MONTHLY" : row.settlement_cycle,
      settlement_days: isHalfMonthSettlement(row.settlement_cycle, row.settlement_days) || row.settlement_days === null ? "" : String(row.settlement_days),
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
  async function removeSupplier() {
    if (!deleting || busy) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/suppliers/${deleting.id}?permanent=true`, { method: "DELETE" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "删除失败；请改用停用"); setDeleting(null); return; }
    setDeleting(null);
    await load();
  }
  async function openContacts(supplier: Supplier) {
    if (!isAdmin) return;
    setContactSupplier(supplier); setContactError(""); setContacts([]);
    const response = await fetch(`/api/admin/suppliers/${supplier.id}/contacts`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) { setContactError(body.error || "联系方式加载失败"); return; }
    setContacts(body.data || []);
  }
  async function addContact() {
    if (!contactSupplier || !contactValue.trim() || busy) return;
    setBusy(true); setContactError("");
    const response = await fetch(`/api/admin/suppliers/${contactSupplier.id}/contacts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: contactKind, value: contactValue }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setContactError(body.error || "联系方式保存失败"); return; }
    setContacts((current) => [...current, body.data]);
    setRows((current) => current.map((row) => row.id === contactSupplier.id
      ? { ...row, private_contacts: [...(row.private_contacts || []), body.data] } : row));
    setContactValue("");
  }
  async function changeContact(contact: PrivateContact, remove = false) {
    if (!contactSupplier || busy) return;
    setBusy(true); setContactError("");
    const response = await fetch(`/api/admin/suppliers/${contactSupplier.id}/contacts/${contact.id}`, {
      method: remove ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" },
      ...(remove ? {} : { body: JSON.stringify({ value: contact.value }) }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setContactError(body.error || "联系方式操作失败"); return; }
    setContacts((current) => remove ? current.filter((item) => item.id !== contact.id)
      : current.map((item) => item.id === contact.id ? body.data : item));
    setRows((current) => current.map((row) => row.id === contactSupplier.id ? {
      ...row, private_contacts: remove
        ? (row.private_contacts || []).filter((item) => item.id !== contact.id)
        : (row.private_contacts || []).map((item) => item.id === contact.id ? body.data : item),
    } : row));
  }
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold">供应商档案</h1><p className="mt-1 text-sm text-slate-600">已有供应商代码直接沿用；仅无代码的现金结供应商自动生成 CASH 编号。</p></div>
      {canManage ? <button onClick={() => setDraft({ ...emptyDraft })} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">新增供应商</button> : null}</div>
    <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4"><div className="flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1 text-sm text-slate-600">搜索供应商代码、名称、产品或评价
      <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
      <label className="text-sm text-slate-600">商务条件<select value={cycleFilter} onChange={(event) => { setCycleFilter(event.target.value); setPage(1); }} className="mt-1 block h-10 rounded-lg border bg-white px-3"><option value="ALL">全部商务条件</option>{Object.entries(cycleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="text-sm text-slate-600">档案状态<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="mt-1 block h-10 rounded-lg border bg-white px-3"><option value="ALL">全部状态</option><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>
      <button type="button" onClick={() => { setQuery(""); setCycleFilter("ALL"); setStatusFilter("ALL"); setPage(1); }} className="h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">重置</button></div></div>
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <p className="border-b px-4 py-3 text-xs text-slate-500">{loading ? "正在加载…" : `当前 ${filtered.length} 家 · 全部 ${rows.length} 家 · 启用 ${rows.filter((row) => row.is_active).length} 家 · 现金结 ${rows.filter((row) => row.settlement_cycle === "CASH").length} 家`}</p>
      {error && !draft ? <p role="alert" className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className={`w-full table-fixed text-left text-sm ${isAdmin ? "min-w-[1760px]" : "min-w-[1500px]"}`}>
          <colgroup><col className="w-[130px]"/><col className="w-[160px]"/><col className="w-[130px]"/><col className="w-[125px]"/><col className="w-[270px]"/><col className="w-[115px]"/><col className="w-[210px]"/><col className="w-[228px]"/>{isAdmin ? <><col className="w-[150px]"/><col className="w-[150px]"/></> : null}<col className="w-[220px]"/></colgroup>
          <thead className="bg-slate-50 text-slate-600"><tr className="border-b">{supplierColumns.filter((column) => column.label !== "操作").map((column) => <th key={column.label} scope="col" aria-sort={column.sortKey ? sortKey === column.sortKey ? sortDirection === "asc" ? "ascending" : "descending" : "none" : undefined} className="whitespace-nowrap px-3 py-3">{column.sortKey ? <button type="button" onClick={() => { if (column.sortKey) toggleSort(column.sortKey); }} className="inline-flex items-center gap-1 hover:text-blue-700" aria-label={`${column.label}排序`}>{column.label}<span aria-hidden="true" className={sortKey === column.sortKey ? "text-blue-600" : "text-slate-400"}>{sortKey === column.sortKey ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button> : column.label}</th>)}{isAdmin ? <><th scope="col" className="px-3 py-3">电话</th><th scope="col" className="px-3 py-3">微信</th></> : null}<th scope="col" className="sticky right-0 z-10 bg-slate-50 px-3 py-3">操作</th></tr></thead>
          <tbody>{visible.map((row) => <tr key={row.id} className="group border-b last:border-0 hover:bg-slate-50/60">
            <td className="whitespace-nowrap px-3 py-3 font-medium">{row.system_code}{!row.is_active ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">停用</span> : null}</td>
            <td className="truncate px-3 py-3" title={row.short_name || ""}>{row.short_name || "—"}</td>
            <td className="truncate px-3 py-3" title={row.english_short_name || ""}>{row.english_short_name || "—"}</td>
            <td className="truncate px-3 py-3" title={settlementDisplay(row.settlement_cycle, row.settlement_days, row.settlement_terms_original)}>{settlementDisplay(row.settlement_cycle, row.settlement_days, row.settlement_terms_original)}</td>
            <td className="truncate px-3 py-3" title={row.main_products || ""}>{row.main_products || "—"}</td>
            <td className="truncate px-3 py-3" title={row.after_sales_note || ""}>{row.after_sales_note || "—"}</td>
            <td className="truncate px-3 py-3" title={row.cooperation_note || ""}>{row.cooperation_note || "—"}</td>
            <td className="truncate px-3 py-3" title={row.price_advantage_note || ""}>{row.price_advantage_note || "—"}</td>
            {isAdmin ? (["PHONE", "WECHAT"] as const).map((kind) => {
              const values = (row.private_contacts || []).filter((contact) => contact.kind === kind).map((contact) => contact.value);
              return <td key={kind} className="px-3 py-3"><button type="button" onClick={() => void openContacts(row)} title={values.join("、") || "点击添加"} className="block w-full truncate text-left text-xs text-blue-700 hover:underline">{values.length ? `${values[0]}${values.length > 1 ? ` · +${values.length - 1}` : ""}` : "+ 添加"}</button></td>;
            }) : null}
            <td className="sticky right-0 z-10 whitespace-nowrap bg-white px-3 py-3 group-hover:bg-slate-50"><div className="flex items-center gap-1">{canManage ? <><button type="button" onClick={() => edit(row)} className="rounded-md border px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">编辑</button>{row.is_active ? <button type="button" onClick={() => setDeactivating(row)} className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">停用</button> : null}<button type="button" onClick={() => setDeleting(row)} className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">删除</button></> : null}{!canManage && !isAdmin ? <span className="text-slate-400">—</span> : null}</div></td>
          </tr>)}</tbody>
        </table>
        {!loading && !filtered.length ? <p className="py-8 text-center text-sm text-slate-500">没有匹配的供应商</p> : null}
      </div>
      <AppPagination page={page} pageSize={pageSize} total={filtered.length} itemLabel="家供应商" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
    </div>
    <AppDialog open={draft !== null} title={draft?.id ? "编辑供应商" : "新增供应商"} description="已有 PI 或送货单关联时供应商代码不可修改；商务条件可按最新约定调整，新条件仅用于后续回货，历史送货单保留记录时条件。" onClose={() => { if (!busy) { setDraft(null); setError(""); } }}>
      {draft ? <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3 text-sm"><div className="grid gap-3 sm:grid-cols-2">
        <label>供应商代码{draft.settlement_cycle === "CASH" ? "（无代码时自动生成）" : "（必填）"}<input required={draft.settlement_cycle !== "CASH"} value={draft.system_code} placeholder={draft.settlement_cycle === "CASH" ? "已有代码请填写；留空自动生成" : "填写供应商代码"} onChange={(event) => field("system_code", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>英文简称<input value={draft.english_short_name} onChange={(event) => field("english_short_name", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>主供产品（必填）<input required value={draft.main_products} onChange={(event) => field("main_products", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>商务条件（必填）<select required value={draft.settlement_cycle} onChange={(event) => setDraft((current) => current && { ...current, settlement_cycle: event.target.value, settlement_days: "", settlement_terms_original: cycleLabels[event.target.value] || "" })} className="mt-1 h-10 w-full rounded border px-3"><option value="" disabled>请选择结算方式</option>{Object.entries(cycleLabels).filter(([code]) => code !== "UNSET" || draft.id).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>
        {draft.settlement_cycle === "NET_DAYS" ? <label>账期天数（非15天）<input type="number" min={1} max={365} required value={draft.settlement_days} onChange={(event) => field("settlement_days", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label> : null}
        <label>供应商名称<input value={draft.short_name} onChange={(event) => field("short_name", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>合作程度<input value={draft.cooperation_note} onChange={(event) => field("cooperation_note", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>售后服务<input value={draft.after_sales_note} onChange={(event) => field("after_sales_note", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
        <label>价格优势<input value={draft.price_advantage_note} onChange={(event) => field("price_advantage_note", event.target.value)} className="mt-1 h-10 w-full rounded border px-3"/></label>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.is_active} onChange={(event) => field("is_active", event.target.checked)}/>启用供应商（停用档案保留历史送货单）</label>
      {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => setDraft(null)} className="rounded border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{busy ? "保存中…" : "保存档案"}</button></div></form> : null}
    </AppDialog>
    <ConfirmDialog open={deactivating !== null} title="停用供应商？" description={`停用 ${deactivating?.system_code || ""} 后不可用于新回货，已有送货单和对账记录不受影响。`} confirmLabel="确认停用" busy={busy} onCancel={() => setDeactivating(null)} onConfirm={() => void deactivate()}/>
    <ConfirmDialog open={deleting !== null} title="删除供应商档案？" description={`仅从未关联送货单、备货行且无联系方式的档案可删除。${deleting?.system_code || ""} 若已有关联，系统会拒绝删除，请改用停用。`} confirmLabel="确认删除" danger busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void removeSupplier()}/>
    <AppDialog open={contactSupplier !== null} title={`供应商 ${contactSupplier?.system_code || ""} · 联系方式`} description="仅系统管理员可查看和维护，其他角色不会收到联系方式数据。" onClose={() => { if (!busy) setContactSupplier(null); }}>
      <div className="space-y-3">{contacts.map((contact) => <div key={contact.id} className="flex items-center gap-2"><span className="w-12 shrink-0 text-sm text-slate-600">{contact.kind === "PHONE" ? "电话" : "微信"}</span><input aria-label={`${contact.kind === "PHONE" ? "电话" : "微信"}联系方式`} value={contact.value} onChange={(event) => setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, value: event.target.value } : item))} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><button type="button" disabled={busy} onClick={() => void changeContact(contact)} className="text-sm text-blue-700">保存</button><button type="button" disabled={busy} onClick={() => void changeContact(contact, true)} className="text-sm text-rose-700">删除</button></div>)}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3"><select aria-label="联系方式类型" value={contactKind} onChange={(event) => setContactKind(event.target.value as PrivateContact["kind"])} className="rounded-lg border px-3 py-2 text-sm"><option value="PHONE">电话</option><option value="WECHAT">微信</option></select><input aria-label="新增联系方式" value={contactValue} onChange={(event) => setContactValue(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="输入电话或微信号"/><button type="button" disabled={busy || !contactValue.trim()} onClick={() => void addContact()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">添加</button></div>
        {contactError ? <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{contactError}</p> : null}</div>
    </AppDialog>
  </div></main>;
}

