"use client";

import { AppDialog } from "@/components/ui/app-dialog";
import { GroupedEvidenceSection, VerifiedContactsSection, type EvidenceDisplayItem, type VerifiedContactDisplayItem } from "@/components/ai-screening/evidence-sections";
import { button, primaryButton } from "@/components/ai-screening/ui";
import type { Candidate } from "./types";

export type CandidateEvidenceData = {
  evidence_available?: boolean;
  candidate: Candidate;
  analysis: {
    score?: number;
    grade?: string;
    short_reason?: string;
    identity_status?: string;
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
}: {
  evidence: CandidateEvidenceData | null;
  canControl: boolean;
  onClose: () => void;
  onReview: (action: "DISCARD" | "RECHECK_AND_ACCEPT", candidateId: string) => void;
}) {
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
      <GroupedEvidenceSection evidence={items}/>
      {canControl && evidence.candidate.decision === "REVIEW" ? <section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-2xl text-sm leading-6 text-slate-500">人工操作不会绕过质量门槛。重新校验仅在行业、主体在营、具体来源页和有效联系方式全部通过后入池。</p><div className="flex gap-2"><button type="button" className={`${button} text-rose-600 hover:border-rose-400 hover:text-rose-700`} onClick={() => onReview("DISCARD", evidence.candidate.id)}>确认舍弃</button><button type="button" className={primaryButton} onClick={() => onReview("RECHECK_AND_ACCEPT", evidence.candidate.id)}>重新校验并入池</button></div></section> : null}
    </div> : null}
  </AppDialog>;
}
