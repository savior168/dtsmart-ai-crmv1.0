"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Search, ShoppingCart } from "lucide-react";
import { STOCK_STATUS_LABELS, type StockOrderStatus } from "@/lib/types";
import { UserScopeSelect } from "@/components/user-scope-select";
import { AppFilterBar, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";

type Row = { id:string; stock_number:string; order_number:string; quote_number:string; customer_short_name:string; destination_country:string|null; status:StockOrderStatus; status_note:string|null; stocking_requirements:string|null; updated_at:string; sales?:{name?:string|null;email?:string}|null };
type Payload = { data:Row[]; count:number; profile:{role:string}; can_view_all:boolean };

export function StockOrdersView() {
  const router=useRouter();
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");
  const [userId,setUserId]=useState("");
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(20);
  const load=useCallback(async()=>{
    setLoading(true); setError("");
    const params=new URLSearchParams({page:String(page),page_size:String(pageSize)});
    if(q.trim())params.set("q",q.trim()); if(status)params.set("status",status); if(userId)params.set("user_id",userId);
    const response=await fetch(`/api/stock-orders?${params}`,{cache:"no-store"});
    const body=await response.json().catch(()=>({})); setLoading(false);
    if(!response.ok){setError(body.error||"备货单加载失败");return} setData(body);
  },[page,pageSize,q,status,userId]);
  useEffect(()=>{void load()},[load]);
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1660px]">
    <header><h1 className="flex items-center gap-2 text-2xl font-bold"><ShoppingCart className="text-blue-600"/>采购管理</h1><p className="mt-1 text-sm text-slate-500">销售员完善并提交备货单；采购备货人员核对实际采购价与备货进度。备货状态不会改变客户成交判断，也不记录库存。</p></header>
    <AppFilterBar><label className="relative min-w-[260px] flex-1 xl:min-w-[360px]"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="搜索备货编号、订单编号、报价编号或客户简称" className={`${appFieldClass} w-full pl-9`}/></label><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}} className={appFieldClass}><option value="">全部备货状态</option>{Object.entries(STOCK_STATUS_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{data?.profile.role!=="WAREHOUSE"?<UserScopeSelect permission="stock.data_all" value={userId} onChange={value=>{setUserId(value);setPage(1)}} className={`${appFieldClass} min-w-52`}/>:null}<button onClick={()=>{setQ("");setStatus("");setUserId("");setPage(1)}} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">重置</button></AppFilterBar>
    {error?<div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>:null}
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr>{["备货编号","订单编号","客户简称","报价编号","状态","备货要求/状态说明","销售员","最后更新"].map(x=><th key={x} className="px-4 py-3 font-medium">{x}</th>)}<th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 font-medium shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th></tr></thead><tbody>{loading?<tr><td colSpan={9} className="h-56 text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600"/></td></tr>:data?.data.length?data.data.map(row=><tr key={row.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/stock-orders/${row.id}`)}} className="group cursor-pointer border-t hover:bg-blue-50/40"><td className="px-4 py-3 font-medium text-blue-700">{row.stock_number}</td><td className="px-4 py-3 font-medium">{row.order_number}</td><td className="max-w-48 truncate px-4 py-3">{row.customer_short_name}</td><td className="px-4 py-3">{row.quote_number}</td><td className="px-4 py-3"><AppStatusBadge status={row.status}>{STOCK_STATUS_LABELS[row.status]}</AppStatusBadge></td><td className="max-w-72 px-4 py-3 text-slate-600"><p className="line-clamp-2">{row.status_note||row.stocking_requirements||(row.status==="DRAFT"?"等待销售员完善":"-")}</p></td><td className="px-4 py-3">{row.sales?.name||row.sales?.email||"-"}</td><td className="px-4 py-3 text-slate-500">{new Date(row.updated_at).toLocaleString("zh-CN")}</td><td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50"><Link href={`/stock-orders/${row.id}`} className="font-medium text-blue-600">{row.status==="DRAFT"?"完善备货信息":"查看详情"}</Link></td></tr>):<tr><td colSpan={9} className="h-56 text-center text-slate-400">暂无备货单</td></tr>}</tbody></table></div><AppPagination page={page} pageSize={pageSize} total={data?.count||0} itemLabel="张备货单" onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></section>
  </div></main>;
}
