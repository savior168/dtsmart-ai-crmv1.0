"use client";

import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppSelect } from "@/components/ui/app-select";
import { GroupedEvidenceSection, VerifiedContactsSection, type EvidenceDisplayItem, type VerifiedContactDisplayItem } from "@/components/ai-screening/evidence-sections";
import { button, primaryButton } from "@/components/ai-screening/ui";
import type { Candidate } from "./types";
import { MANUAL_REVIEW_INDUSTRIES, type ManualReviewInput } from "@/lib/ai-acquisition/manual-review";
import { acquisitionIndustryMatchesVerifiedResult } from "@/lib/ai-acquisition/industry-match";
import { officialWebsiteUrl } from "@/lib/public-url";

export type CandidateEvidenceData = {
  evidence_available?: boolean;
  target_industries?: string[];
  website_url?: string | null;
  candidate: Candidate;
  analysis: {
    score?: number;
    grade?: string;
    short_reason?: string;
    identity_status?: string;
    verified_business_name?: string | null;
    verified_address?: string | null;
    match_signals?: string[] | null;
    mismatch_signals?: string[] | null;
    industry_type?: string;
    target_decision?: string;
    evidence_sufficiency_score?: number;
    business_scope?: string;
    company_scale_evidence?: string;
    customer_value?: string;
    followup_suggestion?: string;
  } | null;
  evidence: Array<{
    id: string;
    source_url: string;
    source_type: string;
    channel?: string;
    title?: string;
    evidence_type: string;
    evidence_strength: string;
    evidence_confidence?: number;
    identity_match_status?: string;
    normalized_fact?: string;
    translated_fact?: string;
    content?: string;
    original_excerpt?: string;
    metadata?: { media_urls?: string[] } | null;
    created_at?: string;
  }>;
  contacts: Array<{
    id: string;
    type: string;
    value_raw: string;
    verification_status: string;
    source_channel: string;
    exact_source_url: string;
  }>;
};

const identityLabel: Record<string, string> = { MATCHED: "主体一致", AMBIGUOUS: "主体待确认", CONFLICT: "主体冲突", NOT_FOUND: "未确认主体" };
const displayEvidence = (evidence: CandidateEvidenceData) => evidence.evidence.map((item) => ({
  id: item.id,
  channel: item.channel || item.source_type,
  source_type: item.source_type,
  source_url: item.source_url,
  title: item.title,
  normalized_fact: item.translated_fact || item.normalized_fact || item.content,
  original_excerpt: item.original_excerpt,
  metadata: item.metadata,
  fetched_at: item.created_at,
  evidence_type: item.evidence_type,
  evidence_confidence: item.evidence_confidence,
  identity_match_label: identityLabel[item.identity_match_status || ""] || "主体待核验",
})) as EvidenceDisplayItem[];

