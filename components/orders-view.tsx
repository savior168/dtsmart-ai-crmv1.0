"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardList, LoaderCircle, Search } from "lucide-react";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/types";
import { UserScopeSelect } from "@/components/user-scope-select";
import { AppFilterBar, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppSelect } from "@/components/ui/app-select";
import { QUOTE_CURRENCIES } from "@/lib/currencies";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";
import { ConfirmDialog } from "@/components/ui/app-dialog";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { CountryLabel } from "@/components/country-label";
import { downloadFilteredExport } from "@/lib/ui/download-filtered-export";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";
import { StockProgressCell } from "@/components/stock-progress-cell";
import { PI_EXECUTING_STATUSES, piOrderStatusLabel } from "@/lib/stock-progress";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import type { StockProgress } from "@/lib/stock-progress";
import { batchExportFilename, documentExportFilename } from "@/lib/export-file-name";
type StockLink = { id: string; stock_number: string; status: string; progress: StockProgress };
const CURRENT_PI_STATUSES = ["DRAFT", "ACTIVE", "SHIPPED", "SHORTAGE", "CANCELLED"] as const;
const HISTORICAL_PI_STATUSES: SalesOrderStatus[] = ["CONFIRMED", "STOCK_DRAFT", "READY"];
type Row = {
  id: string;
  order_number: string;
  warehouse_reference_number: string | null;
  quote_number: string;
  confirmation_method: string | null;
  pi_revision: number;
  can_delete_draft: boolean;
  customer_short_name: string;
  destination_country: string | null;
  currency: string;
  total_amount: number;
  status: SalesOrderStatus;
  delivery_date: string | null;
  updated_at: string;
  created_at: string;
  owner?: { name?: string | null; email?: string } | null;
  creator?: { name?: string | null; email?: string } | null;
  stock?: StockLink | StockLink[] | null;
};
export function OrdersView() {
  const router = useRouter();
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [currency, setCurrency] = useState("");
  const [country, setCountry] = useState("");
  const [type, setType] = useState("PI");
  const [sortBy, setSortBy] = useState("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userId, setUserId] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [canFilterCreator, setCanFilterCreator] = useState(false);
  const [canViewStock, setCanViewStock] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [singleExportId, setSingleExportId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  async function exportSelected() {
    if (exportBusy || !canExport || type !== "PI" || !selectedIds.length) return;
    setExportBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ export: "1", type, sort_by: sortBy, sort_dir: sortDir });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (currency) params.set("currency", currency);
      if (country) params.set("country", country);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (userId) params.set("user_id", userId);
      if (creatorId) params.set("creator_id", creatorId);
      selectedIds.forEach((id) => params.append("id", id));
      await downloadFilteredExport(`/api/orders?${params}`, batchExportFilename("PI订单", "zip"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PI订单导出失败");
    } finally {
      setExportBusy(false);
    }
  }
  async function exportOne(row: Row) {
    if (singleExportId) return;
    setSingleExportId(row.id);
    setError("");
    try {
      await downloadFilteredExport(`/api/orders/${row.id}/export`, documentExportFilename(row.order_number, "PI订单", "xlsx"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PI订单导出失败，请稍后重试");
    } finally {
      setSingleExportId(null);
    }
  }
  async function deleteDraft() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/orders/${deleting.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: deleting.pi_revision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "删除PI草稿失败");
      setDeleting(null);
      if (data.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除PI草稿失败");
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (currency) p.set("currency", currency);
    if (country) p.set("country", country);
    if (type) p.set("type", type);
    p.set("sort_by", sortBy);
    p.set("sort_dir", sortDir);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (userId) p.set("user_id", userId);
    if (creatorId) p.set("creator_id", creatorId);
    const r = await fetch(`/api/orders?${p}`, { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) {
      setError(b.error || "加载失败");
      return;
    }
    setData(b.data || []);
    setCount(Number(b.count || 0));
    setCanFilterCreator(Boolean(b.can_filter_creator));
    setCanViewStock(Boolean(b.can_view_stock));
    setCanCreate(Boolean(b.can_create));
    setCanImport(Boolean(b.can_import));
    setCanExport(Boolean(b.can_export));
    setError("");
  }, [page, pageSize, q, status, currency, country, type, sortBy, sortDir, dateFrom, dateTo, userId, creatorId]);
  useEffect(() => { setSelectedIds([]); }, [q, status, currency, country, type, dateFrom, dateTo, userId, creatorId]);
  const selectableIds = data.filter((row) => row.confirmation_method === "DIRECT_PI" && !["DRAFT", "CANCELLED"].includes(row.status)).map((row) => row.id);
  const pageSelection = selectableIds.slice(0, 50);
  const allPageSelected = pageSelection.length > 0 && pageSelection.every((id) => selectedIds.includes(id));
  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 50 ? [...current, id] : current);
  }
  function togglePageSelection() {
    setSelectedIds((current) => pageSelection.every((id) => current.includes(id))
      ? current.filter((id) => !pageSelection.includes(id))
      : [...current, ...pageSelection.filter((id) => !current.includes(id)).slice(0, 50 - current.length)]);
  }
  function toggleSort(key: string) {
    setSortDir(sortBy === key && sortDir === "asc" ? "desc" : "asc");
    setSortBy(key);
    setPage(1);
  }
  function SortHeader({ label, column }: { label: string; column: string }) {
    return <th aria-sort={sortBy === column ? sortDir === "asc" ? "ascending" : "descending" : "none"} className="px-4 py-3 font-medium">
      <button type="button" onClick={() => toggleSort(column)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-blue-700">{label}{sortBy === column ? sortDir === "asc" ? <ArrowUp size={13}/> : <ArrowDown size={13}/> : <ArrowUpDown size={13} className="text-slate-400"/>}</button>
    </th>;
  }
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1660px]">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">PI订单</h1><div className="flex items-center gap-2">{canImport ? <Link href="/orders/import" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">导入PI订单</Link> : null}{canCreate ? <Link href="/orders/new" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">创建PI订单</Link> : null}</div></div>
          <p className="mt-1 text-sm text-slate-500">
            先保存PI草稿，确认后才生成仓库可见的备货单；历史销售订单继续保留查询。
          </p>
        </header>
        <AppFilterBar>
          <label className="relative min-w-64 flex-1 xl:min-w-[320px]">
            <Search
              className="absolute left-3 top-3 text-slate-400"
              size={17}
            />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="搜索订单编号、PI号或公司名称"
              className={`${appFieldClass} w-full pl-9`}
            />
          </label>
          <AppSelect
            value={CURRENT_PI_STATUSES.includes(status as typeof CURRENT_PI_STATUSES[number]) ? status : ""}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className={appFieldClass}
            aria-label="按订单状态筛选"
          >
            <option value="">全部订单状态</option>
            {CURRENT_PI_STATUSES.map((k) => (
              <option key={k} value={k}>
                {k === "ACTIVE" ? "已提交仓库（执行中）" : piOrderStatusLabel(k)}
              </option>
            ))}
          </AppSelect>
          <AppSelect value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }} className={appFieldClass} aria-label="按目的国家筛选" forceSearch>
            <option value="">全部目的国家</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
          </AppSelect>
          <AppSelect value={currency} onChange={(e) => { setCurrency(e.target.value); setPage(1); }} className={appFieldClass} aria-label="按付款币种筛选" forceSearch>
            <option value="">全部付款币种</option>{QUOTE_CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
          </AppSelect>
          <CompactDateRange label="创建日期" fromLabel="创建开始日期" toLabel="创建结束日期" from={dateFrom} to={dateTo} onFromChange={(value) => { setDateFrom(value); setPage(1); }} onToChange={(value) => { setDateTo(value); setPage(1); }}/>
          <UserScopeSelect permission="orders.data_all" value={userId} onChange={(value) => { setUserId(value); setPage(1); }} className={`${appFieldClass} min-w-52`} filterLabel="所属销售员" custom/>
          {canFilterCreator ? <UserScopeSelect permission="orders.data_all" kind="pi_creator" value={creatorId} onChange={(value) => { setCreatorId(value); setPage(1); }} className={`${appFieldClass} min-w-52`} filterLabel="制单人" allLabel="全部制单人" custom/> : null}
          <details className="relative text-sm">
            <summary className="flex h-10 cursor-pointer items-center rounded-lg border bg-white px-3 text-slate-600">{HISTORICAL_PI_STATUSES.includes(status as SalesOrderStatus) ? `历史/异常：${SALES_ORDER_STATUS_LABELS[status as SalesOrderStatus]}` : "历史/异常筛选"}</summary>
            <div className="absolute left-0 top-11 z-30 w-52 rounded-lg border bg-white p-2 shadow-lg">
              <AppSelect value={HISTORICAL_PI_STATUSES.includes(status as SalesOrderStatus) ? status : ""} onChange={(e) => { setStatus(e.target.value); setType(e.target.value ? "" : "PI"); setPage(1); }} className={`${appFieldClass} w-full`} aria-label="按历史或异常PI状态筛选">
                <option value="">不筛选</option>{HISTORICAL_PI_STATUSES.map((key) => <option key={key} value={key}>{SALES_ORDER_STATUS_LABELS[key]}</option>)}
              </AppSelect>
            </div>
          </details>
          <AppSelect value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={appFieldClass} aria-label="按订单类型筛选">
            <option value="PI">PI订单</option><option value="">包含历史销售订单</option>
          </AppSelect>
          <button
            onClick={() => {
              setQ("");
              setStatus("");
              setCurrency("");
              setCountry("");
              setType("PI");
              setSortBy("updated_at");
              setSortDir("desc");
              setDateFrom("");
              setDateTo("");
              setUserId("");
              setCreatorId("");
              setPage(1);
            }}
            className="h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 xl:ml-auto"
          >
            重置
          </button>
        </AppFilterBar>
        {canExport ? <div className="mt-3 flex flex-wrap items-center justify-end gap-2"><span className="text-xs text-slate-500">勾选指定正式 PI；可跨页选择，最多 50 张</span><RowActionMenu ariaLabel={`批量导出 PI，已选 ${selectedIds.length} 张`} label={`批量导出（${selectedIds.length}张）`}><RowActionItem disabled={exportBusy || type !== "PI" || selectedIds.length === 0} onClick={() => void exportSelected()}>{exportBusy ? "正在导出…" : "导出 Excel"}</RowActionItem><RowActionItem disabled={exportBusy || type !== "PI" || selectedIds.length === 0} onClick={() => window.open(`/orders/batch-preview?${selectedIds.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`, "_blank", "noopener,noreferrer")}>导出 PDF</RowActionItem></RowActionMenu></div> : null}
        {error ? (
          <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <section className="mt-4 overflow-hidden rounded-xl border bg-white">
          {loading ? (
            <div className="grid min-h-52 place-items-center">
              <LoaderCircle className="animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1650px] text-left text-sm">
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    {canExport ? <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="选择本页可导出的PI订单，最多50张" checked={allPageSelected} disabled={!pageSelection.length || type !== "PI" || (selectedIds.length >= 50 && !pageSelection.some((id) => selectedIds.includes(id)))} onChange={togglePageSelection} className="size-4 accent-blue-600"/></th> : null}
                    <SortHeader label="订单编号" column="order_number"/>
                    <th className="px-4 py-3 font-medium">备货单号</th>
                    <SortHeader label="公司名称" column="customer_name"/>
                    <th className="px-4 py-3 font-medium">目的国家</th>
                    <SortHeader label="总金额" column="amount"/>
                    <SortHeader label="状态" column="status"/>
                    <th className="w-[420px] px-4 py-3 font-medium">备货进度</th>
                    <th className="min-w-[96px] whitespace-nowrap px-4 py-3 font-medium">所属销售员</th>
                    <th className="min-w-[96px] whitespace-nowrap px-4 py-3 font-medium">制单人</th>
                    <SortHeader label="更新时间" column="updated_at"/>
                    <SortHeader label="创建时间" column="created_at"/>
                    <th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 font-medium shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => {
                    const stock = Array.isArray(row.stock)
                      ? row.stock[0]
                      : row.stock;
                    const statusLabel = row.confirmation_method === "DIRECT_PI"
                      ? piOrderStatusLabel(row.status) : SALES_ORDER_STATUS_LABELS[row.status];
                    return (
                      <tr key={row.id} onDoubleClick={(event) => { if (canOpenListRow(event.target)) router.push(`/orders/${row.id}`); }} className="group cursor-pointer border-t hover:bg-blue-50/30">
                        {canExport ? <td className="px-3 py-3"><input type="checkbox" aria-label={`选择订单 ${row.warehouse_reference_number || row.order_number}`} checked={selectedIds.includes(row.id)} disabled={!selectableIds.includes(row.id) || (selectedIds.length >= 50 && !selectedIds.includes(row.id))} onChange={() => toggleSelection(row.id)} className="size-4 accent-blue-600"/></td> : null}
                        <td className="px-4 py-3 font-semibold">
                          {row.confirmation_method === "DIRECT_PI" ? row.warehouse_reference_number || "—" : row.order_number}
                          {row.confirmation_method !== "DIRECT_PI" ? <span className="ml-2 text-xs font-normal text-slate-500">历史订单</span> : null}
                        </td>
                        <td className="px-4 py-3 text-xs">{stock ? canViewStock ? <Link href={`/stock-orders/${stock.id}`} className="whitespace-nowrap font-medium text-blue-600 hover:underline" onClick={(event) => event.stopPropagation()} title={row.status === "DRAFT" ? "查看原备货记录" : "查看备货单"}>{stock.stock_number}</Link> : <span className="whitespace-nowrap text-slate-500">{stock.stock_number}</span> : <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-3">{row.customer_short_name}</td>
                        <td className="px-4 py-3"><CountryLabel value={row.destination_country}/></td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-900">
                          {row.currency} {Number(row.total_amount).toFixed(2)}
                        </td>
                        <td className="px-4 py-3"><AppStatusBadge status={row.status} tone={row.confirmation_method === "DIRECT_PI" && (PI_EXECUTING_STATUSES as readonly string[]).includes(row.status) ? "violet" : undefined}>{statusLabel}</AppStatusBadge></td>
                        <td className="px-4 py-3">{row.confirmation_method === "DIRECT_PI" && row.status === "DRAFT"
                          ? <span className="text-xs text-slate-500">{stock ? "已撤回（历史）" : "未提交"}</span>
                          : stock ? <StockProgressCell progress={stock.progress}/> : "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{row.owner?.name || row.owner?.email || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{row.creator?.name || row.creator?.email || "未记录"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(row.updated_at).toLocaleString("zh-CN")}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(row.created_at).toLocaleString("zh-CN")}
                        </td>
                        <td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50">
                          <div className="flex items-center gap-2">
                            <Link href={`/orders/${row.id}`} className="whitespace-nowrap font-medium text-blue-600 hover:underline">查看详情</Link>
                            <RowActionMenu ariaLabel={`订单 ${row.warehouse_reference_number || row.order_number} 的更多操作`} label="更多">
                              {row.confirmation_method === "DIRECT_PI" ? <RowActionItem onClick={() => router.push(`/orders/${row.id}/preview`)}>预览{row.status === "DRAFT" ? "草稿" : " / 打印"}</RowActionItem> : null}
                              {canExport && row.confirmation_method === "DIRECT_PI" && !["DRAFT","CANCELLED"].includes(row.status) ? <><RowActionItem disabled={singleExportId !== null} onClick={() => void exportOne(row)}>{singleExportId === row.id ? "导出中…" : "导出 Excel"}</RowActionItem><RowActionItem onClick={() => window.open(`/orders/${row.id}/preview?export=pdf`, "_blank", "noopener,noreferrer")}>导出 PDF</RowActionItem></> : null}
                              {row.can_delete_draft ? <RowActionItem tone="danger" onClick={() => setDeleting(row)}>删除草稿</RowActionItem> : null}
                            </RowActionMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!data.length ? (
                <div className="grid min-h-52 place-items-center text-sm text-slate-400">
                  <ClipboardList className="mb-2" />
                  暂无销售订单
                </div>
              ) : null}
            </div>
          )}
          <AppPagination page={page} pageSize={pageSize} total={count} itemLabel="张订单" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
        </section>
        <ConfirmDialog open={Boolean(deleting)} title="删除未提交的PI草稿" description={`确认删除订单 ${deleting?.warehouse_reference_number || deleting?.order_number || ""} 及产品明细？仅从未提交仓库的草稿可删除，删除后无法恢复。`} confirmLabel="确认删除" danger busy={deleteBusy} onCancel={() => { if (!deleteBusy) setDeleting(null); }} onConfirm={() => void deleteDraft()}/>
      </div>
    </main>
  );
}
