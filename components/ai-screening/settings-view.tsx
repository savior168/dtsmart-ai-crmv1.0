"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CircleDollarSign, Save, ShieldCheck, Sparkles } from "lucide-react";
import { ErrorState, Loading, PageHeader, button, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";

type Provider = "GOOGLE_PLACES" | "OPENAI";
type Budget = { daily_used_usd:number; weekly_used_usd:number; monthly_used_usd:number; daily_reserved_usd?:number; weekly_reserved_usd?:number; monthly_reserved_usd?:number; monthly_blocked_count:number; daily_limit_usd:number|null; weekly_limit_usd:number|null; monthly_limit_usd:number|null };
type Settings = {
  google_paid_enabled:boolean; openai_paid_enabled:boolean;
  google_max_paid_calls_per_customer:number; openai_max_paid_calls_per_customer:number;
  google_daily_limit_usd:number|null; google_weekly_limit_usd:number|null; google_monthly_limit_usd:number|null;
  openai_daily_limit_usd:number|null; openai_weekly_limit_usd:number|null; openai_monthly_limit_usd:number|null;
};
type Payload = { settings:Settings; budgets:Record<Provider,Budget> };
type AmountKey = "google_daily_limit_usd"|"google_weekly_limit_usd"|"google_monthly_limit_usd"|"openai_daily_limit_usd"|"openai_weekly_limit_usd"|"openai_monthly_limit_usd";
type FormState = Omit<Settings,AmountKey>&Record<AmountKey,string>;

const money=(value:unknown)=>`$${Math.max(0,Number(value||0)).toFixed(4)}`;
const percent=(used:number,limit:number|null)=>limit==null||!Number.isFinite(limit)||limit<=0?0:Math.min(100,used/limit*100);

function toForm(settings:Settings):FormState {
  return {
    google_paid_enabled: settings.google_paid_enabled,
    openai_paid_enabled: settings.openai_paid_enabled,
    google_max_paid_calls_per_customer: settings.google_max_paid_calls_per_customer,
    openai_max_paid_calls_per_customer: settings.openai_max_paid_calls_per_customer,
    google_daily_limit_usd: settings.google_daily_limit_usd == null ? "" : String(settings.google_daily_limit_usd),
    google_weekly_limit_usd: settings.google_weekly_limit_usd == null ? "" : String(settings.google_weekly_limit_usd),
    google_monthly_limit_usd: settings.google_monthly_limit_usd == null ? "" : String(settings.google_monthly_limit_usd),
    openai_daily_limit_usd: settings.openai_daily_limit_usd == null ? "" : String(settings.openai_daily_limit_usd),
    openai_weekly_limit_usd: settings.openai_weekly_limit_usd == null ? "" : String(settings.openai_weekly_limit_usd),
    openai_monthly_limit_usd: settings.openai_monthly_limit_usd == null ? "" : String(settings.openai_monthly_limit_usd),
  };
}

export function AiScreeningSettingsView(){
  const [payload,setPayload]=useState<Payload|null>(null);
  const [form,setForm]=useState<FormState|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const {toast,node}=useToast();
  const load=useCallback(async()=>{setLoading(true);setError("");try{const response=await fetch("/api/ai/settings",{cache:"no-store"});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"AI筛选设置加载失败");setPayload(body);setForm(toForm(body.settings))}catch(reason){setError(reason instanceof Error?reason.message:"AI筛选设置加载失败")}finally{setLoading(false)}},[]);
  useEffect(()=>{void load()},[load]);
  async function save(){if(!form)return;setSaving(true);setError("");try{const response=await fetch("/api/ai/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"AI筛选设置保存失败");toast("AI筛选费用与渠道设置已生效");await load()}catch(reason){setError(reason instanceof Error?reason.message:"AI筛选设置保存失败")}finally{setSaving(false)}}
  if(loading&&!payload)return <main className="min-h-full bg-[#f5f7fb] p-6"><Loading text="正在加载AI筛选设置…"/></main>;
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1480px] space-y-4">
    <PageHeader title="AI筛选设置" description="统一管理分析模式、付费补证渠道和费用硬上限；任何任务都不能突破这里的全局限制。" actions={<><Link href="/settings/costs" className={button}>查看费用中心</Link><Link href="/ai-screening" className={button}>返回任务中心</Link><button disabled={saving||!form} onClick={()=>void save()} className={primaryButton}><Save size={16}/>{saving?"保存中":"保存设置"}</button></>}/>
    {error?<ErrorState message={error} reload={()=>void load()}/>:null}
    <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-blue-600"/>任务分析模式</h2><p className="mt-1 text-sm text-slate-500">创建任务时选择，分析规则和评分标准保持一致；差别仅在是否允许付费补证。</p></div><div className="grid gap-3 p-5 lg:grid-cols-2"><article className="rounded-xl border border-blue-200 bg-blue-50/50 p-4"><b className="text-blue-800">智能分析（高性价比）</b><p className="mt-2 text-sm leading-6 text-slate-600">官网、公开页面和已有证据优先；明确结论立即停止。只有高价值且仍存在冲突的客户，才在本页所有费用上限允许时调用Google Places或OpenAI。</p></article><article className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4"><b className="text-emerald-800">快速分析（完全免费）</b><p className="mt-2 text-sm leading-6 text-slate-600">执行相同的官网深度分析、主体匹配、公开来源核验和评分规则，但禁止所有正金额API调用；明确免费的Google IDs Only仍可使用。</p></article></div></section>
    <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-blue-600"/>付费渠道总开关</h2><p className="mt-1 text-sm text-slate-500">关闭后所有新任务和进行中的任务都会在下一次调用前被后端拦截，免费来源继续工作。</p></div><div className="grid gap-3 p-5 lg:grid-cols-2">{([{"provider":"GOOGLE_PLACES" as const,"key":"google_paid_enabled" as const,"title":"Google Places付费详情","description":"用于少数主体匹配或行业证据冲突客户；免费IDs Only不受此开关影响。"},{"provider":"OPENAI" as const,"key":"openai_paid_enabled" as const,"title":"OpenAI模型复核","description":"仅综合已采集且通过主体校验的真实证据，不用于漫无目的搜索。"}]).map(item=><label key={item.provider} className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border bg-slate-50 p-4"><span><b>{item.title}</b><small className="mt-1 block leading-5 text-slate-500">{item.description}</small></span><input type="checkbox" className="mt-1 h-5 w-5 accent-blue-600" checked={Boolean(form?.[item.key])} onChange={event=>setForm(current=>current?{...current,[item.key]:event.target.checked}:current)} aria-label={`启用${item.title}`}/></label>)}</div></section>
    <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><CircleDollarSign size={18} className="text-blue-600"/>全局费用硬上限</h2><p className="mt-1 text-sm text-slate-500">每日、每周、每月任一上限触发即停止对应平台付费调用。留空表示不限制，0表示完全禁止；按北京时间重置。</p></div><div className="grid gap-4 p-5 xl:grid-cols-2">{(["GOOGLE_PLACES","OPENAI"] as Provider[]).map(provider=>{const prefix=provider==="GOOGLE_PLACES"?"google":"openai";const budget=payload?.budgets?.[provider];return <article key={provider} className="rounded-xl border bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><b>{provider==="GOOGLE_PLACES"?"Google Places":"OpenAI"}</b><small className="mt-1 block text-slate-500">本月已拦截 {Number(budget?.monthly_blocked_count||0).toLocaleString("zh-CN")} 次</small></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${form?.[`${prefix}_paid_enabled` as keyof FormState]?"bg-emerald-50 text-emerald-700":"bg-slate-200 text-slate-600"}`}>{form?.[`${prefix}_paid_enabled` as keyof FormState]?"允许按需调用":"已停用"}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-3">{(["daily","weekly","monthly"] as const).map(period=>{const key=`${prefix}_${period}_limit_usd` as AmountKey;const used=Number(budget?.[`${period}_used_usd` as keyof Budget]||0);const reserved=Number(budget?.[`${period}_reserved_usd` as keyof Budget]||0);const limit=form?.[key]===""?null:Number(form?.[key]);return <label key={period} className="text-sm text-slate-600"><span>{period==="daily"?"每日":period==="weekly"?"每周":"每月"}上限（USD）</span><input type="number" min="0" step="0.01" className={`${input} mt-1.5 w-full`} value={form?.[key]||""} placeholder="不限制" onChange={event=>setForm(current=>current?{...current,[key]:event.target.value}:current)}/><span className="mt-1.5 block text-xs text-slate-500">已占用 {money(used)}{reserved>0?`，含预留 ${money(reserved)}`:""}</span><span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200"><i className="block h-full rounded-full bg-blue-600" style={{width:`${percent(used,limit)}%`}}/></span></label>})}</div></article>})}</div><p className="border-t px-5 py-3 text-xs text-slate-500">重置口径：每日00:00、每周一00:00、每月1日00:00（Asia/Shanghai）。执行中预留金额计入占用，防止并发任务突破上限。</p></section>
    <section className={`${panel} overflow-hidden`}><div className="border-b px-5 py-4"><h2 className="font-semibold">单客户付费调用保护</h2><p className="mt-1 text-sm text-slate-500">这是全局最大次数；证据足够时系统会更早停止，不会为了用满次数继续调用。</p></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="text-sm font-medium">Google Places付费详情最多调用<select className={`${input} mt-2 w-full`} value={form?.google_max_paid_calls_per_customer??2} onChange={event=>setForm(current=>current?{...current,google_max_paid_calls_per_customer:Number(event.target.value)}:current)}><option value={0}>0次（禁止）</option><option value={1}>1次（最低成本）</option><option value={2}>2次（仅冲突候选）</option></select><small className="mt-1.5 block font-normal leading-5 text-slate-500">同一客户同一任务最多2次，优先选择身份匹配度最高的候选。</small></label><label className="text-sm font-medium">OpenAI模型最多调用<select className={`${input} mt-2 w-full`} value={form?.openai_max_paid_calls_per_customer??1} onChange={event=>setForm(current=>current?{...current,openai_max_paid_calls_per_customer:Number(event.target.value)}:current)}><option value={0}>0次（禁止）</option><option value={1}>1次（推荐）</option></select><small className="mt-1.5 block font-normal leading-5 text-slate-500">不自动重复调用；一次仍有冲突时按已取得证据形成结果并突出风险。</small></label></div></section>
  </div>{node}</main>;
}
