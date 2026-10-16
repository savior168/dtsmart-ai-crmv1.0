"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, LoaderCircle, Search, ShoppingCart } from "lucide-react";
import { STOCK_STATUS_LABELS, type StockOrderStatus } from "@/lib/types";
import { UserScopeSelect } from "@/components/user-scope-select";
import { AppFilterBar, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppSelect } from "@/components/ui/app-select";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";
import { CountryLabel } from "@/components/country-label";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { downloadFilteredExport } from "@/lib/ui/download-filtered-export";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";
import { StockProgressCell } from "@/components/stock-progress-cell";
import { stockProgressLabel, type StockProgress } from "@/lib/stock-progress";
import { batchExportFilename, documentExportFilename } from "@/lib/export-file-name";

type Row = { id:string; sales_order_id:string; stock_number:string; order_number:string; warehouse_reference_number:string|null; customer_short_name:string; destination_country:string|null; status:StockOrderStatus; progress:StockProgress; status_note:string|null; stocking_requirements:string|null; expected_ready_at:string|null; created_at:string; updated_at:string; sales?:{name?:string|null;email?:string}|null };
type Payload = { data:Row[]; count:number; profile:{role:string}; can_view_all:boolean; can_view_pi:boolean; can_export:boolean };
const CURRENT_STOCK_STATUSES = ["DRAFT", "WAITING", "ACTIVE", "SHIPPED", "SHORTAGE"] as const;
const EXCEPTION_STOCK_STATUSES: StockOrderStatus[] = ["READY", "CANCELLED"];

