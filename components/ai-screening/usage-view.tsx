"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, Loading, PageHeader, button, formatCost, formatNumber, formatTokens, input, panel } from "@/components/ai-screening/ui";

type UsageTask = { id:string; name:string; task_number:string; total_count:number; processed_count:number; input_tokens:number; cached_input_tokens:number; output_tokens:number; total_tokens:number; total_cost_usd:number; created_at:string };
type UsageBody = { tasks:UsageTask[]; totals:{processed:number;input:number;cached:number;output:number;tokens:number;cost:number}; daily:Array<{date:string;tokens:number;cost:number}> };

export function UsageView() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const [from,setFrom]=useState(monthAgo); const [to,setTo]=useState(today);
  const [data,setData]=useState<UsageBody|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);const response=await fetch(`/api/ai/usage?from=${from}&to=${to}`,{cache:"no-store"});const body=await response.json().catch(()=>({}));setLoading(false);if(!response.ok){setError(body.error||"AI筛选用量查询失败");return}setData(body);setError("")},[from,to]);
  useEffect(()=>{void load()},[load]);
  const average=useMemo(()=>data?.totals.processed?data.totals.cost/data.totals.processed:0,[data]);
  return <main className="min-h-full bg-[#f5f7fb] p-5 lg:p-6"><div className="mx-auto max-w-[1680px] space-y-5">
    <PageHeader title="AI筛选用量" description="仅统计当前用户 AI 筛选任务的真实 Token 与估算费用，不包含其他 AI 获客功能。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className={`${panel} flex flex-wrap items-end gap-3 p-4`}><label className="text-sm text-slate-600">开始日期<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={`${input} ml-2`}/></label><label className="text-sm text-slate-600">结束日期<input type="date" value={to} onChange={e=>setTo(e.target.value)} className={`${input} ml-2`}/></label><button className={button} onClick={()=>void load()}>查询</button></section>
    {error?<ErrorState message={error} reload={()=>void load()}/>:loading?<Loading/>:<>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["已分析客户",formatNumber(data?.totals.processed),"当前日期范围"],["总Token",formatTokens(data?.totals.tokens),`输入 ${formatTokens(data?.totals.input)} / 输出 ${formatTokens(data?.totals.output)}`],["总费用",formatCost(data?.totals.cost),"按模型实际用量估算"],["平均每条费用",formatCost(average),"总费用 ÷ 已分析客户"]].map(([label,value,sub])=><article key={label} className={`${panel} p-5`}><p className="text-sm text-slate-500">{label}</p><b className="mt-2 block text-2xl">{value}</b><small className="text-slate-400">{sub}</small></article>)}</section>
      <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="font-semibold">按任务统计</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["任务","客户数","输入Token","缓存Token","输出Token","总Token","费用","创建时间"].map(x=><th key={x} className="px-4 py-3 font-medium">{x}</th>)}</tr></thead><tbody>{data?.tasks.map(task=><tr key={task.id} className="border-t"><td className="px-4 py-3"><Link className="font-medium text-blue-600" href={`/ai-screening/tasks/${task.id}`}>{task.name}</Link><small className="block text-slate-400">{task.task_number}</small></td><td className="px-4 py-3">{formatNumber(task.processed_count)}/{formatNumber(task.total_count)}</td><td className="px-4 py-3">{formatTokens(task.input_tokens)}</td><td className="px-4 py-3">{formatTokens(task.cached_input_tokens)}</td><td className="px-4 py-3">{formatTokens(task.output_tokens)}</td><td className="px-4 py-3">{formatTokens(task.total_tokens)}</td><td className="px-4 py-3">{formatCost(task.total_cost_usd)}</td><td className="px-4 py-3">{new Date(task.created_at).toLocaleString("zh-CN")}</td></tr>)}</tbody></table>{!data?.tasks.length?<div className="p-12 text-center text-sm text-slate-400">当前日期范围暂无用量</div>:null}</div></section>
    </>}
  </div></main>;
}
