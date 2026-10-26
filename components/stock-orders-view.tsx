"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";

type Row = { id:string; sales_order_id:string; stock_number:string; order_number:string; warehouse_reference_number:string|null; customer_short_name:string; customer_name:string|null; destination_country:string|null; status:StockOrderStatus; progress:StockProgress; status_note:string|null; stocking_requirements:string|null; expected_ready_at:string; created_at:string; updated_at:string; archived_at?:string|null; archive_reason?:string|null; sales?:{name?:string|null;email?:string}|null; preparer?:{name?:string|null;email?:string}|null };
type Payload = { data:Row[]; count:number; profile:{role:string}; can_view_all:boolean; can_view_pi:boolean; can_export:boolean; can_preview:boolean; is_admin:boolean; archived_view:boolean };
const STOCK_FILTER_STATUSES = ["DRAFT", "WAITING", "ACTIVE", "SHIPPED", "SHORTAGE", "OTHER", "CANCELLED", "READY"] as const;

export function StockOrdersView({initialFilters={}}:{initialFilters?:{status?:string;dateFrom?:string;dateTo?:string;creatorId?:string}}) {
  const router=useRouter();
  const listRequestVersion=useRef(0);
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [sessionExpired,setSessionExpired]=useState(false);
  const [q,setQ]=useState("");
  const [status,setStatus]=useState(initialFilters.status||"");
  const [country,setCountry]=useState("");
  const [sortBy,setSortBy]=useState("updated_at");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("desc");
  const [dateFrom,setDateFrom]=useState(initialFilters.dateFrom||"");
  const [dateTo,setDateTo]=useState(initialFilters.dateTo||"");
  const [userId,setUserId]=useState("");
  const [creatorId,setCreatorId]=useState(initialFilters.creatorId||"");
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(20);
  const [exportBusy,setExportBusy]=useState(false);
  const [singleExportId,setSingleExportId]=useState<string|null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [archivedView,setArchivedView]=useState(false);
  const [archiveSelectedIds,setArchiveSelectedIds]=useState<string[]>([]);
  const [archiveAction,setArchiveAction]=useState<"ARCHIVE"|"RESTORE"|null>(null);
  const [archiveReason,setArchiveReason]=useState("");
  const [archiveBusy,setArchiveBusy]=useState(false);
  async function exportSelected() {
    if(exportBusy||!data?.can_export||archivedView||!selectedIds.length)return;
    setExportBusy(true);setError("");
    try {
      const params=new URLSearchParams({export:"1",sort_by:sortBy,sort_dir:sortDir});
      if(q.trim())params.set("q",q.trim());if(status)params.set("status",status);if(country)params.set("country",country);if(userId)params.set("user_id",userId);
      if(creatorId)params.set("creator_id",creatorId);
      if(dateFrom)params.set("date_from",dateFrom);if(dateTo)params.set("date_to",dateTo);
      selectedIds.forEach(id=>params.append("id",id));
      await downloadFilteredExport(`/api/stock-orders?${params}`,batchExportFilename("备货单","zip"));
    } catch(cause) {
      if(cause instanceof Error && ["UNAUTHORIZED","SESSION_REVOKED"].includes(cause.message)) {
        setData(null);setSelectedIds([]);setSessionExpired(true);setError("登录已失效，请重新登录后再导出备货单");
      } else setError(cause instanceof Error?cause.message:"备货单导出失败");
    }
    finally {setExportBusy(false)}
  }
  async function exportOne(row:Row) {
    if(singleExportId)return;
    setSingleExportId(row.id);setError("");
    try {await downloadFilteredExport(`/api/stock-orders/${row.id}/export`,documentExportFilename(row.stock_number,"备货单","xlsx"))}
    catch(cause){
      if(cause instanceof Error && ["UNAUTHORIZED","SESSION_REVOKED"].includes(cause.message)) {
        setData(null);setSelectedIds([]);setSessionExpired(true);setError("登录已失效，请重新登录后再导出备货单");
      } else setError(cause instanceof Error?cause.message:"备货单导出失败，请稍后重试");
    }
    finally{setSingleExportId(null)}
  }
  const load=useCallback(async(silent=false)=>{
    const requestVersion=++listRequestVersion.current;
    if(!silent)setLoading(true); setError("");
    const params=new URLSearchParams({page:String(page),page_size:String(pageSize)});
    if(q.trim())params.set("q",q.trim()); if(status)params.set("status",status); if(country)params.set("country",country); if(userId)params.set("user_id",userId);
    if(creatorId)params.set("creator_id",creatorId);
    if(archivedView)params.set("archive","archived");
    params.set("sort_by",sortBy); params.set("sort_dir",sortDir);
    if(dateFrom)params.set("date_from",dateFrom); if(dateTo)params.set("date_to",dateTo);
    try {
    const response=await fetch(`/api/stock-orders?${params}`,{cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(requestVersion!==listRequestVersion.current)return;
    setLoading(false);
    if(!response.ok){
      if(response.status===401){setData(null);setSelectedIds([]);setSessionExpired(true);setError("登录已失效，请重新登录后查看备货单");}
      else {setData(null);setSessionExpired(false);setError(body.error||"备货单加载失败");}
      return;
    }
    setSessionExpired(false);setData(body);
    } catch {
      if(requestVersion!==listRequestVersion.current)return;
      setLoading(false);setData(null);setError("备货单加载失败，请稍后重试");
    }
  },[page,pageSize,q,status,country,userId,creatorId,dateFrom,dateTo,sortBy,sortDir,archivedView]);
  useEffect(()=>{setSelectedIds([]);setArchiveSelectedIds([])},[q,status,country,userId,creatorId,dateFrom,dateTo,archivedView,page,pageSize]);
  async function manageArchive(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!data?.is_admin||!archiveAction||archiveBusy||!archiveSelectedIds.length||archiveSelectedIds.length>100)return;
    setArchiveBusy(true);
    try{
      const response=await fetch("/api/order-archives",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity_type:"stock_order",ids:archiveSelectedIds,action:archiveAction,reason:archiveReason.trim()})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"备货单归档操作失败");
      setArchiveAction(null);setArchiveSelectedIds([]);setArchiveReason("");await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"备货单归档操作失败")}
    finally{setArchiveBusy(false)}
  }
  const selectableIds=(data?.data||[]).filter(row=>!["DRAFT","CANCELLED"].includes(row.status)).map(row=>row.id);
  const pageSelection=selectableIds.slice(0,50);
  const allPageSelected=pageSelection.length>0&&pageSelection.every(id=>selectedIds.includes(id));
  function toggleSelection(id:string){setSelectedIds(current=>current.includes(id)?current.filter(item=>item!==id):current.length<50?[...current,id]:current)}
  function togglePageSelection(){setSelectedIds(current=>pageSelection.every(id=>current.includes(id))?current.filter(id=>!pageSelection.includes(id)):[...current,...pageSelection.filter(id=>!current.includes(id)).slice(0,50-current.length)])}
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==="visible")void load(true)};const timer=window.setInterval(refresh,15000);window.addEventListener("focus",refresh);return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh)}},[load]);
  function toggleSort(key:string){setSortDir(sortBy===key&&sortDir==="asc"?"desc":"asc");setSortBy(key);setPage(1)}
  function SortHeader({label,column}:{label:string;column:string}){return <th aria-sort={sortBy===column?sortDir==="asc"?"ascending":"descending":"none"} className="px-4 py-3 font-medium"><button type="button" onClick={()=>toggleSort(column)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-blue-700">{label}{sortBy===column?sortDir==="asc"?<ArrowUp size={13}/>:<ArrowDown size={13}/>:<ArrowUpDown size={13} className="text-slate-400"/>}</button></th>}
  const canFilterCreator=Boolean(data && ["ADMIN","ORDER_CLERK"].includes(data.profile.role) && data.can_view_all);
  const tableColumns=12+Number(Boolean(data?.is_admin))+Number(Boolean(data?.can_export&&!archivedView));
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1660px]">
    <header><h1 className="flex items-center gap-2 text-2xl font-bold"><ShoppingCart className="text-blue-600"/>采购管理{archivedView?" · 已归档备货单":""}</h1><p className="mt-1 text-sm text-slate-500">销售员通过PI订单提交备货需求；仓库员完善备货信息并更新备货进度。备货状态不记录库存。</p></header>
    <AppFilterBar>
      <label className="relative min-w-[260px] flex-1 xl:min-w-[360px]"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="搜索客户名称、公司、PI/备货单号、电话或邮箱" className={`${appFieldClass} w-full pl-9`}/></label>
      <AppSelect value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}} className={appFieldClass} aria-label="按备货状态筛选"><option value="">全部备货状态</option>{STOCK_FILTER_STATUSES.map(key=><option key={key} value={key}>{key==="ACTIVE"?"备货处理中（各阶段见进度条）":key==="OTHER"?"其他状态（草稿／取消／历史）":STOCK_STATUS_LABELS[key]}</option>)}</AppSelect>
      <AppSelect value={country} onChange={e=>{setCountry(e.target.value);setPage(1)}} className={appFieldClass} aria-label="按目的国家筛选" forceSearch><option value="">全部目的国家</option>{COUNTRY_OPTIONS.map(option=><option key={option.code} value={option.code}>{option.name}</option>)}</AppSelect>
      {data?.profile.role!=="WAREHOUSE"?<UserScopeSelect permission="stock.data_all" value={userId} onChange={value=>{setUserId(value);setPage(1)}} className={`${appFieldClass} min-w-52`} filterLabel="所属销售员" custom/>:null}
      {canFilterCreator ? <UserScopeSelect permission="stock.data_all" kind="pi_creator" value={creatorId} onChange={value=>{setCreatorId(value);setPage(1)}} className={`${appFieldClass} min-w-52`} filterLabel="制单人" allLabel="全部制单人" custom/> : null}
      <CompactDateRange label="创建日期" fromLabel="备货单创建开始日期" toLabel="备货单创建结束日期" from={dateFrom} to={dateTo} onFromChange={value=>{setDateFrom(value);setPage(1)}} onToChange={value=>{setDateTo(value);setPage(1)}}/>
      <button onClick={()=>{setQ("");setStatus("");setCountry("");setUserId("");setCreatorId("");setDateFrom("");setDateTo("");setSortBy("updated_at");setSortDir("desc");setPage(1)}} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">重置</button>
    </AppFilterBar>
    {data?.is_admin?<div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={()=>{setArchivedView(false);setArchiveSelectedIds([]);setPage(1)}} aria-pressed={!archivedView} className={`h-9 rounded-lg border px-3 text-sm ${!archivedView?"border-blue-300 bg-blue-50 text-blue-700":"border-slate-200 bg-white text-slate-600"}`}>有效单据</button><button type="button" onClick={()=>{setArchivedView(true);setArchiveSelectedIds([]);setPage(1)}} aria-pressed={archivedView} className={`h-9 rounded-lg border px-3 text-sm ${archivedView?"border-blue-300 bg-blue-50 text-blue-700":"border-slate-200 bg-white text-slate-600"}`}>已归档</button>{archiveSelectedIds.length?<><span className="ml-2 text-sm text-slate-500">已选择 {archiveSelectedIds.length} 张（单次最多 100 张）</span><button type="button" disabled={archiveSelectedIds.length>100} onClick={()=>{setArchiveReason("");setArchiveAction(archivedView?"RESTORE":"ARCHIVE")}} className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{archivedView?"批量恢复所选":"批量归档所选"}</button></>:null}</div>:null}
    {!archivedView&&data?.can_export?<div className="mt-3 flex flex-wrap items-center justify-end gap-2"><span className="text-xs text-slate-500">勾选指定正式备货单；可跨页选择，最多50张</span><RowActionMenu ariaLabel={`批量导出备货单，已选 ${selectedIds.length} 张`} label={`批量导出（${selectedIds.length}张）`}><RowActionItem disabled={exportBusy||selectedIds.length===0} onClick={()=>void exportSelected()}>{exportBusy?"正在导出…":"导出 Excel"}</RowActionItem><RowActionItem disabled={exportBusy||selectedIds.length===0} onClick={()=>window.open(`/stock-orders/batch-preview?${selectedIds.map(id=>`id=${encodeURIComponent(id)}`).join("&")}`,"_blank","noopener,noreferrer")}>导出 PDF</RowActionItem></RowActionMenu></div>:null}
    {error?<div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}{sessionExpired?<Link href="/login?next=%2Fstock-orders" className="ml-2 font-semibold underline">前往登录</Link>:null}</div>:null}
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1750px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>
          {data?.is_admin?<th className="w-10 px-3 py-3"><input type="checkbox" aria-label="选择本页全部备货单用于归档，单次最多100张" checked={Boolean(data?.data.length)&&data!.data.every(row=>archiveSelectedIds.includes(row.id))} disabled={archiveSelectedIds.length>=100&&!data!.data.every(row=>archiveSelectedIds.includes(row.id))} onChange={event=>setArchiveSelectedIds(current=>event.target.checked?[...new Set([...current,...(data?.data||[]).map(row=>row.id)])].slice(0,100):current.filter(id=>!data?.data.some(row=>row.id===id)))} className="size-4 accent-indigo-600"/></th>:null}
          {!archivedView&&data?.can_export?<th className="w-10 px-3 py-3"><input type="checkbox" aria-label="选择本页可导出的备货单，最多50张" checked={allPageSelected} disabled={!pageSelection.length||(selectedIds.length>=50&&!pageSelection.some(id=>selectedIds.includes(id)))} onChange={togglePageSelection} className="size-4 accent-blue-600"/></th>:null}
          <SortHeader label="备货单号" column="stock_number"/>
          <SortHeader label="关联订单号" column="order_number"/>
          <th className="min-w-[110px] px-4 py-3 font-medium">客户名称</th>
          <SortHeader label="公司名称" column="customer_name"/>
          <th className="px-4 py-3 font-medium">目的国家</th>
          <SortHeader label="状态" column="status"/>
          <th className="w-[360px] min-w-[352px] px-4 py-3 font-medium">备货进度</th>
          <th className="px-4 py-3 font-medium">所属销售员</th>
          <th className="px-4 py-3 font-medium">制单人</th>
          <SortHeader label="更新时间" column="updated_at"/>
          <SortHeader label="创建时间" column="created_at"/>
          <th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 font-medium shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th>
        </tr></thead>
        <tbody>{loading ? <tr><td colSpan={tableColumns} className="h-56 text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600"/></td></tr> : data?.data.length ? data.data.map(row =>
          <tr key={row.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/stock-orders/${row.id}`)}} className="group cursor-pointer border-t hover:bg-blue-50/40">
            {data?.is_admin?<td className="px-3 py-3"><input type="checkbox" aria-label={`选择备货单 ${row.stock_number}用于归档`} checked={archiveSelectedIds.includes(row.id)} disabled={archiveSelectedIds.length>=100&&!archiveSelectedIds.includes(row.id)} onClick={event=>event.stopPropagation()} onChange={event=>setArchiveSelectedIds(current=>event.target.checked?[...new Set([...current,row.id])].slice(0,100):current.filter(id=>id!==row.id))} className="size-4 accent-indigo-600"/></td>:null}
            {!archivedView&&data?.can_export?<td className="px-3 py-3"><input type="checkbox" aria-label={`选择备货单 ${row.warehouse_reference_number||row.stock_number}`} checked={selectedIds.includes(row.id)} disabled={!selectableIds.includes(row.id)||(selectedIds.length>=50&&!selectedIds.includes(row.id))} onChange={()=>toggleSelection(row.id)} className="size-4 accent-blue-600"/></td>:null}
            <td className="px-4 py-3 text-xs"><Link href={`/stock-orders/${row.id}`} onClick={event=>event.stopPropagation()} className="font-medium text-blue-700 hover:underline">{row.stock_number}</Link>{row.archived_at?<span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">已归档</span>:null}</td>
            <td className="px-4 py-3 font-semibold">{data?.can_view_pi?<Link href={`/orders/${row.sales_order_id}`} onClick={event=>event.stopPropagation()} className="text-blue-700 hover:underline">{row.warehouse_reference_number || row.order_number}</Link>:row.warehouse_reference_number || row.order_number}</td>
            <td className="px-4 py-3 font-medium text-slate-900">{row.customer_name || <span className="font-normal text-slate-400">未填写</span>}</td>
            <td className="max-w-52 px-4 py-3" title={row.customer_short_name}>{row.customer_short_name}</td>
            <td className="px-4 py-3"><CountryLabel value={row.destination_country}/></td>
            <td className="px-4 py-3"><AppStatusBadge status={row.status}>{row.status==="DRAFT"&&row.warehouse_reference_number?"已撤回，待重新提交":stockProgressLabel(row.progress)}</AppStatusBadge></td>
            <td className="w-[360px] min-w-[352px] px-4 py-3">{row.status==="DRAFT"?<span className="text-xs text-slate-500">{row.warehouse_reference_number?"已撤回（历史）":"未提交"}</span>:<StockProgressCell progress={row.progress}/>}</td>
            <td className="px-4 py-3">{row.sales?.name||row.sales?.email||"-"}</td>
            <td className="px-4 py-3">{row.preparer?.name||row.preparer?.email||"未记录"}</td>
            <td className="px-4 py-3 text-xs text-slate-500">{new Date(row.updated_at).toLocaleString("zh-CN")}</td>
            <td className="px-4 py-3 text-xs text-slate-500">{row.archived_at?<span title={row.archive_reason||""}>归档于 {new Date(row.archived_at).toLocaleString("zh-CN")}{row.archive_reason?` · ${row.archive_reason}`:""}</span>:new Date(row.created_at).toLocaleString("zh-CN")}</td>
            <td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50"><div className="flex items-center gap-2"><Link href={`/stock-orders/${row.id}`} className="whitespace-nowrap font-medium text-blue-600 hover:underline">{row.status==="DRAFT"&&row.warehouse_reference_number?"查看撤回记录":row.status==="DRAFT"&&["WAREHOUSE","ADMIN"].includes(data?.profile.role||"")?"完善备货信息":"查看详情"}</Link><RowActionMenu ariaLabel={`备货单 ${row.warehouse_reference_number||row.order_number} 的更多操作`} label="更多">{data?.can_preview?<RowActionItem onClick={()=>router.push(`/stock-orders/${row.id}/preview`)}>预览{row.status==="DRAFT"?"草稿":" / 打印"}</RowActionItem>:null}{!archivedView&&data?.can_export&&!["DRAFT","CANCELLED"].includes(row.status)?<><RowActionItem disabled={singleExportId!==null} onClick={()=>void exportOne(row)}>{singleExportId===row.id?"导出中…":"导出 Excel"}</RowActionItem><RowActionItem onClick={()=>window.open(`/stock-orders/${row.id}/preview?export=pdf`,"_blank","noopener,noreferrer")}>导出 PDF</RowActionItem></>:null}</RowActionMenu></div></td>
          </tr>) : <tr><td colSpan={tableColumns} className="h-56 text-center text-slate-400">{archivedView?"暂无已归档备货单":"暂无备货单"}</td></tr>}</tbody>
      </table></div>
      <AppPagination page={page} pageSize={pageSize} total={data?.count||0} itemLabel="张备货单" onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/>
    </section>
    <AppDialog open={Boolean(archiveAction)} title={archiveAction==="ARCHIVE"?"归档备货单":"恢复备货单"} description={archiveAction==="ARCHIVE"?"归档后其他角色将无法查看，备货记录及审计历史会保留。":"恢复所选备货单；如果所属 PI 仍处于归档状态，系统将要求先恢复 PI。"} onClose={()=>{if(!archiveBusy)setArchiveAction(null)}} width="max-w-lg"><form onSubmit={manageArchive}><p className="text-sm text-slate-600">本次处理 {archiveSelectedIds.length} 张备货单。</p>{archiveAction==="ARCHIVE"?<label className="mt-4 block text-sm font-medium text-slate-700">归档原因（必填）<textarea autoFocus required maxLength={500} rows={3} value={archiveReason} onChange={event=>setArchiveReason(event.target.value)} placeholder="例如：历史测试单据清理" className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm"/></label>:null}<DialogActions busy={archiveBusy} disabled={archiveAction==="ARCHIVE"&&!archiveReason.trim()} onCancel={()=>{if(!archiveBusy)setArchiveAction(null)}} confirmLabel={archiveAction==="ARCHIVE"?"确认归档":"确认恢复"} tone={archiveAction==="ARCHIVE"?"danger":"primary"}/></form></AppDialog>
  </div></main>;
}
