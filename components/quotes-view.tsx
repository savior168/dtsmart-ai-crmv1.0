"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/types";
import { UserScopeSelect } from "@/components/user-scope-select";
import { AppFilterBar, AppResetButton, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";

type QuoteRow = { id:string; quote_number:string; customer_short_name:string|null; currency:string; status:QuoteStatus; total_amount:number; valid_until:string|null; customer_confirmed_at:string|null; updated_at:string; customer?:{company_name?:string}|null; owner?:{name?:string|null;email?:string}|null };
type Payload = { data:QuoteRow[]; count:number; page:number; page_size:number; can_view_all:boolean };

export function QuotesView(){
  const router=useRouter();
  const [data,setData]=useState<Payload|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const [q,setQ]=useState(""); const [status,setStatus]=useState(""); const [userId,setUserId]=useState(""); const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(20);
  const load=useCallback(async()=>{setLoading(true);setError("");const params=new URLSearchParams({page:String(page),page_size:String(pageSize)});if(q.trim())params.set("q",q.trim());if(status)params.set("status",status);if(userId)params.set("user_id",userId);const response=await fetch(`/api/quotes?${params}`,{cache:"no-store"});const body=await response.json().catch(()=>({}));setLoading(false);if(!response.ok){setError(body.error||"报价列表加载失败");return}setData(body)},[page,pageSize,q,status,userId]);
  useEffect(()=>{void load()},[load]);
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1660px]">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">历史报价记录</h1><p className="mt-1 text-sm text-slate-500">保留旧报价业务记录供追溯；新业务请从PI订单直接创建并关联备货单。</p></div></header>
    <AppFilterBar><label className="relative min-w-[260px] flex-1 xl:min-w-[320px]"><Search size={17} className="absolute left-3 top-3 text-slate-400"/><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="搜索报价编号或客户简称" className={`${appFieldClass} w-full pl-9`}/></label><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}} className={appFieldClass}><option value="">全部报价状态</option>{Object.entries(QUOTE_STATUS_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><UserScopeSelect permission="quotes.data_all" value={userId} onChange={value=>{setUserId(value);setPage(1)}} className={`${appFieldClass} min-w-52`}/><AppResetButton onClick={()=>{setQ("");setStatus("");setUserId("");setPage(1)}}/></AppFilterBar>
    {error?<div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>:null}
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr>{["报价编号","客户简称","状态","报价金额","有效期",...(data?.can_view_all?["归属人"]:[]),"最后更新"].map(x=><th key={x} className="px-4 py-3 font-medium">{x}</th>)}<th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 font-medium shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th></tr></thead><tbody>{loading?<tr><td colSpan={data?.can_view_all?8:7} className="h-56 text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600"/></td></tr>:data?.data.length?data.data.map(row=><tr key={row.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/quotes/${row.id}`)}} className="group cursor-pointer border-t hover:bg-blue-50/40"><td className="px-4 py-3 font-medium text-blue-700">{row.quote_number}</td><td className="max-w-56 truncate px-4 py-3">{row.customer_short_name||row.customer?.company_name||"-"}</td><td className="px-4 py-3"><AppStatusBadge status={row.status}>{QUOTE_STATUS_LABELS[row.status]||row.status}</AppStatusBadge></td><td className="px-4 py-3 font-semibold">{row.currency} {Number(row.total_amount||0).toFixed(2)}</td><td className="px-4 py-3">{row.valid_until||"-"}</td>{data.can_view_all?<td className="px-4 py-3">{row.owner?.name||row.owner?.email||"-"}</td>:null}<td className="px-4 py-3 text-slate-500">{new Date(row.updated_at).toLocaleString("zh-CN")}</td><td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50"><Link href={`/quotes/${row.id}`} className="font-medium text-blue-600">查看详情</Link></td></tr>):<tr><td colSpan={data?.can_view_all?8:7} className="h-56 text-center text-slate-400">暂无报价单</td></tr>}</tbody></table></div><AppPagination page={page} pageSize={pageSize} total={data?.count||0} itemLabel="张报价" onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></section>
  </div></main>
}
