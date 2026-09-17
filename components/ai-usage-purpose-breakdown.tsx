import { formatCost, formatNumber, formatTokens, panel } from "@/components/ai-screening/ui";

export type PurposeUsage = { provider:string;purpose:string;calls:number;tokens:number;cost_usd:number };

export function AiUsagePurposeBreakdown({ rows, googleCostLabel="价目估算" }:{ rows:PurposeUsage[]; googleCostLabel?:string }) {
  const groups = [
    { provider:"GOOGLE_PLACES", title:"Google Places 用在哪些工作", color:"bg-emerald-500", empty:"当前范围没有 Google Places 调用" },
    { provider:"OPENAI", title:"OpenAI Token 用在哪些工作", color:"bg-blue-600", empty:"当前范围没有 OpenAI 调用" },
  ];
  return <section className={`${panel} overflow-hidden`}><div className="border-b px-4 py-3"><h2 className="text-[17px] font-semibold">第三方平台消耗用途</h2><p className="mt-1 text-sm text-slate-500">按真实调用台账归类；同一次 OpenAI 综合分析不会被虚拆成多个工作，避免重复统计 Token 和费用。</p></div><div className="grid gap-4 p-4 lg:grid-cols-2">{groups.map(group=>{const items=rows.filter(row=>row.provider===group.provider);const totalCalls=items.reduce((sum,row)=>sum+Number(row.calls||0),0);const totalTokens=items.reduce((sum,row)=>sum+Number(row.tokens||0),0);return <article key={group.provider} className="rounded-xl border bg-slate-50/70"><div className="flex items-center justify-between gap-3 border-b px-4 py-3"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${group.color}`}/><b>{group.title}</b></div><small className="text-slate-500">{formatNumber(totalCalls)} 次{group.provider==="OPENAI"?` · ${formatTokens(totalTokens)}`:""}</small></div>{items.length?<div className="divide-y px-4">{items.map(item=><div key={`${item.provider}:${item.purpose}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-sm"><div className="min-w-0"><b className="block truncate font-medium text-slate-700">{item.purpose}</b><small className="text-slate-400">{group.provider==="OPENAI"?`${formatTokens(item.tokens)} · ${formatCost(item.cost_usd)}`:`${googleCostLabel} ${formatCost(item.cost_usd)}`}</small></div><strong className="whitespace-nowrap">{formatNumber(item.calls)} 次</strong></div>)}</div>:<p className="px-4 py-8 text-center text-sm text-slate-400">{group.empty}</p>}</article>})}</div></section>;
}