export function StockOrdersView() {
  const router=useRouter();
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");
  const [country,setCountry]=useState("");
  const [sortBy,setSortBy]=useState("updated_at");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("desc");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [userId,setUserId]=useState("");
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(20);
  const [exportBusy,setExportBusy]=useState(false);
  const [singleExportId,setSingleExportId]=useState<string|null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  async function exportSelected() {
    if(exportBusy||!data?.can_export||!selectedIds.length)return;
    setExportBusy(true);setError("");
    try {
      const params=new URLSearchParams({export:"1",sort_by:sortBy,sort_dir:sortDir});
      if(q.trim())params.set("q",q.trim());if(status)params.set("status",status);if(country)params.set("country",country);if(userId)params.set("user_id",userId);
      if(dateFrom)params.set("date_from",dateFrom);if(dateTo)params.set("date_to",dateTo);
      selectedIds.forEach(id=>params.append("id",id));
      await downloadFilteredExport(`/api/stock-orders?${params}`,batchExportFilename("备货单","zip"));
    } catch(cause) {setError(cause instanceof Error?cause.message:"备货单导出失败")}
    finally {setExportBusy(false)}
  }
  async function exportOne(row:Row) {
    if(singleExportId)return;
    setSingleExportId(row.id);setError("");
    try {await downloadFilteredExport(`/api/stock-orders/${row.id}/export`,documentExportFilename(row.stock_number,"备货单","xlsx"))}
    catch(cause){setError(cause instanceof Error?cause.message:"备货单导出失败，请稍后重试")}
    finally{setSingleExportId(null)}
  }
  const load=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true); setError("");
    const params=new URLSearchParams({page:String(page),page_size:String(pageSize)});
    if(q.trim())params.set("q",q.trim()); if(status)params.set("status",status); if(country)params.set("country",country); if(userId)params.set("user_id",userId);
    params.set("sort_by",sortBy); params.set("sort_dir",sortDir);
    if(dateFrom)params.set("date_from",dateFrom); if(dateTo)params.set("date_to",dateTo);
    const response=await fetch(`/api/stock-orders?${params}`,{cache:"no-store"});
    const body=await response.json().catch(()=>({})); setLoading(false);
    if(!response.ok){setError(body.error||"备货单加载失败");return} setData(body);
  },[page,pageSize,q,status,country,userId,dateFrom,dateTo,sortBy,sortDir]);
  useEffect(()=>{setSelectedIds([])},[q,status,country,userId,dateFrom,dateTo]);
  const selectableIds=(data?.data||[]).filter(row=>!["DRAFT","CANCELLED"].includes(row.status)).map(row=>row.id);
  const pageSelection=selectableIds.slice(0,50);
  const allPageSelected=pageSelection.length>0&&pageSelection.every(id=>selectedIds.includes(id));
  function toggleSelection(id:string){setSelectedIds(current=>current.includes(id)?current.filter(item=>item!==id):current.length<50?[...current,id]:current)}
  function togglePageSelection(){setSelectedIds(current=>pageSelection.every(id=>current.includes(id))?current.filter(id=>!pageSelection.includes(id)):[...current,...pageSelection.filter(id=>!current.includes(id)).slice(0,50-current.length)])}
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==="visible")void load(true)};const timer=window.setInterval(refresh,15000);window.addEventListener("focus",refresh);return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh)}},[load]);
  function toggleSort(key:string){setSortDir(sortBy===key&&sortDir==="asc"?"desc":"asc");setSortBy(key);setPage(1)}
  function SortHeader({label,column}:{label:string;column:string}){return <th aria-sort={sortBy===column?sortDir==="asc"?"ascending":"descending":"none"} className="px-4 py-3 font-medium"><button type="button" onClick={()=>toggleSort(column)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-blue-700">{label}{sortBy===column?sortDir==="asc"?<ArrowUp size={13}/>:<ArrowDown size={13}/>:<ArrowUpDown size={13} className="text-slate-400"/>}</button></th>}
  const tableColumns=9+Number(Boolean(data?.can_view_all))+Number(Boolean(data?.can_export));
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1660px]">
    <header><h1 className="flex items-center gap-2 text-2xl font-bold"><ShoppingCart className="text-blue-600"/>采购管理</h1><p className="mt-1 text-sm text-slate-500">销售员通过PI订单提交备货需求；仓库员完善备货信息并更新备货进度。备货状态不记录库存。</p></header>
    <AppFilterBar>
      <label className="relative min-w-[260px] flex-1 xl:min-w-[360px]"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="搜索订单编号、备货单号或客户名称" className={`${appFieldClass} w-full pl-9`}/></label>
      <AppSelect value={CURRENT_STOCK_STATUSES.includes(status as typeof CURRENT_STOCK_STATUSES[number]) ? status : ""} onChange={e=>{setStatus(e.target.value);setPage(1)}} className={appFieldClass} aria-label="按备货状态筛选"><option value="">全部备货单</option>{CURRENT_STOCK_STATUSES.map(key=><option key={key} value={key}>{key==="ACTIVE"?"备货处理中（各阶段见进度条）":STOCK_STATUS_LABELS[key]}</option>)}</AppSelect>
      <AppSelect value={country} onChange={e=>{setCountry(e.target.value);setPage(1)}} className={appFieldClass} aria-label="按目的国家筛选" forceSearch><option value="">全部目的国家</option>{COUNTRY_OPTIONS.map(option=><option key={option.code} value={option.code}>{option.name}</option>)}</AppSelect>
      {data?.profile.role!=="WAREHOUSE"?<UserScopeSelect permission="stock.data_all" value={userId} onChange={value=>{setUserId(value);setPage(1)}} className={`${appFieldClass} min-w-52`} custom/>:null}
      <CompactDateRange label="创建日期" fromLabel="备货单创建开始日期" toLabel="备货单创建结束日期" from={dateFrom} to={dateTo} onFromChange={value=>{setDateFrom(value);setPage(1)}} onToChange={value=>{setDateTo(value);setPage(1)}}/>
      <details className="relative text-sm"><summary className="flex h-10 cursor-pointer items-center rounded-lg border bg-white px-3 text-slate-600">{EXCEPTION_STOCK_STATUSES.includes(status as StockOrderStatus) ? `历史/异常：${STOCK_STATUS_LABELS[status as StockOrderStatus]}` : "历史/异常筛选"}</summary><div className="absolute left-0 top-11 z-30 w-52 rounded-lg border bg-white p-2 shadow-lg"><AppSelect value={EXCEPTION_STOCK_STATUSES.includes(status as StockOrderStatus) ? status : ""} onChange={e=>{setStatus(e.target.value);setPage(1)}} className={`${appFieldClass} w-full`} aria-label="按历史或异常备货状态筛选"><option value="">不筛选</option>{EXCEPTION_STOCK_STATUSES.map(key=><option key={key} value={key}>{STOCK_STATUS_LABELS[key]}</option>)}</AppSelect></div></details>
      <button onClick={()=>{setQ("");setStatus("");setCountry("");setUserId("");setDateFrom("");setDateTo("");setSortBy("updated_at");setSortDir("desc");setPage(1)}} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">重置</button>
    </AppFilterBar>
    {data?.can_export?<div className="mt-3 flex flex-wrap items-center justify-end gap-2"><span className="text-xs text-slate-500">勾选指定正式备货单；可跨页选择，最多50张</span><RowActionMenu ariaLabel={`批量导出备货单，已选 ${selectedIds.length} 张`} label={`批量导出（${selectedIds.length}张）`}><RowActionItem disabled={exportBusy||selectedIds.length===0} onClick={()=>void exportSelected()}>{exportBusy?"正在导出…":"导出 Excel"}</RowActionItem><RowActionItem disabled={exportBusy||selectedIds.length===0} onClick={()=>window.open(`/stock-orders/batch-preview?${selectedIds.map(id=>`id=${encodeURIComponent(id)}`).join("&")}`,"_blank","noopener,noreferrer")}>导出 PDF</RowActionItem></RowActionMenu></div>:null}
    {error?<div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>:null}
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1450px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>
          {data?.can_export?<th className="w-10 px-3 py-3"><input type="checkbox" aria-label="选择本页可导出的备货单，最多50张" checked={allPageSelected} disabled={!pageSelection.length||(selectedIds.length>=50&&!pageSelection.some(id=>selectedIds.includes(id)))} onChange={togglePageSelection} className="size-4 accent-blue-600"/></th>:null}
          <SortHeader label="订单编号" column="order_number"/>
          <th className="px-4 py-3 font-medium">备货进度</th>
          <SortHeader label="备货单号" column="stock_number"/>
          <SortHeader label="客户名称" column="customer_name"/>
          <SortHeader label="状态" column="status"/>
          {data?.can_view_all?<th className="px-4 py-3 font-medium">销售员</th>:null}
          <th className="px-4 py-3 font-medium">目的国家</th>
          <SortHeader label="更新时间" column="updated_at"/>
          <SortHeader label="创建时间" column="created_at"/>
          <th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 font-medium shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th>
        </tr></thead>
        <tbody>{loading ? <tr><td colSpan={tableColumns} className="h-56 text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600"/></td></tr> : data?.data.length ? data.data.map(row =>
          <tr key={row.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/stock-orders/${row.id}`)}} className="group cursor-pointer border-t hover:bg-blue-50/40">
            {data?.can_export?<td className="px-3 py-3"><input type="checkbox" aria-label={`选择备货单 ${row.warehouse_reference_number||row.stock_number}`} checked={selectedIds.includes(row.id)} disabled={!selectableIds.includes(row.id)||(selectedIds.length>=50&&!selectedIds.includes(row.id))} onChange={()=>toggleSelection(row.id)} className="size-4 accent-blue-600"/></td>:null}
            <td className="px-4 py-3 font-semibold">{data?.can_view_pi?<Link href={`/orders/${row.sales_order_id}`} onClick={event=>event.stopPropagation()} className="text-blue-700 hover:underline">{row.warehouse_reference_number || row.order_number}</Link>:row.warehouse_reference_number || row.order_number}</td>
            <td className="px-4 py-3">{row.status==="DRAFT"?<span className="text-xs text-slate-500">{row.warehouse_reference_number?"已撤回（历史）":"未提交"}</span>:<StockProgressCell progress={row.progress}/>}</td>
            <td className="px-4 py-3 text-xs"><Link href={`/stock-orders/${row.id}`} onClick={event=>event.stopPropagation()} className="font-medium text-blue-700 hover:underline">{row.stock_number}</Link></td>
            <td className="max-w-52 px-4 py-3" title={row.customer_short_name}>{row.customer_short_name}</td>
            <td className="px-4 py-3"><AppStatusBadge status={row.status}>{row.status==="DRAFT"&&row.warehouse_reference_number?"已撤回，待重新提交":stockProgressLabel(row.progress)}</AppStatusBadge></td>
            {data?.can_view_all?<td className="px-4 py-3">{row.sales?.name||row.sales?.email||"-"}</td>:null}
            <td className="px-4 py-3"><CountryLabel value={row.destination_country}/></td>
            <td className="px-4 py-3 text-xs text-slate-500">{new Date(row.updated_at).toLocaleString("zh-CN")}</td>
            <td className="px-4 py-3 text-xs text-slate-500">{new Date(row.created_at).toLocaleString("zh-CN")}</td>
            <td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50"><div className="flex items-center gap-2"><Link href={`/stock-orders/${row.id}`} className="whitespace-nowrap font-medium text-blue-600 hover:underline">{row.status==="DRAFT"&&row.warehouse_reference_number?"查看撤回记录":row.status==="DRAFT"&&["WAREHOUSE","ADMIN"].includes(data?.profile.role||"")?"完善备货信息":"查看详情"}</Link><RowActionMenu ariaLabel={`备货单 ${row.warehouse_reference_number||row.order_number} 的更多操作`} label="更多"><RowActionItem onClick={()=>router.push(`/stock-orders/${row.id}/preview`)}>预览{row.status==="DRAFT"?"草稿":" / 打印"}</RowActionItem>{data?.can_export&&!["DRAFT","CANCELLED"].includes(row.status)?<><RowActionItem disabled={singleExportId!==null} onClick={()=>void exportOne(row)}>{singleExportId===row.id?"导出中…":"导出 Excel"}</RowActionItem><RowActionItem onClick={()=>window.open(`/stock-orders/${row.id}/preview?export=pdf`,"_blank","noopener,noreferrer")}>导出 PDF</RowActionItem></>:null}</RowActionMenu></div></td>
          </tr>) : <tr><td colSpan={tableColumns} className="h-56 text-center text-slate-400">暂无备货单</td></tr>}</tbody>
      </table></div>
      <AppPagination page={page} pageSize={pageSize} total={data?.count||0} itemLabel="张备货单" onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/>
    </section>
  </div></main>;
}