export function CandidateEvidenceDialog({
  evidence,
  canControl,
  reviewBusy = false,
  onClose,
  onReview,
  onSaveAssessment,
}: {
  evidence: CandidateEvidenceData | null;
  canControl: boolean;
  reviewBusy?: boolean;
  onClose: () => void;
  onReview: (action: "DISCARD" | "RECHECK_AND_ACCEPT", candidateId: string) => void;
  onSaveAssessment: (candidateId: string, assessment: ManualReviewInput) => Promise<void>;
}) {
  const [score,setScore]=useState("");
  const [targetDecision,setTargetDecision]=useState<"VALID"|"INVALID">("VALID");
  const [industry,setIndustry]=useState("");
  const [reason,setReason]=useState("");
  const [selectedEvidence,setSelectedEvidence]=useState<string[]>([]);
  const [saving,setSaving]=useState(false);
  const [formError,setFormError]=useState("");
  useEffect(()=>{
    const candidate=evidence?.candidate;
    setScore(candidate?.manual_score==null?"":String(candidate.manual_score));
    setTargetDecision(candidate?.manual_target_decision==="INVALID"?"INVALID":"VALID");
    setIndustry(candidate?.manual_industry||evidence?.analysis?.industry_type||"");
    setReason(candidate?.manual_reason||"");
    const selectableIds = new Set(evidence?.evidence.filter((item)=>/^https?:\/\//i.test(item.source_url)&&item.evidence_strength!=="WEAK_HINT"&&item.evidence_type==="支持").map((item)=>item.id));
    setSelectedEvidence((candidate?.manual_evidence_ids||[]).filter((id)=>selectableIds.has(id)));
    setFormError("");
  },[evidence]);
  async function saveAssessment(acceptAfterSave = false){
    if(!evidence)return;
    const value=Number(score);
    if(!score.trim()||!Number.isInteger(value)||value<0||value>100){setFormError("请输入 0–100 的整数评分");return}
    if(reason.trim().length<10){setFormError("请填写至少 10 字的具体改分理由");return}
    if(targetDecision==="VALID"&&!selectedEvidence.length){setFormError("请勾选至少一条直接证明目标业务的经营证据");return}
    setSaving(true);setFormError("");
    try{await onSaveAssessment(evidence.candidate.id,{score:value,targetDecision,industry,reason:reason.trim(),evidenceIds:selectedEvidence});if(acceptAfterSave)onReview("RECHECK_AND_ACCEPT",evidence.candidate.id)}
    catch(error){setFormError(error instanceof Error?error.message:"保存人工复核失败")}
    finally{setSaving(false)}
  }
  const items = evidence ? displayEvidence(evidence) : [];
  const businessEvidence = evidence?.evidence.filter((item)=>/^https?:\/\//i.test(item.source_url)&&item.evidence_strength!=="WEAK_HINT"&&item.evidence_type==="支持") || [];
  const businessSources = [...businessEvidence.reduce((groups,item)=>{
    const key = `${item.channel||item.source_type}|${item.source_url}`;
    const current = groups.get(key) || {key,channel:item.channel||item.source_type,url:item.source_url,ids:[] as string[],facts:[] as string[]};
    current.ids.push(item.id);
    const fact = String(item.translated_fact||item.original_excerpt||item.title||"").trim();
    if(fact&&!current.facts.includes(fact))current.facts.push(fact);
    groups.set(key,current);
    return groups;
  },new Map<string,{key:string;channel:string;url:string;ids:string[];facts:string[]}>()).values()]
    .sort((left,right)=>Number(right.channel==="website"||right.channel==="OFFICIAL_WEBSITE")-Number(left.channel==="website"||left.channel==="OFFICIAL_WEBSITE"));
  const websiteUrl = officialWebsiteUrl(evidence?.website_url);
  const websiteEvidence = businessEvidence.some((item)=>item.channel==="website"||item.source_type==="OFFICIAL_WEBSITE");
  const targetIndustries = evidence?.target_industries || [];
  const selectedFacts = evidence?.evidence.filter((item)=>selectedEvidence.includes(item.id)).flatMap((item)=>[item.translated_fact,item.original_excerpt]) || [];
  const industryMatches = targetDecision !== "VALID" || !industry || !selectedEvidence.length || acquisitionIndustryMatchesVerifiedResult(targetIndustries,industry,selectedFacts);
  return <AppDialog
    open={Boolean(evidence)}
    title={evidence?.candidate.company_name || "客户核验依据"}
    description="所有联系方式均链接至实际发现该信息的具体公开页面；Google Maps 仅作为发现来源，不代替行业和在营证据。"
    onClose={onClose}
    width="max-w-5xl"
  >
    {evidence ? <div className="space-y-5">
      {!evidence.evidence_available ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800"><b className="mr-2">早筛依据</b>{evidence.candidate.decision_reason || "该候选在深度核验前已因重复、停业或缺少目标行业信号停止，因此没有生成完整AI证据报告。"}</p> : null}
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-blue-50 p-4"><small>AI评分</small><b className="mt-1 block">{evidence.analysis?.grade || "—"} · {evidence.analysis?.score ?? "—"}</b></div>
        <div className="rounded-xl bg-slate-50 p-4"><small>主体状态</small><b className="mt-1 block">{identityLabel[evidence.analysis?.identity_status || ""] || "主体待核验"}</b></div>
        <div className="rounded-xl bg-slate-50 p-4"><small>证据充分度</small><b className="mt-1 block">{evidence.analysis?.evidence_sufficiency_score != null ? `${evidence.analysis.evidence_sufficiency_score} / 100` : "—"}</b></div>
      </section>
      {evidence.candidate.decision === "REVIEW" && !["MATCHED","LIKELY_MATCHED"].includes(evidence.analysis?.identity_status || "") ? <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        <b>主体需单独核对：</b>人工改分和经营行业判断不会改写原 AI 主体结论。请对照当前客户“{evidence.candidate.company_name}”与来源商家“{evidence.analysis?.verified_business_name || "尚未取得可核验名称"}”{evidence.analysis?.verified_address ? `、地址“${evidence.analysis.verified_address}”` : ""}。
        {evidence.analysis?.mismatch_signals?.length ? <span className="block">系统记录的差异：{evidence.analysis.mismatch_signals.slice(0,3).join("；")}</span> : null}
        <span className="block">若来源确属同一商家但旧分析未确认，应补齐可追溯的名称、地址或联系方式依据并重新分析；仅重复点击入池不会重新采集。</span>
      </section> : null}
      {evidence.analysis?.short_reason ? <p className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm leading-6 text-slate-700"><b className="mr-2 text-blue-800">核验结论</b>{evidence.analysis.short_reason}</p> : null}
      <VerifiedContactsSection contacts={evidence.contacts as VerifiedContactDisplayItem[]} customer={{
        country: evidence.candidate.country,
        phone: evidence.candidate.customer_profile?.phone,
        whatsapp: evidence.candidate.customer_profile?.whatsapp,
        email: evidence.candidate.customer_profile?.email,
        website: evidence.candidate.customer_profile?.website || evidence.candidate.source_website,
        google_url: evidence.candidate.customer_profile?.google_url || evidence.candidate.google_url,
        facebook_url: evidence.candidate.customer_profile?.facebook_url,
        instagram_url: evidence.candidate.customer_profile?.instagram_url,
        linkedin_url: evidence.candidate.customer_profile?.linkedin_url,
        tiktok_url: evidence.candidate.customer_profile?.tiktok_url,
      }} evidence={items}/>
      <section><h3 className="font-semibold">商机线索与销售建议</h3><div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-sm"><b className="text-emerald-800">可核验经营/采购线索</b><p className="mt-1 leading-6 text-slate-600">{evidence.analysis?.company_scale_evidence || evidence.analysis?.business_scope || "未发现带来源的采购、批发或经营规模线索"}</p></div>
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm"><b className="text-blue-800">AI销售建议</b><p className="mt-1 leading-6 text-slate-600">{evidence.analysis?.followup_suggestion || evidence.analysis?.customer_value || "先依据已核验经营事实联系客户，再确认实际采购需求"}</p><small className="mt-2 block text-slate-400">建议不代表客户已经表达采购意向。</small></div>
      </div></section>
      {evidence.candidate.decision === "REVIEW" ? <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        <b>当前复核阻点：</b>已核验行业 {evidence.analysis?.industry_type || "未确认"}；主体匹配 {evidence.analysis?.identity_status || "未确认"}；
        带具体来源的已核验联系方式 {evidence.contacts.length} 条。评分和官网链接不能代替目标行业、主体一致性及可追溯联系方式的核验。
        如已有新证据，需先补充来源或重新分析；下方按钮只按现有结果核对入池，不会重新采集证据。
      </section> : null}
      <GroupedEvidenceSection evidence={items}/>
      {canControl && evidence.candidate.decision === "REVIEW" ? <section className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4 text-sm">
        <div><h3 className="font-semibold text-slate-900">第一步 · 核对并保存人工结论</h3><p className="mt-1 text-xs leading-5 text-slate-600">请结合上方来源证据填写评分、经营行业和理由。原 AI 评分保留，不会被覆盖。任务目标行业：<b className="text-slate-800">{targetIndustries.join("、") || "未指定"}</b>。</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1"><span>人工评分（0–100）</span><input type="number" min={0} max={100} step={1} value={score} onChange={(event)=>setScore(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2" placeholder={evidence.analysis?.score == null ? "按证据评分" : `AI 原评 ${evidence.analysis.score}，请独立评分`}/></label>
          <label className="space-y-1"><span>是否符合本任务目标</span><AppSelect value={targetDecision} onChange={(event)=>setTargetDecision(event.target.value as "VALID"|"INVALID")} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="VALID">符合目标（评分 ≥60）</option><option value="INVALID">不符合目标（评分 &lt;60）</option></AppSelect></label>
          <label className="space-y-1"><span>核实后的经营行业</span><AppSelect value={industry} onChange={(event)=>setIndustry(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">请选择</option>{MANUAL_REVIEW_INDUSTRIES.map((item)=><option key={item} value={item}>{item}</option>)}</AppSelect></label>
        </div>
        <label className="block space-y-1"><span>改分理由与经营事实</span><textarea value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={1000} rows={3} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2" placeholder="说明原 AI 判断错在哪里、公开页面具体证明了什么"/></label>
        <fieldset className="space-y-2"><legend className="font-medium">勾选直接证明目标经营业务的来源</legend><p className="text-xs text-slate-500">同一渠道的同一页面只需勾选一次，系统仍保存该页面关联的每条原始事实。电话、邮箱和官网网址本身不能代替经营事实。</p>{businessSources.map((source)=><label key={source.key} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3"><input type="checkbox" checked={source.ids.some((id)=>selectedEvidence.includes(id))} onChange={(event)=>setSelectedEvidence((current)=>event.target.checked?[...new Set([...current,...source.ids])]:current.filter((id)=>!source.ids.includes(id)))} className="mt-1"/><span className="min-w-0"><span className="mb-1 inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">{source.channel==="website"||source.channel==="OFFICIAL_WEBSITE"?"企业官网":source.channel==="google_maps"?"Google 商家":source.channel||"其他公开来源"}</span><span className="block text-xs leading-5 text-slate-700">{source.facts.join("；")||"公开经营事实"}</span><a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-xs text-blue-700 hover:underline" onClick={(event)=>event.stopPropagation()}>{source.url}</a></span></label>)}{!businessSources.length?<p className="text-amber-700">暂无已保存的直接经营证据；不能只凭改分入池。</p>:null}{websiteUrl&&!websiteEvidence?<p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">当前客户档案有<a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="mx-1 font-medium underline">官网网址</a>，但本次分析未保存该官网的经营事实，因此它暂不能被勾选为已核验证据。请先打开核实；如官网确有目标业务，需补充可追溯证据或重新分析后再入池。</p>:null}</fieldset>
        {!industryMatches?<p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">所选“{industry}”与任务目标“{targetIndustries.join("、")}”及已勾选的经营证据暂不匹配。请核对经营分类或补选直接证据；仅有联系方式不能证明行业。</p>:null}
        {formError?<p role="alert" className="text-rose-700">{formError}</p>:null}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">可以先保存，稍后继续核对；符合目标的结论可保存后直接校验入池。</p><div className="flex flex-wrap gap-2"><button type="button" disabled={saving||reviewBusy} onClick={()=>void saveAssessment()} className={button}>{saving?"保存中…":"仅保存复核"}</button>{targetDecision==="VALID"?<button type="button" disabled={saving||reviewBusy||!industryMatches} onClick={()=>void saveAssessment(true)} className={primaryButton}>{saving||reviewBusy?"处理中…":"保存并校验入池"}</button>:null}</div></div>
      </section> : null}
      {canControl && evidence.candidate.decision === "REVIEW" ? <section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-2xl text-sm leading-6 text-slate-500">第二步 · 校验入池仍由系统检查主体、有效联系方式和重复客户；校验不重新采集。舍弃会停止处理这条候选。</p><div className="flex flex-wrap gap-2"><button type="button" disabled={saving||reviewBusy} className={`${button} text-rose-600 hover:border-rose-400 hover:text-rose-700`} onClick={() => onReview("DISCARD", evidence.candidate.id)}>舍弃候选</button>{evidence.candidate.manual_target_decision!=="INVALID"?<button type="button" disabled={saving||reviewBusy} className={button} onClick={() => onReview("RECHECK_AND_ACCEPT", evidence.candidate.id)}>{reviewBusy?"校验中…":"仅按已保存结论校验"}</button>:null}</div></section> : null}
    </div> : null}
  </AppDialog>;
}
