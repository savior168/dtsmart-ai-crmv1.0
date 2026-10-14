"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle, PencilLine, Send, SkipForward, Split } from "lucide-react";
import { AppDialog, ConfirmDialog, DialogActions } from "@/components/ui/app-dialog";
import { AppFilterBar, AppResetButton, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
import { PRODUCT_SPECIFICATION_FIELDS, type ProductFamily } from "@/lib/product-specifications";
import { PRODUCT_IMPORT_PARSER_VERSION } from "@/lib/product-import-version";

type Normalized = {
  import_mode?: "PRODUCT_ONLY" | "MIXED"; category_code?: string;
  sku: string; supplier_identifier: string; category_id: string; specifications: Record<string, string>; name_zh: string; name_en: string; brand: string; model: string;
  part_type: string; quality: string; color: string; packaging: string;
  description_zh: string; description_en: string; aliases: string[]; unit: string;
  minimum_order_quantity: number; procurement_cny: number | null;
  packaging_cny: number | null; other_cost_cny: number | null; sale_usd: number | null;
};
type Row = { id: string; source_sheet: string; source_row: number; source_cell: string; source_variant: number; source_excerpt: string | null; source_values: unknown[]; normalized_data: Normalized; status: string; issues: string[] };
type Batch = { id: string; file_name: string; source_name: string; parser_version: string; status: string; sheet_count: number; source_row_count: number; candidate_count: number; valid_count: number; review_count: number; error_count: number; published_count: number; summary: { parser_version?: string; sheets?: Array<{ name: string; source_rows: number; candidates: number; unparsed_cells?: number; unparsed_addresses?: string[]; mode: string }>; uncovered_sheets?: string[] } };
type Payload = { batch: Batch; data: Row[]; categories: Array<{id:string;name_zh:string;product_family:ProductFamily;is_active:boolean}>; count: number; can_edit: boolean; can_publish: boolean };
type BulkAction = "CONFIRM" | "SKIP" | "SET_CATEGORY";

const statusLabel: Record<string, string> = { REVIEW: "待核对", VALID: "校验通过", ERROR: "错误", SKIPPED: "已跳过", PUBLISHED: "已发布" };
const numericKeys = new Set<keyof Normalized>(["minimum_order_quantity", "procurement_cny", "packaging_cny", "other_cost_cny", "sale_usd"]);
const priceKeys = new Set<keyof Normalized>(["procurement_cny", "packaging_cny", "other_cost_cny", "sale_usd"]);
const editFields: Array<[keyof Normalized, string]> = [
  ["supplier_identifier", "供应商编号（来源表顶部代码）"], ["sku", "供应商商品货号（仅逐行提供时填写）"], ["name_zh", "中文名称 *"], ["name_en", "英文名称"],
  ["brand", "品牌"], ["model", "型号"], ["part_type", "产品类型"], ["quality", "品质等级"],
  ["color", "颜色"], ["packaging", "包装规格"], ["unit", "单位"],
  ["minimum_order_quantity", "最小起订量"], ["procurement_cny", "采购价（CNY）"],
  ["packaging_cny", "包装费（CNY）"], ["other_cost_cny", "其他成本（CNY）"],
  ["sale_usd", "销售参考价（USD）"],
];

function money(value: number | null | undefined, currency: string) {
  return value === null || value === undefined ? "未识别" : `${currency ? `${currency} ` : ""}${Number(value).toFixed(2)}`;
}

function excelColumn(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) { value -= 1; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
}

function originalCellText(row: Row) {
  const letters = row.source_cell.match(/^[A-Z]+/)?.[0] || "";
  const column = [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  return column ? String(row.source_values[column - 1] ?? "") : "";
}

export function ProductImportReviewView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Normalized | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [splitRow, setSplitRow] = useState<Row | null>(null);
  const [splitCompleteRow, setSplitCompleteRow] = useState<Row | null>(null);
  const [splitExcerpt, setSplitExcerpt] = useState("");
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), status, sheet });
      const response = await fetch(`/api/product-imports/${id}?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (version !== loadVersion.current) return;
      if (!response.ok) { setData(null); setError(body.error || "导入核对数据加载失败"); }
      else setData(body);
    } catch {
      if (version === loadVersion.current) { setData(null); setError("导入核对数据加载失败，请检查网络后重试"); }
    } finally {
      if (version === loadVersion.current) { setSelected([]); setLoading(false); }
    }
  }, [id, page, pageSize, status, sheet]);
  useEffect(() => { void load(); }, [load]);

  const selectableIds = useMemo(() => (data?.can_edit && ["REVIEW", "READY"].includes(data.batch.status) ? data.data : []).filter((row) => !["PUBLISHED", "SKIPPED"].includes(row.status) && !row.issues?.some((issue) => issue.includes("原始整格尚有待核对内容"))).map((row) => row.id), [data]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((rowId) => selected.includes(rowId));
  const publishableIds = useMemo(() => (data?.data || []).filter((row) => row.status === "VALID" && selected.includes(row.id)).map((row) => row.id), [data, selected]);

  function edit(row: Row) {
    setEditing(row);
    setForm({ ...row.normalized_data, specifications: { ...(row.normalized_data.specifications || {}) }, aliases: [...(row.normalized_data.aliases || [])] });
  }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || !form) return; setBusy(true);
    try {
      const response = await fetch(`/api/product-imports/${id}/rows/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ normalized_data: form }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "导入行保存失败"); return; }
      setEditing(null); await load();
    } catch { setError("导入行保存失败，请检查网络后重试"); }
    finally { setBusy(false); }
  }

  async function skip(row: Row) {
    setBusy(true);
    try {
      const response = await fetch(`/api/product-imports/${id}/rows/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SKIP", confirm_split_complete: splitCompleteRow?.id === row.id }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "跳过失败"); return; }
      setSplitCompleteRow(null); await load();
    } catch { setError("跳过失败，请检查网络后重试"); }
    finally { setBusy(false); }
  }

  async function applyBulk() {
    if (!bulkAction || !selected.length) return;
    if (bulkAction === "SET_CATEGORY" && !bulkCategoryId) { setError("请先选择准确的商品分类"); return; }
    const action = bulkAction; setBusy(true);
    try {
      const response = await fetch(`/api/product-imports/${id}/rows`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids: selected, category_id: action === "SET_CATEGORY" ? bulkCategoryId : undefined }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "批量处理失败"); return; }
      setBulkAction(null); await load();
      if (action === "CONFIRM" && body.updated < body.requested) setError(`已确认 ${body.updated} 条；另有 ${body.requested - body.updated} 条仍存在字段或价格异常，请逐条核对。`);
    } catch { setError("批量处理失败，请检查网络后重试"); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!publishableIds.length) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/product-imports/${id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ row_ids: publishableIds }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "发布失败"); setPublishOpen(false); return; }
      setPublishOpen(false); await load();
    } catch { setError("发布结果未确认，请刷新核对已发布数量后再重试"); setPublishOpen(false); }
    finally { setBusy(false); }
  }

  async function splitCell(event: FormEvent) {
    event.preventDefault();
    if (!splitRow || !splitExcerpt.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/product-imports/${id}/rows/${splitRow.id}/split`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excerpt: splitExcerpt.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "拆分失败"); return; }
      setSplitRow(null); setSplitExcerpt(""); await load();
    } catch { setError("拆分结果未确认，请刷新核对来源行后再重试"); }
    finally { setBusy(false); }
  }

  const batch = data?.batch;
  const family = data?.categories.find((category) => category.id === form?.category_id)?.product_family || "OTHER";
  return <main className="p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href="/products/import" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600"><ArrowLeft size={16} />返回导入批次</Link>
        <h1 className="text-2xl font-bold text-slate-900">产品报价表核对</h1>
        <p className="mt-1 text-sm text-slate-500">{batch?.file_name || "正在加载"} · 核对记录含尚未拆解的数字线索，不等于商品数；SKU 由系统发布时自动生成。</p>
      </div>
      {batch && data?.can_publish && ["REVIEW", "READY"].includes(batch.status) ? <button disabled={!publishableIds.length || publishableIds.length > 100 || busy || loading} onClick={() => setPublishOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send size={17} />发布已核准（{publishableIds.length}）</button> : null}
    </header>

    {batch ? <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[["原始非空行", batch.source_row_count], ["核对记录（非商品数）", batch.candidate_count], ["校验通过", batch.valid_count], ["待核对", batch.review_count], ["错误", batch.error_count], ["已发布", batch.published_count]].map(([label, value]) => <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><small className="text-slate-500">{label}</small><b className="mt-2 block text-2xl text-slate-900">{Number(value).toLocaleString("zh-CN")}</b></article>)}</section> : null}

    {batch && (batch.parser_version !== PRODUCT_IMPORT_PARSER_VERSION || batch.summary?.parser_version !== PRODUCT_IMPORT_PARSER_VERSION) ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">该批次由旧版解析器生成，来源行列坐标可能有误，已禁止发布。请重新上传原文件生成新版批次，再按真实 Excel 单元格逐项核对。</p> : null}

    {batch?.summary?.uncovered_sheets?.length ? <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">以下工作表仍有未完整识别的来源内容，不能整批发布：{batch.summary.uncovered_sheets.join("、")}。仅可勾选已逐条核准的记录分批发布；未核准原文继续隔离，核对记录不等于商品数。</p> : null}
    {batch?.summary?.sheets?.length ? <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm"><summary className="cursor-pointer font-medium text-blue-700">查看工作表识别对账（{batch.summary.sheets.length}个）</summary><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{batch.summary.sheets.map((item) => <div key={item.name} className="rounded-lg bg-slate-50 p-3"><b>{item.name}</b><small className="mt-1 block text-slate-500">原始非空行 {item.source_rows} · {item.mode === "MATRIX" ? "待拆解数字线索" : "核对记录"} {item.candidates}{item.unparsed_cells?` · 未解析单元格/行 ${item.unparsed_cells}`:""} · {item.mode === "TABULAR" ? "明细表识别" : item.mode === "MATRIX" ? "矩阵未拆解，禁止发布" : item.mode === "SOURCE_REVIEW" ? "专用结构识别，必须复核" : item.mode === "REFERENCE" ? "参考说明，不作为商品" : "有内容但无候选，禁止发布"}</small>{item.unparsed_addresses?.length?<small className="mt-1 block text-rose-700">待处理源单元格或行起点：{item.unparsed_addresses.slice(0,12).join("、")}{item.unparsed_addresses.length>12?` 等 ${item.unparsed_addresses.length} 处`:""}</small>:null}</div>)}</div></details> : null}

    <AppFilterBar>
      <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={appFieldClass}><option value="">全部核对状态</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select value={sheet} onChange={(event) => { setSheet(event.target.value); setPage(1); }} className={appFieldClass}><option value="">全部工作表</option>{batch?.summary?.sheets?.map((item) => <option key={item.name} value={item.name}>{item.name}（{item.candidates}）</option>)}</select>
      <AppResetButton onClick={() => { setStatus(""); setSheet(""); setPage(1); }} />
      {data?.can_edit && ["REVIEW", "READY"].includes(batch?.status || "") ? <div className="ml-auto flex flex-wrap items-center gap-2"><span className="text-sm text-slate-500">已选 {selected.length} 条</span><select aria-label="批量设置商品分类" value={bulkCategoryId} onChange={event=>setBulkCategoryId(event.target.value)} className={appFieldClass}><option value="">选择商品分类</option>{data.categories.filter(item=>item.is_active).map(item=><option key={item.id} value={item.id}>{item.name_zh}</option>)}</select><button disabled={!selected.length || !bulkCategoryId || busy} onClick={() => setBulkAction("SET_CATEGORY")} className="h-9 rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-700 disabled:opacity-40">批量设分类</button><button disabled={!selected.length || busy} onClick={() => setBulkAction("CONFIRM")} className="h-9 rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-700 disabled:opacity-40">批量确认</button><button disabled={!selected.length || busy} onClick={() => setBulkAction("SKIP")} className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 disabled:opacity-40">批量跳过</button></div> : null}
    </AppFilterBar>
    {error ? <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span>{error}</span><button type="button" onClick={() => void load()} className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 font-medium">重新加载</button></div> : null}

    <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1540px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-12 px-4 py-3 text-center"><input type="checkbox" aria-label="全选本页可处理候选" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? selectableIds : [])} /></th>{["来源", "系统 SKU / 来源货号", "商品名称", "品牌 / 型号", "类型 / 品质", "完整成本", "美元参考价", "核对结果", "操作"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead>
        <tbody>{loading ? <tr><td colSpan={10} className="h-56 text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600" /></td></tr> : data?.data.length ? data.data.map((row) => {
          const normalized = row.normalized_data;
          const completeCost = [normalized.procurement_cny, normalized.packaging_cny, normalized.other_cost_cny].every((value) => value !== null && value !== undefined)
            ? Number(normalized.procurement_cny) + Number(normalized.packaging_cny) + Number(normalized.other_cost_cny) : null;
          const splitParent = row.issues?.some((issue) => issue.includes("原始整格尚有待核对内容"));
          const canSelect = data.can_edit && ["REVIEW", "READY"].includes(batch?.status || "") && !["PUBLISHED", "SKIPPED"].includes(row.status) && !splitParent;
          const canSplit = data.can_edit && ["REVIEW", "READY"].includes(batch?.status || "") && row.source_variant === 1 && !row.source_excerpt && ["REVIEW", "ERROR"].includes(row.status) && Boolean(originalCellText(row));
          return <tr key={row.id} className="border-t align-middle">
            <td className="px-4 py-3 text-center"><input type="checkbox" aria-label={`选择${normalized.name_zh || "候选"}`} disabled={!canSelect} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((item) => item !== row.id))} /></td>
            <td className="px-4 py-3"><b>{row.source_sheet}</b><small className="mt-1 block text-slate-500">第{row.source_row}行 · {row.source_cell || "—"}{row.source_variant > 1 ? ` · 拆分${row.source_variant}` : ""}</small>{row.source_excerpt ? <small className="mt-1 block max-w-60 break-words text-amber-700">原文片段：{row.source_excerpt}</small> : null}</td>
            <td className="px-4 py-3"><b className="text-blue-700">发布时自动生成</b><small className="mt-1 block text-slate-500">供应商编号：{normalized.supplier_identifier || "未提供"}</small><small className="mt-1 block text-slate-500">单品货号：{normalized.sku || "未提供"}</small></td>
            <td className="max-w-72 px-4 py-3">{normalized.name_zh || "待拆解原文"}<small className="mt-1 block break-words text-slate-500">{normalized.name_zh ? (normalized.name_en || "—") : (normalized.description_zh || "请查看原始行")}</small></td>
            <td className="px-4 py-3">{normalized.brand || "—"}<small className="mt-1 block text-slate-500">{normalized.model || "—"}</small></td>
            <td className="px-4 py-3">{normalized.part_type || "—"}<small className="mt-1 block text-slate-500">{normalized.quality || "—"}</small></td>
            <td className="px-4 py-3 font-medium">{completeCost === null ? "成本待补齐" : money(completeCost, "CNY")}<small className="mt-1 block font-normal text-slate-500">采购 {money(normalized.procurement_cny, "")} · 包装 {money(normalized.packaging_cny, "")} · 其他 {money(normalized.other_cost_cny, "")}</small></td>
            <td className="px-4 py-3 font-medium">{normalized.sale_usd === null ? "未设置" : money(normalized.sale_usd, "USD")}</td>
            <td className="max-w-80 px-4 py-3"><AppStatusBadge status={row.status}>{statusLabel[row.status] || row.status}</AppStatusBadge>{row.issues?.length ? <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-700">{row.issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul> : <small className="mt-2 block text-emerald-700"><CheckCircle2 size={14} className="mr-1 inline" />字段校验通过</small>}</td>
            <td className="px-4 py-3"><div className="flex gap-2">{canSelect ? <><button onClick={() => edit(row)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-blue-700 hover:bg-slate-50"><PencilLine size={15} />核对</button><button disabled={busy} onClick={() => void skip(row)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-slate-600 hover:bg-slate-50"><SkipForward size={15} />跳过</button></> : null}{canSplit ? <button disabled={busy} onClick={() => { setSplitRow(row); setSplitExcerpt(""); }} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-blue-700 hover:bg-slate-50"><Split size={15} />{splitParent ? "继续拆分" : "拆分"}</button> : null}{splitParent ? <button disabled={busy} onClick={() => setSplitCompleteRow(row)} className="inline-flex h-9 items-center rounded-lg border border-amber-200 px-3 font-medium text-amber-800 hover:bg-amber-50">完成拆分</button> : null}{!canSelect && !canSplit && !splitParent ? "—" : null}</div></td>
          </tr>;
        }) : <tr><td colSpan={10} className="h-56 text-center text-slate-400">当前条件下暂无导入候选</td></tr>}</tbody>
      </table></div>
      <AppPagination page={page} pageSize={pageSize} total={data?.count || 0} itemLabel="条核对记录" onPage={setPage} onPageSize={(next) => { setPageSize(next); setPage(1); }} />
    </section>

    <AppDialog open={Boolean(editing && form)} onClose={() => !busy && setEditing(null)} title="核对产品候选" description={editing ? `来源：${editing.source_sheet} 第${editing.source_row}行 ${editing.source_cell || ""}` : ""} width="max-w-5xl">
      {form ? <form onSubmit={save}>
        <label className="mb-4 block"><span className="mb-1.5 block text-sm font-medium text-slate-700">商品分类 *</span><select required value={form.category_id||""} onChange={(event)=>{const next=event.target.value;const nextFamily=data?.categories.find(item=>item.id===next)?.product_family||"OTHER";setForm({...form,category_id:next,specifications:nextFamily===family?form.specifications:{}})}} className={`${appFieldClass} w-full`}><option value="">请选择准确分类</option>{data?.categories.filter(item=>item.is_active||item.id===form.category_id).map(item=><option key={item.id} value={item.id}>{item.name_zh}</option>)}</select></label>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{editFields.filter(([key]) => form.import_mode !== "PRODUCT_ONLY" || !priceKeys.has(key)).map(([key, label]) => <label key={key} className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span><input required={key === "name_zh"} type={numericKeys.has(key) ? "number" : "text"} min={numericKeys.has(key) ? 0 : undefined} step={numericKeys.has(key) ? 0.001 : undefined} value={form[key] == null ? "" : String(form[key])} onChange={(event) => setForm({ ...form, [key]: numericKeys.has(key) ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value } as Normalized)} className={`${appFieldClass} w-full`} /></label>)}</div>
        {PRODUCT_SPECIFICATION_FIELDS[family].length?<section className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-semibold text-slate-800">按品类核对可交付规格</h3><p className="mt-1 text-xs text-slate-500">逐项对照原始单元格；空白表示来源未证实，不能由机型或价格猜测。</p><div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{PRODUCT_SPECIFICATION_FIELDS[family].map(field=><label key={field.key} className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{field.label}</span><input value={form.specifications[field.key]||""} onChange={event=>setForm({...form,specifications:{...form.specifications,[field.key]:event.target.value}})} className={`${appFieldClass} w-full`} maxLength={300}/>{field.hint?<small className="mt-1 block text-slate-500">{field.hint}</small>:null}</label>)}</div></section>:null}
        <div className="mt-4 grid gap-4 md:grid-cols-2"><label><span className="mb-1.5 block text-sm font-medium text-slate-700">中文内部描述</span><textarea rows={3} value={form.description_zh || ""} onChange={(event) => setForm({ ...form, description_zh: event.target.value })} className="w-full rounded-lg border border-slate-200 p-3 text-sm" /></label><label><span className="mb-1.5 block text-sm font-medium text-slate-700">英文客户描述</span><textarea rows={3} value={form.description_en || ""} onChange={(event) => setForm({ ...form, description_en: event.target.value })} className="w-full rounded-lg border border-slate-200 p-3 text-sm" /></label></div><details className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><summary className="cursor-pointer font-medium">查看原始行内容与单元格地址</summary><p className="mt-2">当前识别来源：{editing?.source_cell || "未标记"}。请将型号、品质和价格与同一来源行的单元格逐项对照。</p><div className="mt-2 grid gap-1 sm:grid-cols-2">{editing?.source_values.map((value,index)=>String(value??"").trim()?<p key={index} className="break-words rounded bg-white px-2 py-1"><b className="mr-2 text-blue-700">{excelColumn(index)}{editing.source_row}</b>{String(value)}</p>:null)}</div></details><DialogActions busy={busy} onCancel={() => setEditing(null)} confirmLabel="保存核对结果" /></form> : null}
    </AppDialog>
    <AppDialog open={Boolean(splitRow)} onClose={() => !busy && setSplitRow(null)} title="拆分同一单元格的商品线索" description={splitRow ? `${splitRow.source_sheet} · ${splitRow.source_cell}。新记录默认待核对，须逐项确认后才能发布。` : ""} width="max-w-2xl">
      <form onSubmit={(event) => void splitCell(event)}>
        <p className="mb-3 text-sm text-slate-600">从下方原文中复制一段对应单件商品的完整描述或报价。原整格会留在待核对，直到您逐项拆分完并明确确认结束；仅核准的拆分记录可先分批发布。保留真实单元格地址，不自动推断型号或价格。</p>
        <div className="mb-4 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{splitRow ? originalCellText(splitRow) : ""}</div>
        <label className="block text-sm font-medium text-slate-700">原文片段<input required minLength={2} maxLength={1000} value={splitExcerpt} onChange={(event) => setSplitExcerpt(event.target.value)} className={`${appFieldClass} mt-1.5 w-full`} /></label>
        <DialogActions busy={busy} onCancel={() => setSplitRow(null)} confirmLabel="创建待核对记录" />
      </form>
    </AppDialog>
    <ConfirmDialog open={splitCompleteRow !== null} title="确认整格拆分已完成" description={splitCompleteRow ? `请核对 ${splitCompleteRow.source_sheet} ${splitCompleteRow.source_cell} 的全部原文均已拆分或明确不作为商品。确认后原整格将标为已跳过，未拆分的内容不会生成商品；已拆分记录仍需分别核准。` : ""} confirmLabel="确认完成拆分" busy={busy} onCancel={() => setSplitCompleteRow(null)} onConfirm={() => { if (splitCompleteRow) void skip(splitCompleteRow); }} />
    <ConfirmDialog open={bulkAction !== null} title={bulkAction === "SKIP" ? "批量跳过候选" : bulkAction === "SET_CATEGORY" ? "批量设置商品分类" : "批量确认候选"} description={bulkAction === "SKIP" ? `将跳过所选 ${selected.length} 条候选，发布时不会写入商品资料。` : bulkAction === "SET_CATEGORY" ? `将所选 ${selected.length} 条候选设置为“${data?.categories.find(item=>item.id===bulkCategoryId)?.name_zh||"未选择"}”。分类后仍为待核对，原有其他品类专有规格会清空，必须逐项复核来源与售价。` : `仅来源结构明确的明细表可批量确认；矩阵和专用结构必须逐项核对。所选 ${selected.length} 条中仍有字段或价格异常的会继续保留为待核对。`} confirmLabel={bulkAction === "SKIP" ? "确认跳过" : bulkAction === "SET_CATEGORY" ? "确认设分类" : "确认通过"} busy={busy} onCancel={() => setBulkAction(null)} onConfirm={() => void applyBulk()} />
    <ConfirmDialog open={publishOpen} title="分批发布已核准商品与价格" description={`本页所选 ${publishableIds.length} 条已核准记录将写入正式商品及价格主档。其他待核对、错误及未解析来源继续隔离；本次记录有冲突则全部回滚。请确认来源、规格和价格均已逐格核对。`} confirmLabel="确认发布所选" busy={busy} onCancel={() => setPublishOpen(false)} onConfirm={() => void publish()} />
  </main>;
}
