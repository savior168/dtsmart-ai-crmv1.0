"use client";

import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { GroupedEvidenceSection, VerifiedContactsSection, type EvidenceDisplayItem, type VerifiedContactDisplayItem } from "@/components/ai-screening/evidence-sections";
import { button, primaryButton } from "@/components/ai-screening/ui";
import type { Candidate } from "./types";
import { MANUAL_REVIEW_INDUSTRIES, type ManualReviewInput } from "@/lib/ai-acquisition/manual-review";

export type CandidateEvidenceData = {
  evidence_available?: boolean;
  candidate: Candidate;
  analysis: {
    score?: number;
    grade?: string;
    short_reason?: string;
    identity_status?: string;
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
  onClose,
  onReview,
  onSaveAssessment,
}: {
  evidence: CandidateEvidenceData | null;
  canControl: boolean;
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
    setSelectedEvidence(candidate?.manual_evidence_ids||[]);
    setFormError("");
  },[evidence]);
  async function saveAssessment(){
    if(!evidence)return;
    const value=Number(score);
    if(!score.trim()||!Number.isInteger(value)||value<0||value>100){setFormError("请输入 0–100 的整数评分");return}
    if(reason.trim().length<10){setFormError("请填写至少 10 字的具体改分理由");return}
    if(targetDecision==="VALID"&&!selectedEvidence.length){setFormError("请勾选至少一条直接证明目标业务的经营证据");return}
    setSaving(true);setFormError("");
    try{await onSaveAssessment(evidence.candidate.id,{score:value,targetDecision,industry,reason:reason.trim(),evidenceIds:selectedEvidence})}
    catch(error){setFormError(error instanceof Error?error.message:"保存人工复核失败")}
    finally{setSaving(false)}
  }
  const items = evidence ? displayEvidence(evidence) : [];
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
      {canControl && evidence.candidate.decision === "REVIEW" ? <section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 text-sm">
        <div><h3 className="font-semibold text-slate-900">人工复核评分与目标判断</h3><p className="mt-1 text-xs text-slate-600">原 AI 评分不会被覆盖；人工结论仅用于这条待复核候选。确认目标客户后仍须通过主体、联系方式与重复校验才能入池。</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1"><span>人工评分（0–100）</span><input type="number" min={0} max={100} step={1} value={score} onChange={(event)=>setScore(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"/></label>
          <label className="space-y-1"><span>人工目标判断</span><select value={targetDecision} onChange={(event)=>setTargetDecision(event.target.value as "VALID"|"INVALID")} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="VALID">确认目标客户（评分须 ≥60）</option><option value="INVALID">确认非目标客户（评分须 &lt;60）</option></select></label>
          <label className="space-y-1"><span>核实后的经营行业</span><select value={industry} onChange={(event)=>setIndustry(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">请选择</option>{MANUAL_REVIEW_INDUSTRIES.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        <label className="block space-y-1"><span>改分理由与经营事实</span><textarea value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={1000} rows={3} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2" placeholder="说明原 AI 判断错在哪里、公开页面具体证明了什么"/></label>
        <fieldset className="space-y-2"><legend className="font-medium">选择本客户的可追溯经营证据（确认目标客户必选）</legend>{evidence.evidence.filter((item)=>/^https?:\/\//i.test(item.source_url)&&item.evidence_strength!=="WEAK_HINT").map((item)=><label key={item.id} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2"><input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={(event)=>setSelectedEvidence((current)=>event.target.checked?[...current,item.id]:current.filter((id)=>id!==item.id))} className="mt-1"/><span className="min-w-0"><span className="block line-clamp-2">{item.translated_fact||item.original_excerpt||item.title||"公开经营证据"}</span><a href={item.source_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-blue-700 hover:underline" onClick={(event)=>event.stopPropagation()}>{item.source_url}</a></span></label>)}{!evidence.evidence.some((item)=>/^https?:\/\//i.test(item.source_url)&&item.evidence_strength!=="WEAK_HINT")?<p className="text-amber-700">暂无可用于确认目标业务的来源证据；不能只凭改分入池。</p>:null}</fieldset>
        {formError?<p role="alert" className="text-rose-700">{formError}</p>:null}
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-500">保存后保留原 AI 评分与历史修改记录；入池仍需另行确认。</p><button type="button" disabled={saving} onClick={()=>void saveAssessment()} className={button}>{saving?"保存中…":"保存人工复核"}</button></div>
      </section> : null}
      {canControl && evidence.candidate.decision === "REVIEW" ? <section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-2xl text-sm leading-6 text-slate-500">人工操作不会绕过质量门槛。此操作仅按已保存的分析结果和证据检查准入条件，不会重新采集，也不会覆盖人工核实的证据。</p><div className="flex gap-2"><button type="button" className={`${button} text-rose-600 hover:border-rose-400 hover:text-rose-700`} onClick={() => onReview("DISCARD", evidence.candidate.id)}>确认舍弃</button><button type="button" className={primaryButton} onClick={() => onReview("RECHECK_AND_ACCEPT", evidence.candidate.id)}>按现有证据校验入池</button></div></section> : null}
    </div> : null}
  </AppDialog>;
}
