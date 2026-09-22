"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle, PencilLine, Send, SkipForward } from "lucide-react";
import { AppDialog, ConfirmDialog, DialogActions } from "@/components/ui/app-dialog";
import { AppFilterBar, AppResetButton, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";

type Normalized = {
  sku: string; name_zh: string; name_en: string; brand: string; model: string;
  part_type: string; quality: string; color: string; packaging: string;
  description_zh: string; description_en: string; aliases: string[]; unit: string;
  minimum_order_quantity: number; procurement_cny: number | null;
  packaging_cny: number | null; other_cost_cny: number | null; sale_usd: number | null;
};
type Row = { id: string; source_sheet: string; source_row: number; source_cell: string; source_values: unknown[]; normalized_data: Normalized; status: string; issues: string[] };
type Batch = { id: string; file_name: string; source_name: string; status: string; sheet_count: number; source_row_count: number; candidate_count: number; valid_count: number; review_count: number; error_count: number; published_count: number; summary: { sheets?: Array<{ name: string; source_rows: number; candidates: number; mode: string }> } };
type Payload = { batch: Batch; data: Row[]; count: number; can_edit: boolean; can_publish: boolean };
type BulkAction = "CONFIRM" | "SKIP";

const statusLabel: Record<string, string> = { REVIEW: "待核对", VALID: "校验通过", ERROR: "错误", SKIPPED: "已跳过", PUBLISHED: "已发布" };
const numericKeys = new Set<keyof Normalized>(["minimum_order_quantity", "procurement_cny", "packaging_cny", "other_cost_cny", "sale_usd"]);
const editFields: Array<[keyof Normalized, string]> = [
  ["sku", "供应商货号（选填）"], ["name_zh", "中文名称 *"], ["name_en", "英文名称"],
  ["brand", "品牌"], ["model", "型号"], ["part_type", "产品类型"], ["quality", "品质等级"],
  ["color", "颜色"], ["packaging", "包装规格"], ["unit", "单位"],
  ["minimum_order_quantity", "最小起订量"], ["procurement_cny", "采购价（CNY）"],
  ["packaging_cny", "包装费（CNY）"], ["other_cost_cny", "其他成本（CNY）"],
  ["sale_usd", "销售参考价（USD）"],
];

function money(value: number | null | undefined, currency: string) {
  return value === null || value === undefined ? "未识别" : `${currency ? `${currency} ` : ""}${Number(value).toFixed(2)}`;
}

export function ProductImportReviewView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Normalized | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), status, sheet });
    const response = await fetch(`/api/product-imports/${id}?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || "导入核对数据加载失败"); else setData(body);
    setSelected([]); setLoading(false);
  }, [id, page, pageSize, status, sheet]);
  useEffect(() => { void load(); }, [load]);

  const selectableIds = useMemo(() => (data?.data || []).filter((row) => !["PUBLISHED", "SKIPPED"].includes(row.status)).map((row) => row.id), [data]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((rowId) => selected.includes(rowId));

  function edit(row: Row) {
    setEditing(row);
    setForm({ ...row.normalized_data, packaging_cny: row.normalized_data.packaging_cny ?? 0, other_cost_cny: row.normalized_data.other_cost_cny ?? 0, aliases: [...(row.normalized_data.aliases || [])] });
  }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || !form) return; setBusy(true);
    const response = await fetch(`/api/product-imports/${id}/rows/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ normalized_data: form }) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(body.error || "导入行保存失败"); return; }
    setEditing(null); await load();
  }

  async function skip(row: Row) {
    setBusy(true);
    const response = await fetch(`/api/product-imports/${id}/rows/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SKIP" }) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(body.error || "跳过失败"); return; }
    await load();
  }

  async function applyBulk() {
    if (!bulkAction || !selected.length) return;
    const action = bulkAction; setBusy(true);
    const response = await fetch(`/api/product-imports/${id}/rows`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids: selected }) });
    const body = await response.json().catch(() => ({})); setBusy(false); setBulkAction(null);
    if (!response.ok) { setError(body.error || "批量处理失败"); return; }
    if (action === "CONFIRM" && body.updated < body.requested) setError(`已确认 ${body.updated} 条；另有 ${body.requested - body.updated} 条仍存在字段或价格异常，请逐条核对。`);
    await load();
  }

  async function publish() {
    setBusy(true);
    const response = await fetch(`/api/product-imports/${id}/publish`, { method: "POST" });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(body.error || "发布失败"); setPublishOpen(false); return; }
    setPublishOpen(false); await load();
  }

  const batch = data?.batch;
  return <main className="p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href="/products/import" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600"><ArrowLeft size={16} />返回导入批次</Link>
        <h1 className="text-2xl font-bold text-slate-900">产品报价表核对</h1>
        <p className="mt-1 text-sm text-slate-500">{batch?.file_name || "正在加载"} · SKU 由系统发布时自动生成，来源货号仅用于匹配和追溯。</p>
      </div>
      {batch && data?.can_publish && batch.status !== "PUBLISHED" ? <button disabled={batch.review_count > 0 || batch.error_count > 0 || busy} onClick={() => setPublishOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send size={17} />发布商品与价格</button> : null}
    </header>

    {batch ? <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[["原始非空行", batch.source_row_count], ["识别候选", batch.candidate_count], ["校验通过", batch.valid_count], ["待核对", batch.review_count], ["错误", batch.error_count], ["已发布", batch.published_count]].map(([label, value]) => <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><small className="text-slate-500">{label}</small><b className="mt-2 block text-2xl text-slate-900">{Number(value).toLocaleString("zh-CN")}</b></article>)}</section> : null}

    {batch?.summary?.sheets?.length ? <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm"><summary className="cursor-pointer font-medium text-blue-700">查看工作表识别对账（{batch.summary.sheets.length}个）</summary><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{batch.summary.sheets.map((item) => <div key={item.name} className="rounded-lg bg-slate-50 p-3"><b>{item.name}</b><small className="mt-1 block text-slate-500">原始非空行 {item.source_rows} · 候选 {item.candidates} · {item.mode === "TABULAR" ? "明细表识别" : item.mode === "MATRIX" ? "矩阵识别，必须复核" : "无价格候选"}</small></div>)}</div></details> : null}

    <AppFilterBar>
      <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={appFieldClass}><option value="">全部核对状态</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select value={sheet} onChange={(event) => { setSheet(event.target.value); setPage(1); }} className={appFieldClass}><option value="">全部工作表</option>{batch?.summary?.sheets?.map((item) => <option key={item.name} value={item.name}>{item.name}（{item.candidates}）</option>)}</select>
      <AppResetButton onClick={() => { setStatus(""); setSheet(""); setPage(1); }} />
      {data?.can_edit ? <div className="ml-auto flex items-center gap-2"><span className="text-sm text-slate-500">已选 {selected.length} 条</span><button disabled={!selected.length || busy} onClick={() => setBulkAction("CONFIRM")} className="h-9 rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-700 disabled:opacity-40">批量确认</button><button disabled={!selected.length || busy} onClick={() => setBulkAction("SKIP")} className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 disabled:opacity-40">批量跳过</button></div> : null}
    </AppFilterBar>
    {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p> : null}

    <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1540px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-12 px-4 py-3 text-center"><input type="checkbox" aria-label="全选本页可处理候选" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? selectableIds : [])} /></th>{["来源", "系统 SKU / 来源货号", "商品名称", "品牌 / 型号", "类型 / 品质", "完整成本", "美元参考价", "核对结果", "操作"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead>
        <tbody>{loading ? <tr><td colSpan={10} className="h-56 text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600" /></td></tr> : data?.data.length ? data.data.map((row) => {
          const normalized = row.normalized_data;
          const completeCost = normalized.procurement_cny === null ? null : Number(normalized.procurement_cny) + Number(normalized.packaging_cny || 0) + Number(normalized.other_cost_cny || 0);
          const canSelect = data.can_edit && !["PUBLISHED", "SKIPPED"].includes(row.status);
          return <tr key={row.id} className="border-t align-middle">
            <td className="px-4 py-3 text-center"><input type="checkbox" aria-label={`选择${normalized.name_zh || "候选"}`} disabled={!canSelect} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((item) => item !== row.id))} /></td>
            <td className="px-4 py-3"><b>{row.source_sheet}</b><small className="mt-1 block text-slate-500">第{row.source_row}行 · {row.source_cell || "—"}</small></td>
            <td className="px-4 py-3"><b className="text-blue-700">发布时自动生成</b><small className="mt-1 block text-slate-500">来源货号：{normalized.sku || "无"}</small></td>
            <td className="px-4 py-3">{normalized.name_zh || "待核对"}<small className="mt-1 block text-slate-500">{normalized.name_en || "—"}</small></td>
            <td className="px-4 py-3">{normalized.brand || "—"}<small className="mt-1 block text-slate-500">{normalized.model || "—"}</small></td>
            <td className="px-4 py-3">{normalized.part_type || "—"}<small className="mt-1 block text-slate-500">{normalized.quality || "—"}</small></td>
            <td className="px-4 py-3 font-medium">{money(completeCost, "CNY")}<small className="mt-1 block font-normal text-slate-500">采购 {money(normalized.procurement_cny, "")} · 包装 {money(normalized.packaging_cny ?? 0, "")} · 其他 {money(normalized.other_cost_cny ?? 0, "")}</small></td>
            <td className="px-4 py-3 font-medium">{normalized.sale_usd === null ? "未设置" : money(normalized.sale_usd, "USD")}</td>
            <td className="max-w-80 px-4 py-3"><AppStatusBadge status={row.status}>{statusLabel[row.status] || row.status}</AppStatusBadge>{row.issues?.length ? <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-700">{row.issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul> : <small className="mt-2 block text-emerald-700"><CheckCircle2 size={14} className="mr-1 inline" />字段校验通过</small>}</td>
            <td className="px-4 py-3"><div className="flex gap-2">{canSelect ? <><button onClick={() => edit(row)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-blue-700 hover:bg-slate-50"><PencilLine size={15} />核对</button><button disabled={busy} onClick={() => void skip(row)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-slate-600 hover:bg-slate-50"><SkipForward size={15} />跳过</button></> : "—"}</div></td>
          </tr>;
        }) : <tr><td colSpan={10} className="h-56 text-center text-slate-400">当前条件下暂无导入候选</td></tr>}</tbody>
      </table></div>
      <AppPagination page={page} pageSize={pageSize} total={data?.count || 0} itemLabel="条导入候选" onPage={setPage} onPageSize={(next) => { setPageSize(next); setPage(1); }} />
    </section>

    <AppDialog open={Boolean(editing && form)} onClose={() => !busy && setEditing(null)} title="核对产品候选" description={editing ? `来源：${editing.source_sheet} 第${editing.source_row}行 ${editing.source_cell || ""}` : ""} width="max-w-5xl">
      {form ? <form onSubmit={save}><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{editFields.map(([key, label]) => <label key={key} className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span><input required={key === "name_zh"} type={numericKeys.has(key) ? "number" : "text"} min={numericKeys.has(key) ? 0 : undefined} step={numericKeys.has(key) ? 0.001 : undefined} value={form[key] === null ? "" : String(form[key])} onChange={(event) => setForm({ ...form, [key]: numericKeys.has(key) ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value } as Normalized)} className={`${appFieldClass} w-full`} /></label>)}</div><div className="mt-4 grid gap-4 md:grid-cols-2"><label><span className="mb-1.5 block text-sm font-medium text-slate-700">中文内部描述</span><textarea rows={3} value={form.description_zh || ""} onChange={(event) => setForm({ ...form, description_zh: event.target.value })} className="w-full rounded-lg border border-slate-200 p-3 text-sm" /></label><label><span className="mb-1.5 block text-sm font-medium text-slate-700">英文客户描述</span><textarea rows={3} value={form.description_en || ""} onChange={(event) => setForm({ ...form, description_en: event.target.value })} className="w-full rounded-lg border border-slate-200 p-3 text-sm" /></label></div><details className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><summary className="cursor-pointer font-medium">查看原始行内容</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(editing?.source_values, null, 2)}</pre></details><DialogActions busy={busy} onCancel={() => setEditing(null)} confirmLabel="保存核对结果" /></form> : null}
    </AppDialog>
    <ConfirmDialog open={bulkAction !== null} title={bulkAction === "SKIP" ? "批量跳过候选" : "批量确认候选"} description={bulkAction === "SKIP" ? `将跳过所选 ${selected.length} 条候选，发布时不会写入商品资料。` : `将校验并确认所选 ${selected.length} 条候选；仍有字段或价格异常的数据会继续保留为待核对。`} confirmLabel={bulkAction === "SKIP" ? "确认跳过" : "确认通过"} busy={busy} onCancel={() => setBulkAction(null)} onConfirm={() => void applyBulk()} />
    <ConfirmDialog open={publishOpen} title="发布商品与价格" description={`本批次 ${batch?.valid_count || 0} 条已校验候选将写入正式商品及价格主档。系统 SKU 自动生成；同一来源及来源货号会匹配现有商品并新增价格版本，保留来源和审计记录。`} confirmLabel="确认发布" busy={busy} onCancel={() => setPublishOpen(false)} onConfirm={() => void publish()} />
  </main>;
}
