"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, Loading, PageHeader, button, effectiveElapsedMs, formatCost, formatDuration, formatNumber, formatTokens, panel, primaryButton } from "@/components/ai-screening/ui";
import type { AcquisitionTask } from "./types";

type UsageRow = { provider:string; model_or_sku:string; operation:string; calls:number; free_calls:number; amount_usd:number };
type UsageSummary = { total_calls:number; free_calls:number; google_calls:number; openai_calls:number; total_tokens:number; total_cost_usd:number; actual_cost_usd?:number; sku_breakdown:UsageRow[] };
type SearchStat = { query:string; candidates:number; duplicates:number; rejected:number; review:number; accepted:number; claimed:number; progressed:number; cost_usd:number };
type Candidate = { id:string; imported_customer_id:string|null; company_name:string; decision:string; ai_score:number|null; ai_level:string|null; manual_score?:number|null; manual_level?:string|null; effective_score?:number|null; country:string; matched_keywords:string[]|null };
type ReportData = { task:AcquisitionTask; candidates:Candidate[]; report_candidates?:Candidate[]; usage_summary:UsageSummary|null; usage_error?:boolean; search_stats:SearchStat[]; search_stats_error?:boolean; discovery_progress:{raw_hits:number}|null };

const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type:"region" });

function CompactList({ values, limit=10 }:{ values:string[]; limit?:number }) {
  const clean=[...new Set(values.filter(Boolean))];
  return <div className="flex flex-wrap gap-1.5">{clean.slice(0,limit).map((value)=><span key={value} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">{value}</span>)}{clean.length>limit?<span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">另有 {clean.length-limit} 项</span>:null}</div>;
}

export function AcquisitionTaskReport({ taskId }:{ taskId:string }) {
  const [data,setData]=useState<ReportData|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/ai-acquisition/tasks/${taskId}?report=1&page=1&pageSize=10`,{cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"获客任务报告加载失败");
      setData({...body,candidates:body.report_candidates||[]});
    }catch(reason){setError(reason instanceof Error?reason.message:"获客任务报告加载失败");}
    finally{setLoading(false);}
  },[taskId]);
  useEffect(()=>{void load();},[load]);
  if(loading&&!data)return <main className="min-h-full bg-[#f5f7fb] p-6"><Loading/></main>;
  if(error&&!data)return <main className="min-h-full bg-[#f5f7fb] p-6"><ErrorState message={error} reload={()=>void load()}/></main>;
  if(!data)return null;
  const {task,usage_summary:usage,search_stats:searchStats,discovery_progress:progress}=data;
  const rawHits=Number(progress?.raw_hits||0);
  const totalCost=Number(usage?.actual_cost_usd??usage?.total_cost_usd??0);
  const averageCost=task.accepted_count?totalCost/task.accepted_count:0;
  const funnel=[
    ["原始搜索命中",rawHits,"搜索渠道返回，尚未去重"],
    ["去重后候选",task.discovered_count,"已剔除本任务内重复命中"],
    ["完成AI核验",task.processed_count,"已完成主体、业务和证据判断"],
    ["成功进入公海",task.accepted_count,"满足质量门槛并完成入池"],
  ] as const;
  const accepted=data.candidates.filter((item)=>item.decision==="ACCEPTED").sort((a,b)=>Number(b.effective_score||0)-Number(a.effective_score||0)).slice(0,10);
  const bestSearches=[...(searchStats||[])].sort((a,b)=>b.accepted-a.accepted||a.cost_usd-b.cost_usd).slice(0,12);
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title={`${task.name} · 获客报告`} description={`任务编号 ${task.task_number} · 创建于 ${new Date(task.created_at).toLocaleString("zh-CN",{hour12:false})} · 报告数据来自本任务可核验执行记录`} actions={<><Link href={`/ai-acquisition/tasks/${task.id}`} className={button}>返回任务详情</Link><button type="button" onClick={()=>window.print()} className={primaryButton}><Printer size={16}/>打印或保存PDF</button></>}/>
    {data.usage_error?<section className={`${panel} p-4 text-sm text-amber-800`}>费用台账本次查询超时，以下成本和调用数据暂不展示；客户核验结果不受影响。请稍后刷新报告。</section>:null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[
      ["成功入池",`${formatNumber(task.accepted_count)} 个`,`待复核 ${formatNumber(task.review_count)} 个`],
      ["入池转化率",task.discovered_count?`${(task.accepted_count/task.discovered_count*100).toFixed(1)}%`:"—","成功入池 ÷ 去重后候选"],
      ["平均有效客户成本",usage?formatCost(averageCost):"—","实际已产生费用 ÷ 成功入池"],
      ["任务实际费用",usage?formatCost(totalCost):"—","不含Google未确认估算费用"],
      ["Google / OpenAI",usage?`${formatNumber(usage.google_calls)} / ${formatNumber(usage.openai_calls)} 次`:"—",usage?`${formatTokens(usage.total_tokens)} Token`:"统计暂不可用"],
      ["有效执行耗时",formatDuration(effectiveElapsedMs(task)),"不含预约等待与暂停时间"],
    ].map(([label,value,note])=><article key={label} className={`${panel} p-4`}><small className="text-slate-500">{label}</small><b className="mt-2 block text-xl text-slate-950">{value}</b><small className="mt-1 block text-slate-400">{note}</small></article>)}</section>

    <section className={`${panel} p-5`}><div><h2 className="font-semibold">获客质量漏斗</h2><p className="mt-1 text-xs text-slate-500">从公开搜索命中到成功入池的完整处理链路；各环节数量口径不同，不把原始命中当作客户数量。</p></div><div className="mt-4 grid gap-3 md:grid-cols-4">{funnel.map(([label,value,note],index)=><div key={label} className="relative rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"><span className="text-xs text-slate-500">{index+1}. {label}</span><b className="mt-2 block text-2xl">{formatNumber(value)}</b><small className="mt-1 block text-slate-400">{note}</small>{index<funnel.length-1?<span className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 place-items-center rounded-full bg-blue-600 text-xs text-white md:grid">›</span>:null}</div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-4">{[["成功入池",task.accepted_count,"text-emerald-700"],["待人工复核",task.review_count,"text-amber-700"],["未通过",task.rejected_count,"text-slate-700"],["系统重复",task.duplicate_count,"text-violet-700"]].map(([label,value,tone])=><div key={String(label)} className="rounded-lg border px-4 py-3"><small className="text-slate-500">{label}</small><b className={`mt-1 block text-lg ${tone}`}>{formatNumber(Number(value))} 个</b></div>)}</div></section>

    <section className="grid gap-4 xl:grid-cols-2"><article className={`${panel} p-5`}><h2 className="font-semibold">任务范围与执行口径</h2><dl className="mt-4 grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 text-sm"><dt className="text-slate-500">目标国家/地区</dt><dd><CompactList values={task.countries.map((code)=>COUNTRY_NAMES.of(code)||code)} limit={8}/></dd><dt className="text-slate-500">目标行业</dt><dd><CompactList values={task.industries?.length?task.industries:[task.industry]} limit={10}/></dd><dt className="text-slate-500">搜索关键词</dt><dd><CompactList values={task.keywords} limit={12}/></dd><dt className="text-slate-500">获客模式</dt><dd className="font-medium">{task.cost_mode==="FREE_ONLY"?"标准获客":"智能获客"}</dd></dl></article><article className={`${panel} p-5`}><h2 className="font-semibold">报告结论与行动建议</h2><div className="mt-4 space-y-3 text-sm leading-6 text-slate-600"><p><b className="text-slate-900">结果：</b>本任务获得 {formatNumber(task.accepted_count)} 个已核验并成功入池客户，另有 {formatNumber(task.review_count)} 个候选需人工核对后决定是否入池。</p><p><b className="text-slate-900">销售动作：</b>优先认领高评分客户，并从客户详情核对公开来源、匹配关键词、已核验联系方式和商机线索后开展跟进。</p><p><b className="text-slate-900">成本动作：</b>优先复用高入池率、低平均成本的检索组合；持续降权只有命中但无入池结果的搜索表达。</p><div className="flex flex-wrap gap-2 pt-1"><Link href={`/ai-acquisition/tasks/${task.id}?decision=ACCEPTED#customer-results`} className={primaryButton}>查看成功入池客户</Link>{task.review_count?<Link href={`/ai-acquisition/tasks/${task.id}?decision=REVIEW#customer-results`} className={button}>处理待复核客户</Link>:null}</div></div></article></section>

    <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="font-semibold">高价值客户摘要</h2><p className="mt-1 text-xs text-slate-500">按当前评分优先展示本任务已成功入池客户；点击后直接打开客户公海中的客户详情。</p></div><div className="overflow-x-auto"><table className="w-full min-w-[860px] table-fixed text-left text-sm"><colgroup><col className="w-[260px]"/><col className="w-[120px]"/><col className="w-[150px]"/><col className="w-[260px]"/><col className="w-[120px]"/></colgroup><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["客户名称","当前评分","国家/地区","匹配关键词","操作"].map((label)=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{accepted.map((item)=><tr key={item.id} className="border-t"><td className="px-4 py-3 font-medium text-slate-900">{item.company_name}</td><td className="px-4 py-3">{item.manual_level||item.ai_level||"—"} · {item.manual_score??item.ai_score??"—"}{item.manual_score!=null?<small className="ml-1 text-blue-700">人工</small>:null}</td><td className="px-4 py-3">{COUNTRY_NAMES.of(item.country)||item.country}</td><td className="px-4 py-3"><CompactList values={item.matched_keywords||[]} limit={3}/></td><td className="px-4 py-3">{item.imported_customer_id?<Link className="font-medium text-blue-600 hover:underline" href={`/customers/${item.imported_customer_id}?from=pool`}>客户详情</Link>:<span className="text-slate-400">尚未入池</span>}</td></tr>)}</tbody></table>{!accepted.length?<div className="p-10 text-center text-sm text-slate-400">本任务暂无成功入池客户</div>:null}</div></section>

    {data.search_stats_error?<section className={`${panel} p-5 text-sm text-amber-700`}>搜索组合统计暂不可用，本报告未展示部分统计数据，请稍后重试；上方任务总数不受影响。</section>:bestSearches.length?<section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="font-semibold">搜索组合效果</h2><p className="mt-1 text-xs text-slate-500">按成功入池数量优先排列，用于判断后续任务应保留或降权的检索组合。</p></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["检索组合","发现候选","成功入池","待复核","未通过","已认领","已推进","成本参考","平均入池成本"].map((label)=><th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{bestSearches.map((item)=><tr key={item.query} className="border-t"><td className="max-w-80 px-4 py-3 font-medium text-slate-800">{item.query}</td><td className="px-4 py-3">{item.candidates}</td><td className="px-4 py-3 font-medium text-emerald-700">{item.accepted}</td><td className="px-4 py-3">{item.review}</td><td className="px-4 py-3">{item.rejected}</td><td className="px-4 py-3">{item.claimed}</td><td className="px-4 py-3">{item.progressed}</td><td className="px-4 py-3">{formatCost(item.cost_usd)}</td><td className="px-4 py-3">{item.accepted?formatCost(item.cost_usd/item.accepted):"—"}</td></tr>)}</tbody></table></div></section>:null}

    {usage?.sku_breakdown?.length?<section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="font-semibold">第三方调用与成本汇总</h2><p className="mt-1 text-xs text-slate-500">报告只展示模型与SKU汇总，不重复铺开逐次调用流水。</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["服务商","模型 / SKU","用途","调用","免费","成本参考"].map((label)=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{usage.sku_breakdown.map((item)=><tr key={`${item.provider}-${item.model_or_sku}-${item.operation}`} className="border-t"><td className="px-4 py-3">{item.provider}</td><td className="px-4 py-3">{item.model_or_sku}</td><td className="px-4 py-3">{item.operation}</td><td className="px-4 py-3">{item.calls}</td><td className="px-4 py-3">{item.free_calls}</td><td className="px-4 py-3">{formatCost(item.amount_usd)}</td></tr>)}</tbody></table></div></section>:null}
    <p className="px-1 text-xs leading-5 text-slate-400">口径说明：成功入池仅统计通过主体、目标行业、在营证据、有效联系方式及系统去重门槛并已写入客户公海的客户；实际费用包含已发生的OpenAI用量和服务商已确认费用，不包含Google未确认价目估算或超额预计费用。</p>
  </div><style jsx global>{`@media print{.crm-topbar,aside,button{display:none!important}.crm-content{min-height:0!important}main{padding:0!important;background:#fff!important}section,article{break-inside:avoid}}`}</style></main>;
}
