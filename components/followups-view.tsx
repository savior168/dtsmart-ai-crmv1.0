"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, FileDown, LoaderCircle, Search } from "lucide-react";
import { UserScopeSelect } from "@/components/user-scope-select";
import { CountryLabel } from "@/components/country-label";
import { CUSTOMER_STATUS_LABELS, FOLLOWUP_TYPE_LABELS } from "@/lib/types";
import { AppFilterBar, AppResetButton, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppTabs } from "@/components/ui/app-tabs";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";

type Item={id:string;customer_id:string;user_id:string;type:string|null;content:string|null;next_follow_date:string|null;created_at:string|null;user?:{name:string|null;email:string}|null;customer?:{company_name:string;country:string|null;ai_level:string|null;ai_score:number|null;status:string}|null};
type Payload={data:Item[];count:number;page:number;page_size:number;profile:{id:string;role:string}};
const tabs=[{key:"today",label:"今日待办"},{key:"overdue",label:"已逾期"},{key:"upcoming",label:"后续计划"},{key:"unscheduled",label:"待安排"},{key:"history",label:"跟进记录"}];

export function FollowupsView(){
  const router=useRouter();
  const searchParams=useSearchParams();
  const [scope,setScope]=useState(()=>tabs.some(tab=>tab.key===searchParams.get("scope"))?searchParams.get("scope")!:"today");const [scopeUserId,setScopeUserId]=useState(()=>searchParams.get("user_id")||"");const [query,setQuery]=useState("");const [page,setPage]=useState(1);const [pageSize,setPageSize]=useState(20);const [result,setResult]=useState<{key:string;payload:Payload}|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  const request=useRef<AbortController|null>(null);
  const params=new URLSearchParams({scope,page:String(page),page_size:String(pageSize)});
  if(scopeUserId)params.set("user_id",scopeUserId);
  if(query.trim())params.set("q",query.trim());
  const requestKey=params.toString();
  const payload=result?.key===requestKey?result.payload:null;
  const load=useCallback(async()=>{
    request.current?.abort();
    const controller=new AbortController();
    request.current=controller;
    setLoading(true);setError("");setResult(null);
    try{
      const response=await fetch(`/api/followups?${requestKey}`,{cache:"no-store",signal:controller.signal});
      const body=await response.json().catch(()=>({}));
      if(controller.signal.aborted)return;
      if(!response.ok)throw new Error(body.error||"跟进数据加载失败");
      if(!Array.isArray(body.data)||typeof body.count!=="number")throw new Error("跟进数据返回异常，请重新加载");
      setResult({key:requestKey,payload:body});
    }catch(cause){
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"网络连接异常，请重新加载");
    }finally{
      if(!controller.signal.aborted)setLoading(false);
    }
  },[requestKey]);
  useEffect(()=>{void load();return()=>request.current?.abort()},[load]);
  const exportParams=new URLSearchParams({scope});if(scopeUserId)exportParams.set("user_id",scopeUserId);if(query.trim())exportParams.set("q",query.trim());
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1700px]"><header><h1 className="text-2xl font-bold">跟进管理</h1><p className="mt-1 text-sm text-slate-500">每位当前归属客户只保留一条有效计划；记录本次沟通后，旧计划自动结束。未约定日期的客户在“待安排”，历史沟通保留在“跟进记录”。</p></header>
    <div className="mt-5"><AppTabs value={scope} items={tabs.map(tab=>({value:tab.key,label:tab.label}))} onChange={value=>{setScope(value);setPage(1)}} label="跟进记录范围"/></div>
    <AppFilterBar><label className="relative min-w-[260px] flex-1 xl:min-w-[340px]"><Search size={17} className="absolute left-3 top-3 text-slate-400"/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} placeholder="搜索客户、联系人、电话、邮箱或跟进内容" className={`${appFieldClass} w-full pl-9`}/></label><UserScopeSelect permission="followups.data_all" value={scopeUserId} onChange={value=>{setScopeUserId(value);setPage(1)}} className={`${appFieldClass} min-w-52`}/><a href={`/api/followups/export?${exportParams}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-blue-700"><FileDown size={16}/>导出</a><AppResetButton onClick={()=>{setQuery("");setScopeUserId("");setPage(1)}}/></AppFilterBar>
    {error?<div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}<button onClick={()=>void load()} className="ml-3 underline">重新加载</button></div>:null}
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50"><tr>{["客户名称",scope==="history"?"跟进记录":"最近记录 / 下一步","跟进方式",scope==="history"?"下次计划":"计划时间","客户阶段","AI等级/评分","国家/地区",scope==="history"?"记录人":"当前归属"].map(head=><th key={head} className="px-4 py-3 font-medium">{head}</th>)}<th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 font-medium shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th></tr></thead><tbody>{payload?.data.map(item=><tr key={item.id} onDoubleClick={event=>{if(canOpenListRow(event.target))router.push(`/customers/${item.customer_id}?action=followup&from=followups`)}} className="group cursor-pointer border-t hover:bg-blue-50/30"><td className="max-w-56 truncate px-4 py-3 font-medium" title={item.customer?.company_name||""}>{item.customer?.company_name||"-"}</td><td className="max-w-80 px-4 py-3"><p className="line-clamp-2">{item.content||"尚无跟进记录，请安排首次联系"}</p></td><td className="px-4 py-3">{item.type?FOLLOWUP_TYPE_LABELS[item.type as keyof typeof FOLLOWUP_TYPE_LABELS]||item.type:"—"}</td><td className="px-4 py-3">{item.next_follow_date?new Date(item.next_follow_date).toLocaleString("zh-CN"):"待安排"}</td><td className="px-4 py-3"><AppStatusBadge status={item.customer?.status||""}>{CUSTOMER_STATUS_LABELS[item.customer?.status as keyof typeof CUSTOMER_STATUS_LABELS]||item.customer?.status||"-"}</AppStatusBadge></td><td className="px-4 py-3">{item.customer?.ai_level||"-"} / {item.customer?.ai_score??"-"}</td><td className="px-4 py-3"><CountryLabel value={item.customer?.country}/></td><td className="px-4 py-3">{item.user?.name||item.user?.email||"-"}</td><td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50"><Link href={`/customers/${item.customer_id}?action=followup&from=followups`} className="text-blue-600 hover:underline">{scope==="history"?"查看记录":"记录跟进"}</Link></td></tr>)}</tbody></table>{loading?<div className="grid min-h-52 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div>:!error&&!payload?.data.length?<div className="p-12 text-center text-slate-400"><CalendarClock className="mx-auto mb-2"/>{scope==="today"?"今天没有已安排的跟进；请查看“已逾期”和“待安排”":"当前范围暂无跟进数据"}</div>:null}</div><AppPagination page={page} pageSize={pageSize} total={payload?.count||0} itemLabel={scope==="history"?"条记录":"个客户"} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></section>
  </div></main>
}
