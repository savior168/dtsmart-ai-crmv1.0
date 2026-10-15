"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, BellRing, CheckCheck, LoaderCircle, RotateCcw } from "lucide-react";
import { AppPagination } from "@/components/ui/app-pagination";

type NoticeStatus = "active" | "unread" | "pending" | "archived";
type Notice = { id:string; title:string; content:string|null; href:string|null; read_at:string|null; archived_at:string|null; action_status:"INFO"|"PENDING"|"RESOLVED"; deliver_at:string; created_at:string };

export function NotificationsView(){
  const [rows,setRows]=useState<Notice[]>([]); const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(20); const [count,setCount]=useState(0); const [unread,setUnread]=useState(0); const [pending,setPending]=useState(0); const [status,setStatus]=useState<NoticeStatus>("active"); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");const response=await fetch(`/api/notifications?page=${page}&page_size=${pageSize}&status=${status}`,{cache:"no-store"});const body=await response.json().catch(()=>({}));setLoading(false);if(response.ok){setRows(body.data||[]);setCount(body.count||0);setUnread(body.unread||0);setPending(body.pending||0)}else setError(body.error||"通知加载失败")},[page,pageSize,status]);
  useEffect(()=>{void load()},[load]);
  async function update(id:string|undefined,action:"READ"|"READ_ALL"|"ARCHIVE"|"RESTORE"|"RESOLVE"){const response=await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json","x-dtsmart-toast":"manual-error"},body:JSON.stringify({id,action})});const body=await response.json().catch(()=>({}));if(!response.ok){setError(body.error||"通知更新失败");return}window.dispatchEvent(new Event("focus"));void load()}
  const tabs:Array<[NoticeStatus,string,number|null]>=[["active","全部通知",null],["unread","未读",unread],["pending","待处理",pending],["archived","已归档",null]];
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-5xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><BellRing className="text-blue-600"/>站内通知</h1><p className="mt-1 text-sm text-slate-500">区分阅读状态与业务处理状态；账号审核、跟进提醒、报价和备货流转集中留痕。</p></div>{unread?<button onClick={()=>void update(undefined,"READ_ALL")} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm text-blue-700"><CheckCheck size={17}/>全部已读</button>:null}</div>
    <div className="mt-4 flex flex-wrap gap-2">{tabs.map(([value,label,badge])=><button key={value} onClick={()=>{setStatus(value);setPage(1)}} className={`rounded-lg px-4 py-2 text-sm ${status===value?"bg-blue-600 text-white":"border bg-white"}`}>{label}{badge!==null?` ${badge}`:""}</button>)}</div>
    {error?<p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
    <section className="mt-4 overflow-hidden rounded-xl border bg-white">
      {loading?<div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div>:rows.map(item=><article key={item.id} className={`border-b p-5 last:border-b-0 ${item.read_at?"bg-white":"bg-blue-50/50"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b>{item.title}</b>{!item.read_at?<span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">未读</span>:<span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">已读</span>}{item.action_status==="PENDING"?<span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">待处理</span>:item.action_status==="RESOLVED"?<span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">已处理</span>:null}</div><p className="mt-2 text-sm leading-6 text-slate-600">{item.content||"—"}</p><time className="mt-2 block text-xs text-slate-400">{new Date(item.deliver_at||item.created_at).toLocaleString("zh-CN")}</time></div><div className="flex shrink-0 flex-wrap justify-end gap-2">{!item.read_at?<button onClick={()=>void update(item.id,"READ")} className="rounded-lg border px-3 py-1.5 text-xs">标记已读</button>:null}{item.action_status==="PENDING"?<button onClick={()=>void update(item.id,"RESOLVE")} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700">标记已处理</button>:null}{item.archived_at?<button title="恢复到通知列表" onClick={()=>void update(item.id,"RESTORE")} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"><RotateCcw size={13}/>恢复</button>:<button title="移入归档" onClick={()=>void update(item.id,"ARCHIVE")} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs"><Archive size={13}/>归档</button>}{item.href?<Link onClick={()=>void update(item.id,"READ")} href={item.href} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">查看详情</Link>:null}</div></div></article>)}
      {!rows.length&&!loading?<div className="p-16 text-center text-slate-400">当前分类暂无通知</div>:null}
      <AppPagination page={page} pageSize={pageSize} total={count} itemLabel="条通知" onPage={setPage} onPageSize={(size)=>{setPageSize(size);setPage(1)}}/>
    </section>
  </div></main>
}
