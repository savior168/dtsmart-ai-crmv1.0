import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { analyzeCustomer, type CustomerAnalysis } from "./customer-analysis";
import {
  collectDeepWebsiteEvidence,
  collectGooglePlaceEvidence,
  collectPublicPageEvidence,
  type CustomerEvidence,
  type GooglePlaceEvidence,
  type WebsiteEvidence,
} from "@/lib/ai/web-enrichment";
import { AI_CHANNEL_LABELS, AI_CHANNEL_ORDER, type AiChannel, type AiStrategy } from "./task-types";
import { AI_FIELD_MAPPING_VERSION, mapCustomerForAi, type AiMappedCustomer } from "./semantic-fields";
import { AI_RULE_VERSION, findReusableAnalysis, saveReusableAnalysis } from "./reuse-cache";
import {
  compatibilityTargetDecision,
  evaluateEvidenceGate,
  evidenceStrengthFor,
  primaryIndustryFor,
  type IdentityStatus,
  type PolicyEvidence,
} from "./evidence-policy";
import { buildContactCandidate, reconcileContacts, type ContactCandidate } from "./contact-intelligence";
import { normalizeError } from "./error-normalization";

type CustomerRow = AiMappedCustomer;

export type ChannelRecord = {
  channel: AiChannel;
  status: "COLLECTED" | "SKIPPED" | "FAILED";
  source_url?: string | null;
  evidence?: WebsiteEvidence | GooglePlaceEvidence;
  error?: string | null;
};

const ANALYSIS_VERSION = "2026.08.25.1";

type UsageTotals = CustomerAnalysis["usage"] & { model_calls: number };

const ZERO_USAGE: UsageTotals = {
  model: "",
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  cost_usd: 0,
  pricing_snapshot: {},
  model_calls: 0,
};

type PipelineStage =
  | "CUSTOMER_LOADED"
  | "SOURCES_COLLECTED"
  | "MODEL_COMPLETED"
  | "RESULT_SAVED"
  | "EVIDENCE_SAVED"
  | "CUSTOMER_WRITTEN_BACK"
  | "CONTACTS_SAVED"
  | "CACHE_SAVED"
  | "COMPLETED";

async function recordStage(input: {
  taskId: string;
  taskItemId: string;
  customerId: string;
  stage: PipelineStage;
  startedAt: number;
  status?: "COMPLETED" | "WARNING";
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - input.startedAt);
  const event = await admin.from("ai_screening_stage_events").upsert({
    task_id: input.taskId,
    task_item_id: input.taskItemId,
    customer_id: input.customerId,
    stage: input.stage,
    status: input.status || "COMPLETED",
    attempt_number: 1,
    started_at: new Date(input.startedAt).toISOString(),
    completed_at: completedAt,
    duration_ms: durationMs,
    checkpoint: input.details || {},
  }, { onConflict: "task_item_id,stage,attempt_number" });
  if (event.error) throw event.error;
  const item = await admin.from("ai_screening_task_items").update({
    pipeline_stage: input.stage,
    current_step: input.stage,
    checkpoint: { stage: input.stage, completed_at: completedAt, ...(input.details || {}) },
    updated_at: completedAt,
  }).eq("id", input.taskItemId);
  if (item.error) throw item.error;
}

async function optionalWrite<T>(
  label: string,
  warnings: Array<ReturnType<typeof normalizeError>>,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    warnings.push(normalizeError(error, { stage: label }));
    return null;
  }
}

function addUsage(total: UsageTotals, current: CustomerAnalysis["usage"]): UsageTotals {
  return {
    model: current.model || total.model,
    input_tokens: total.input_tokens + current.input_tokens,
    cached_input_tokens: total.cached_input_tokens + current.cached_input_tokens,
    output_tokens: total.output_tokens + current.output_tokens,
    total_tokens: total.total_tokens + current.total_tokens,
    cost_usd: Number((total.cost_usd + current.cost_usd).toFixed(6)),
    pricing_snapshot: current.pricing_snapshot,
    model_calls: total.model_calls + 1,
  };
}

function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value?: string | null) {
  return String(value || "").replace(/[\s\-()]/g, "");
}

function compactIdentity(value?: string | null) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function identitySimilarity(left?: string | null, right?: string | null) {
  const a = new Set(compactIdentity(left).split(/\s+/).filter((item) => item.length > 1));
  const b = new Set(compactIdentity(right).split(/\s+/).filter((item) => item.length > 1));
  if (!a.size || !b.size) return 0;
  return [...a].filter((item) => b.has(item)).length / Math.max(a.size, b.size);
}

function resolveIdentity(customer: CustomerRow, records: ChannelRecord[], analysis?: CustomerAnalysis | null) {
  const google = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  if (google?.identity_status) return {
    status: google.identity_status as IdentityStatus,
    confidence: Number(google.identity_confidence || 0),
    verifiedBusinessName: google.name || null,
    verifiedAddress: google.formatted_address || null,
    verifiedWebsite: google.website || null,
    verifiedGoogleMapsUrl: google.verified_google_maps_url || customer.google_url,
    placeId: google.place_id || null,
    candidateCount: Number(google.candidate_count || 0),
    matchSignals: google.match_signals || [],
    mismatchSignals: google.mismatch_signals || [],
  };
  const website = records.find((item) => item.channel === "website" && item.status === "COLLECTED")?.evidence as WebsiteEvidence | undefined;
  if (!website?.reachable) {
    const searched = (analysis?.evidence_summaries || []).filter((item) => /^https?:\/\//i.test(item.source_url));
    const combined = searched.map((item) => `${item.title_zh} ${item.fact_zh}`).join(" ");
    const originalPhone = normalizePhone(customer.phone);
    const nameScore = Math.round(identitySimilarity(customer.company_name, combined) * 55);
    const addressScore = customer.address && identitySimilarity(customer.address, combined) >= 0.55 ? 25 : 0;
    const phoneScore = originalPhone && normalizePhone(combined).includes(originalPhone) ? 20 : 0;
    const domain = (value?: string | null) => { try { return new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
    const inputDomain = domain(customer.website);
    const sourceDomainMatch = Boolean(inputDomain && searched.some((item) => domain(item.source_url) === inputDomain));
    const verifiedMapSource = searched.find((item) => /(?:google\.[^/]+\/maps|maps\.app\.goo\.gl)/i.test(item.source_url));
    const exactMapEvidence = Boolean(verifiedMapSource && customer.google_url && compactIdentity(verifiedMapSource.source_url) === compactIdentity(customer.google_url));
    const score = Math.min(100, nameScore + addressScore + phoneScore + (sourceDomainMatch ? 20 : 0) + (exactMapEvidence ? 20 : 0));
    const signals = [nameScore >= 40 ? "公开来源中的企业名称一致" : "", addressScore ? "公开来源中的地址一致" : "", phoneScore ? "公开来源中的电话一致" : "", sourceDomainMatch ? "公开来源域名与客户官网一致" : "", exactMapEvidence ? "实际检索来源与具体Google商家入口一致" : ""].filter(Boolean);
    const status: IdentityStatus = score >= 90 ? "MATCHED" : score >= 70 ? "LIKELY_MATCHED" : searched.length ? "AMBIGUOUS" : "NOT_FOUND";
    return { status, confidence: score, verifiedBusinessName: status === "MATCHED" ? customer.company_name : null, verifiedAddress: addressScore ? customer.address : null, verifiedWebsite: sourceDomainMatch ? customer.website : null, verifiedGoogleMapsUrl: verifiedMapSource?.source_url || customer.google_url, placeId: null, candidateCount: searched.length, matchSignals: signals, mismatchSignals: status === "MATCHED" ? [] : ["公开来源主体匹配信号不足"] };
  }
  const pageText = [website.title, website.description, website.text_excerpt].filter(Boolean).join(" ");
  const nameScore = Math.round(identitySimilarity(customer.company_name, pageText) * 65);
  const originalPhone = normalizePhone(customer.phone);
  const phoneMatch = Boolean(originalPhone && website.phones.some((item) => normalizePhone(item) === originalPhone));
  const emailDomain = normalizeEmail(customer.email).split("@")[1] || "";
  let websiteDomain = ""; try { websiteDomain = new URL(website.url).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  let inputWebsiteDomain = ""; try { inputWebsiteDomain = new URL(/^https?:\/\//i.test(String(customer.website || "")) ? String(customer.website) : `https://${customer.website}`).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  const providedDomainMatch = Boolean(inputWebsiteDomain && websiteDomain && inputWebsiteDomain === websiteDomain);
  const emailMatch = Boolean(emailDomain && websiteDomain && (emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`)));
  const addressMatch = Boolean(customer.address && compactIdentity(pageText).includes(compactIdentity(customer.address).slice(0, 24)));
  const score = Math.min(100, nameScore + (providedDomainMatch ? 25 : 0) + (phoneMatch ? 25 : 0) + (emailMatch ? 20 : 0) + (addressMatch ? 20 : 0));
  const signals = [nameScore >= 45 ? "官网名称与客户名称一致" : "", providedDomainMatch ? "读取域名与客户官网一致" : "", phoneMatch ? "官网电话与原始电话一致" : "", emailMatch ? "原始邮箱域名与官网一致" : "", addressMatch ? "官网地址与原始地址一致" : ""].filter(Boolean);
  const status: IdentityStatus = score >= 90 ? "MATCHED" : score >= 70 ? "LIKELY_MATCHED" : "AMBIGUOUS";
  return { status, confidence: score, verifiedBusinessName: website.title || customer.company_name, verifiedAddress: addressMatch ? customer.address : null, verifiedWebsite: website.url, verifiedGoogleMapsUrl: customer.google_url, placeId: null, candidateCount: 0, matchSignals: signals, mismatchSignals: status === "MATCHED" ? [] : ["官网主体匹配信号不足"] };
}

function sourceId(channel: string, url: string, fact: string) {
  return `SRC-${createHash("sha256").update(`${channel}|${url}|${fact}`).digest("hex").slice(0, 20)}`;
}

function policyEvidenceFromAnalysis(analysis: CustomerAnalysis): PolicyEvidence[] {
  return analysis.evidence_summaries.map((item) => {
    const base: PolicyEvidence = { sourceId: sourceId(item.channel, item.source_url, item.fact_zh), channel: item.channel, sourceUrl: item.source_url, fact: item.fact_zh, kind: item.evidence_type, confidence: item.confidence };
    return { ...base, strength: evidenceStrengthFor(base) };
  });
}

function contactCandidatesFromRecords(customer: CustomerRow, records: ChannelRecord[], identityStatus: IdentityStatus) {
  const candidates: ContactCandidate[] = [];
  const originalEmails = String(customer.email || "").split(",").map((item) => item.trim()).filter(Boolean);
  const originalPhones = String(customer.phone || "").split(",").map((item) => item.trim()).filter(Boolean);
  const add = (type: "EMAIL" | "PHONE" | "WHATSAPP", value: string, channel: string, url: string, title?: string | null) => {
    const candidate = buildContactCandidate({ type, value, country: customer.country, sourceChannel: channel, sourceUrl: url, sourcePageTitle: title, identityStatus, originalValues: type === "EMAIL" ? originalEmails : originalPhones });
    if (candidate) candidates.push(candidate);
  };
  for (const record of records) {
    if (record.status !== "COLLECTED" || !record.evidence) continue;
    if (record.channel === "google_maps") {
      const item = record.evidence as GooglePlaceEvidence;
      const url = item.verified_google_maps_url || record.source_url || customer.google_url || "";
      if (item.phone) add("PHONE", item.phone, "google_maps", url, item.name);
      for (const email of item.emails || []) add("EMAIL", email, "google_maps", url, item.name);
      continue;
    }
    const item = record.evidence as WebsiteEvidence;
    const pages = [{ url: item.url, title: item.title, emails: item.emails, phones: item.phones, whatsapps: item.whatsapps || [] }, ...(item.pages || []).map((page) => ({ ...page, whatsapps: page.whatsapps || [] }))];
    for (const page of pages) {
      for (const email of page.emails || []) add("EMAIL", email, record.channel, page.url, page.title);
      for (const phone of page.phones || []) add("PHONE", phone, record.channel, page.url, page.title);
      for (const whatsapp of page.whatsapps || []) add("WHATSAPP", whatsapp, record.channel, page.url, page.title);
    }
  }
  return reconcileContacts(candidates);
}

function withoutEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === null || item === undefined || item === "") return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  })) as T;
}

export function evidenceForModel(records: ChannelRecord[], tier: "fast" | "deep" | "escalation" = "fast"): CustomerEvidence {
  const deep = tier !== "fast";
  const publicChannels: Record<string, WebsiteEvidence> = {};
  const compactWebsite = (item: WebsiteEvidence): WebsiteEvidence => withoutEmpty({
    url: item.url,
    reachable: item.reachable,
    title: item.title,
    description: item.description?.slice(0, deep ? 360 : 240),
    headings: (item.headings || []).slice(0, deep ? 6 : 4),
    text_excerpt: item.text_excerpt?.slice(0, deep ? 900 : 520),
    image_alts: (item.image_alts || []).filter(Boolean).slice(0, deep ? 5 : 3),
    image_urls: [],
    video_urls: [],
    emails: (item.emails || []).slice(0, 5),
    phones: (item.phones || []).slice(0, 5),
    whatsapps: (item.whatsapps || []).slice(0, 3),
    pages: (item.pages || []).slice(0, 1).map((page) => withoutEmpty({
      url: page.url,
      title: page.title,
      description: page.description?.slice(0, 240),
      headings: (page.headings || []).slice(0, 3),
      text_excerpt: page.text_excerpt?.slice(0, deep ? 320 : 220),
      image_alts: (page.image_alts || []).filter(Boolean).slice(0, 2),
      image_urls: [],
      emails: (page.emails || []).slice(0, 3),
      phones: (page.phones || []).slice(0, 3),
    })),
  } as WebsiteEvidence);
  for (const item of records) {
    if (item.status !== "COLLECTED" || !item.evidence) continue;
    if (item.channel === "website") continue;
    if (item.channel === "google_maps") continue;
    publicChannels[item.channel] = compactWebsite(item.evidence as WebsiteEvidence);
  }
  const google = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  return {
    website: (() => { const value = records.find((item) => item.channel === "website" && item.status === "COLLECTED")?.evidence as WebsiteEvidence | undefined; return value ? compactWebsite(value) : undefined; })(),
    google_place: google ? withoutEmpty({
      configured: google.configured,
      place_id: google.place_id,
      name: google.name,
      formatted_address: google.formatted_address,
      phone: google.phone,
      website: google.website,
      rating: google.rating,
      user_ratings_total: google.user_ratings_total,
      business_status: google.business_status,
      types: (google.types || []).slice(0, 8),
      reviews: (google.reviews || []).slice(0, 1).map((review) => review.slice(0, deep ? 180 : 120)),
      image_urls: [],
      video_urls: [],
      emails: (google.emails || []).slice(0, 3),
      identity_status: google.identity_status,
      identity_confidence: google.identity_confidence,
      verified_google_maps_url: google.verified_google_maps_url,
      match_signals: (google.match_signals || []).slice(0, 5),
      mismatch_signals: (google.mismatch_signals || []).slice(0, 5),
      candidate_count: google.candidate_count,
    } as GooglePlaceEvidence) : undefined,
    public_channels: publicChannels,
  };
}

function hasUsableCollectedEvidence(records: ChannelRecord[]) {
  return records.some((record) => {
    if (record.status !== "COLLECTED" || !record.evidence) return false;
    if (record.channel === "google_maps") {
      const item = record.evidence as GooglePlaceEvidence;
      return Boolean(item.name || item.types?.length || item.formatted_address || item.phone || item.reviews?.length);
    }
    const item = record.evidence as WebsiteEvidence;
    return Boolean(item.title || item.description || item.headings?.length || item.text_excerpt || item.emails?.length || item.phones?.length);
  });
}

const RULE_INDUSTRIES: Array<{ pattern: RegExp; industry: CustomerAnalysis["industry_type"]; score: number; target: boolean }> = [
  { pattern: /(?:mobile[_ ]phone[_ ]repair|cell[_ ]phone[_ ]repair|phone[_ ]repair|smartphone[_ ]repair|reparaci[oó]n (?:de )?(?:tel[eé]fonos m[oó]viles|m[oó]viles|celulares)|r[eé]paration de t[eé]l[eé]phones|handy(?:reparatur|service)|维修手机|手机维修)/i, industry: "手机维修店", score: 78, target: true },
  { pattern: /(?:apple device repair|iphone repair|macbook repair|apple repair)/i, industry: "Apple或MacBook维修店", score: 82, target: true },
  { pattern: /(?:computer repair|pc repair|laptop repair|reparaci[oó]n (?:de )?(?:ordenadores|computadoras)|r[eé]paration (?:d['’]ordinateur|informatique)|computerreparatur|电脑维修)/i, industry: "电脑维修店", score: 72, target: true },
  { pattern: /(?:wholesale|wholesaler|distributor|distribution|importer|b2b|bulk order|trade account|批发|分销|进口商)/i, industry: "进口商或分销商", score: 90, target: true },
  { pattern: /(?:mobile phone accessories|cell phone accessories|phone accessories|手机配件)/i, industry: "手机外配件零售", score: 68, target: true },
];

function emptyBreakdown(value: number): CustomerAnalysis["score_breakdown"] {
  return {
    entity_consistency: value,
    company_authenticity: value,
    business_activity: value,
    mobile_parts_match: value,
    macbook_parts_match: value,
    wholesale_import_distribution: value,
    repair_business_match: value,
    bulk_purchase_potential: Math.min(value, 55),
    contactability: value,
    evidence_completeness: value,
    contradiction_risk: 0,
  };
}

export function deterministicAnalysis(customer: CustomerRow, records: ChannelRecord[]): CustomerAnalysis | null {
  const googleRecord = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED");
  const google = googleRecord?.evidence as GooglePlaceEvidence | undefined;
  const googleUrl = google?.verified_google_maps_url || googleRecord?.source_url || customer.google_url || "";
  if (google?.business_status === "CLOSED_PERMANENTLY" && /^https?:\/\//i.test(googleUrl)) {
    const fact = "Google商家页显示该企业已经永久关闭。";
    return {
      industry_type: "已关闭", is_target_customer: false, ai_score: 10, ai_level: "D",
      ai_reason: fact, business_relevance: "企业已永久关闭，不属于当前可开发客户。",
      customer_value: "无当前开发价值。", followup_suggestion: "停止销售跟进，并保留商家页作为核验依据。",
      confidence_score: Math.max(85, Number(google.identity_confidence || 0)), evidence_sufficiency: "充分", evidence_conflicts: [],
      score_breakdown: { ...emptyBreakdown(10), contradiction_risk: 100 }, suggested_contact_order: [],
      evidence_summaries: [{ channel: "google_maps", title_zh: "Google商家营业状态", fact_zh: fact, source_url: googleUrl, evidence_type: "矛盾", confidence: Math.max(85, Number(google.identity_confidence || 0)) }],
      usage: { ...ZERO_USAGE, model: "RULE_ENGINE" },
    };
  }

  const candidates: Array<{ channel: string; url: string; title: string; text: string; confidence: number }> = [];
  if (google?.name && /^https?:\/\//i.test(googleUrl) && ["MATCHED", "LIKELY_MATCHED"].includes(String(google.identity_status))) {
    candidates.push({
      channel: "google_maps",
      url: googleUrl,
      title: "Google商家分类",
      text: [...(google.types || []), google.name].join("；"),
      confidence: Math.max(70, Number(google.identity_confidence || 0)),
    });
  }
  const websiteRecord = records.find((item) => item.channel === "website" && item.status === "COLLECTED");
  const website = websiteRecord?.evidence as WebsiteEvidence | undefined;
  if (website?.reachable && /^https?:\/\//i.test(website.url)) {
    candidates.push({
      channel: "website",
      url: website.url,
      title: "企业官网业务说明",
      text: [website.title, website.description, ...(website.headings || []), website.text_excerpt].filter(Boolean).join("；").slice(0, 6000),
      confidence: 92,
    });
  }
  for (const candidate of candidates) {
    const rule = RULE_INDUSTRIES.find((item) => item.pattern.test(candidate.text));
    if (!rule) continue;
    const sourceName = candidate.channel === "google_maps" ? "Google商家页" : "企业官网";
    const fact = `${sourceName}公开的商家分类或经营说明明确显示该企业从事“${rule.industry}”相关业务，可直接支持该行业归类。`;
    const score = rule.score;
    return {
      industry_type: rule.industry,
      is_target_customer: rule.target,
      ai_score: score,
      ai_level: score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D",
      ai_reason: fact,
      business_relevance: `该企业经营内容与手机、电脑维修配件业务相关；直接依据来自${sourceName}。`,
      customer_value: score >= 85 ? "具备较高的批量采购或分销合作潜力，采购规模仍需销售确认。" : "具备维修配件补货需求的可能性，采购频次和规模需销售确认。",
      followup_suggestion: "优先使用已核验联系方式，确认常购配件品类、月采购量和报价需求。",
      confidence_score: candidate.confidence,
      evidence_sufficiency: "充分",
      evidence_conflicts: [],
      score_breakdown: emptyBreakdown(score),
      suggested_contact_order: ["电话", "邮箱", "WhatsApp"],
      evidence_summaries: [{ channel: candidate.channel, title_zh: candidate.title, fact_zh: fact, source_url: candidate.url, evidence_type: "支持", confidence: candidate.confidence }],
      usage: { ...ZERO_USAGE, model: "RULE_ENGINE" },
    };
  }
  return null;
}

function channelUrl(customer: CustomerRow, channel: AiChannel): string | null {
  if (channel === "website") return customer.website;
  if (channel === "google_maps") return customer.google_url;
  if (channel === "linkedin") return customer.linkedin_url || null;
  if (channel === "facebook") return customer.facebook_url || null;
  if (channel === "instagram") return customer.instagram_url || null;
  if (channel === "tiktok") return customer.tiktok_url || null;
  return customer.other_public_urls?.[0] || null;
}

async function collectChannel(customer: CustomerRow, channel: AiChannel, signal: AbortSignal): Promise<ChannelRecord> {
  const url = channelUrl(customer, channel);
  if (channel !== "google_maps" && !url) return { channel, status: "SKIPPED", source_url: null, error: "客户档案没有该渠道网址" };
  if (channel === "google_maps" && !customer.google_url && !customer.company_name) return { channel, status: "SKIPPED", error: "客户档案没有Google商家信息" };
  try {
    const evidence = channel === "website"
      ? await collectDeepWebsiteEvidence(url, { signal, timeoutMs: 5000 })
      : channel === "google_maps"
        ? await collectGooglePlaceEvidence({ company_name: customer.company_name, country: customer.country, address: customer.address, google_url: customer.google_url, phone: customer.phone, website: customer.website }, { signal, timeoutMs: 12_000 })
        : await collectPublicPageEvidence(url, { signal, timeoutMs: 3500 });
    if (!evidence) return { channel, status: "SKIPPED", source_url: url, error: "没有可读取的公开入口" };
    const failed = "reachable" in evidence ? !evidence.reachable : Boolean(evidence.error && !evidence.name);
    return { channel, status: failed ? "FAILED" : "COLLECTED", source_url: url, evidence, error: evidence.error || null };
  } catch (error) {
    if (signal.aborted) throw new Error("CUSTOMER_ANALYSIS_CANCELLED");
    return { channel, status: "FAILED", source_url: url, error: error instanceof Error ? error.message : "渠道读取失败" };
  }
}

async function readCustomer(customerId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("customers").select("*").eq("id", customerId).is("deleted_at", null).maybeSingle();
  if (error || !data) throw error || new Error("CUSTOMER_NOT_FOUND");
  const mapped = mapCustomerForAi(data as Record<string, unknown>);
  if (!mapped.id) throw new Error("CUSTOMER_ID_NOT_MAPPED");
  return mapped;
}

async function saveCheckpoint(taskItemId: string, records: ChannelRecord[], channel: AiChannel) {
  const admin = createAdminClient();
  const write = await admin.from("ai_screening_task_items").update({
    channel_checkpoint: { records }, checkpoint_version: "1.0", last_completed_channel: channel,
    last_checkpoint_at: new Date().toISOString(), current_step: `ANALYZED_${channel.toUpperCase()}`,
    analyzed_channels: records.filter((item) => item.status === "COLLECTED").map((item) => item.channel),
    skipped_channels: records.filter((item) => item.status !== "COLLECTED").map((item) => ({ channel: item.channel, status: item.status, reason: item.error })),
    updated_at: new Date().toISOString(),
  }).eq("id", taskItemId);
  if (write.error) throw write.error;
}

async function saveModelCall(input: {
  taskId: string; taskItemId: string; customerId: string; channel: string; attemptNumber: number;
  startedAt: number; usage?: CustomerAnalysis["usage"]; status: "COMPLETED" | "FAILED"; error?: unknown;
}) {
  const usage = input.usage || ZERO_USAGE;
  const admin = createAdminClient();
  const normalized = input.status === "FAILED"
    ? normalizeError(input.error, { stage: "MODEL_CALL", channel: input.channel, attemptNumber: input.attemptNumber, durationMs: Date.now() - input.startedAt })
    : null;
  const write = await admin.from("ai_screening_model_calls").upsert({
    task_id: input.taskId, task_item_id: input.taskItemId, customer_id: input.customerId,
    channel: input.channel, attempt_number: input.attemptNumber, model: usage.model || null,
    model_version: usage.model || null, input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cached_input_tokens, output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens, pricing_snapshot: usage.pricing_snapshot,
    cost_usd: usage.cost_usd, status: input.status, cache_hit: usage.cached_input_tokens > 0,
    started_at: new Date(input.startedAt).toISOString(), completed_at: new Date().toISOString(),
    duration_ms: Date.now() - input.startedAt,
    provider: "OPENAI",
    pipeline_stage: "MODEL_CALL",
    error_code: normalized?.error_code || null,
    error_message: normalized?.error_message || null,
    error_details: normalized ? { details: normalized.details, hint: normalized.hint } : {},
    http_status: normalized?.http_status || null,
    request_id: normalized?.request_id || null,
    retryable: normalized?.retryable || false,
  }, { onConflict: "task_item_id,channel,attempt_number" });
  if (write.error) throw write.error;
}

function canRecoverModelCall(error: unknown) {
  return normalizeError(error, { stage: "MODEL_CALL", provider: "OPENAI" }).retryable;
}

async function analyzeWithRecovery(input: {
  taskId: string;
  taskItemId: string;
  customerId: string;
  attemptNumber: number;
  customer: CustomerRow;
  records: ChannelRecord[];
  signal: AbortSignal;
  tier: "fast" | "deep";
  maxRequests: 1 | 2;
}) {
  const modelInput = {
    customer_name: input.customer.company_name,
    country: input.customer.country,
    website: input.customer.website,
    google_url: input.customer.google_url,
    address: input.customer.address,
    industry_keywords: null,
    evidence: evidenceForModel(input.records, input.tier),
  };
  const primaryTimeout = input.tier === "deep" ? 60_000 : 40_000;
  const retryTimeout = input.tier === "deep" ? 60_000 : 35_000;
  const run = async (channel: string, timeoutMs: number) => {
    const startedAt = Date.now();
    try {
      const result = await analyzeCustomer(modelInput, { signal: input.signal, timeoutMs, tier: input.tier });
      await saveModelCall({ ...input, channel, startedAt, usage: result.usage, status: "COMPLETED" });
      return result;
    } catch (error) {
      await saveModelCall({ ...input, channel, startedAt, status: "FAILED", error });
      throw error;
    }
  };
  try {
    return { analysis: await run("all_available_sources", primaryTimeout), requestCount: 1 };
  } catch (error) {
    if (input.maxRequests < 2 || !canRecoverModelCall(error)) throw error;
    // The evidence checkpoint is already stored. Retry only the model synthesis,
    // never re-crawl the customer or discard facts collected by the first pass.
    return { analysis: await run("all_available_sources_retry", retryTimeout), requestCount: 2 };
  }
}

async function saveVerifiedContacts(input: { taskId: string; resultId: string; customer: CustomerRow; contacts: ContactCandidate[]; preferred?: ContactCandidate | null }) {
  const admin = createAdminClient();
  const existing = await admin.from("customer_contacts")
    .select("type,value_normalized,source,verification_status")
    .eq("customer_id", input.customer.id);
  if (existing.error) throw existing.error;
  const existingByKey = new Map((existing.data || []).map((item) => [
    `${String(item.type)}|${String(item.value_normalized)}|${String(item.source)}`,
    String(item.verification_status || ""),
  ]));
  const rows = input.contacts.map((item) => ({
    customer_id: input.customer.id, type: item.type, value_raw: item.valueRaw,
    value_normalized: item.valueNormalized, source: item.sourceChannel,
    source_url: item.sourceUrl, exact_source_url: item.sourceUrl,
    source_channel: item.sourceChannel, source_page_title: item.sourcePageTitle,
    captured_at: item.capturedAt, identity_match_status: item.identityStatus,
    verification_status: item.verificationStatus, contact_status: item.contactStatus,
    content_hash: item.contentHash, updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const write = await admin.from("customer_contacts").upsert(rows, { onConflict: "customer_id,type,value_normalized,source" });
  if (write.error) throw write.error;
  const audits = input.contacts
    .filter((item) => {
      if (!["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(item.verificationStatus)) return false;
      const previous = existingByKey.get(`${item.type}|${item.valueNormalized}|${item.sourceChannel}`);
      return previous !== item.verificationStatus;
    })
    .map((item) => ({ task_id: input.taskId, customer_id: input.customer.id, result_id: input.resultId, action: item.verificationStatus === "NEW_VERIFIED" ? "DISCOVER_VERIFIED_CONTACT" : "CONTACT_SOURCE_CONFLICT", old_value: item.type === "EMAIL" ? input.customer.email : input.customer.phone, new_value: item.valueRaw, source_url: item.sourceUrl, captured_at: item.capturedAt, analysis_version: ANALYSIS_VERSION }));
  if (input.preferred) {
    audits.push({
      task_id: input.taskId,
      customer_id: input.customer.id,
      result_id: input.resultId,
      action: "RECOMMEND_VERIFIED_CONTACT",
      old_value: null,
      new_value: input.preferred.valueRaw,
      source_url: input.preferred.sourceUrl,
      captured_at: input.preferred.capturedAt,
      analysis_version: ANALYSIS_VERSION,
    });
  }
  if (audits.length) {
    const auditWrite = await admin.from("ai_contact_audit_logs").insert(audits);
    if (auditWrite.error) throw auditWrite.error;
  }
}

async function completeFromReusableCache(input: { taskId: string; taskItemId: string; customerId: string; strategy: AiStrategy }, customer: CustomerRow, cache: Record<string, unknown>, started: number) {
  const admin = createAdminClient();
  const cachedResult = (cache.analysis_result && typeof cache.analysis_result === "object" ? cache.analysis_result : {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const resultPayload = {
    ...cachedResult,
    customer_id: customer.id,
    task_id: input.taskId,
    task_item_id: input.taskItemId,
    strategy: input.strategy,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    model_calls: 0,
    pricing_snapshot: { reused: true, cost_usd: 0 },
    model_snapshot: { ...(cachedResult.model_snapshot as Record<string, unknown> || {}), reused: true, source_result_id: cache.source_result_id },
    completed_at: now,
    rule_version: AI_RULE_VERSION,
    is_latest_valid: false,
    writeback_status: "PENDING",
    writeback_warnings: [],
  };
  const resultWrite = await admin.from("ai_screening_results").insert(resultPayload).select("id").single();
  if (resultWrite.error || !resultWrite.data) throw resultWrite.error || new Error("REUSED_RESULT_WRITE_FAILED");
  const warnings: Array<ReturnType<typeof normalizeError>> = [];
  const durable = await admin.from("ai_screening_task_items").update({
    status: "RUNNING", analysis_status: "RUNNING", writeback_status: "PENDING",
    result_id: resultWrite.data.id, progress: 80, current_step: "REUSED_RESULT_SAVED",
    cache_reused: true, reuse_source_result_id: cache.source_result_id || null,
    completed_at: now, duration_ms: Date.now() - started, updated_at: now,
  }).eq("id", input.taskItemId);
  if (durable.error) throw durable.error;
  const snapshots = Array.isArray(cache.evidence_snapshot) ? cache.evidence_snapshot : [];
  if (!snapshots.length) throw new Error("REUSED_EVIDENCE_MISSING");
  const rows = snapshots.map((row, index) => {
    const source = { ...(row as Record<string, unknown>) };
    delete source.id;
    return { ...source, id: randomUUID(), result_id: resultWrite.data.id, task_id: input.taskId, task_item_id: input.taskItemId, customer_id: customer.id, source_id: `${String(source.source_id || "SRC")}-R${resultWrite.data.id.slice(0, 8)}-${index}`, captured_at: source.captured_at || source.fetched_at || cache.original_captured_at || cache.captured_at, fetched_at: source.fetched_at || source.captured_at || cache.original_captured_at || cache.captured_at, metadata: { ...((source.metadata as Record<string, unknown>) || {}), cache_reused: true, reused_at: now, source_result_id: cache.source_result_id } };
  });
  const evidenceWrite = await admin.from("ai_screening_evidence").insert(rows).select("id");
  if (evidenceWrite.error || !evidenceWrite.data?.length) throw evidenceWrite.error || new Error("REUSED_EVIDENCE_WRITE_FAILED");
  const discovered = (cache.discovered_contacts && typeof cache.discovered_contacts === "object" ? cache.discovered_contacts : {}) as { website_email?: string; website_phone?: string; whatsapp?: string[]; contacts?: ContactCandidate[] };
  const customerWrite = await admin.from("customers").update({
      industry: cachedResult.industry_type || cachedResult.customer_type,
      ai_score: cachedResult.score,
      ai_level: cachedResult.grade,
      ai_reason: cachedResult.ai_reason || cachedResult.summary,
      is_target_customer: cachedResult.target_decision === "VALID" ? true : cachedResult.target_decision === "INVALID" ? false : null,
      ai_screening_done: true,
      ai_status: "COMPLETED",
      business_relevance: cachedResult.business_relevance,
      customer_value: cachedResult.customer_value,
      followup_suggestion: cachedResult.followup_suggestion,
      website_email: discovered.website_email || null,
      website_phone: discovered.website_phone || null,
      ai_last_result_id: resultWrite.data.id,
      ai_last_screened_at: now,
      updated_at: now,
  }).eq("id", customer.id);
  if (customerWrite.error) throw customerWrite.error;
  if (Array.isArray(discovered.contacts) && discovered.contacts.length) {
    const preferredValue = String(cachedResult.preferred_contact_value || "");
    const preferred = discovered.contacts.find((item) => item.valueRaw === preferredValue || item.valueNormalized === preferredValue) || null;
    await optionalWrite("REUSED_CONTACT_WRITEBACK", warnings, () => saveVerifiedContacts({ taskId: input.taskId, resultId: resultWrite.data.id, customer, contacts: discovered.contacts!, preferred }));
  }
  const itemWrite = await admin.from("ai_screening_task_items").update({ status: "COMPLETED", analysis_status: "COMPLETED", writeback_status: "COMPLETED", writeback_warning_count: warnings.length, error_context: warnings.length ? { writeback_warnings: warnings } : {}, automation_status: String(cachedResult.automation_status || "AUTO_HOLD"), retry_at: cachedResult.retry_at || null, progress: 100, current_step: "REUSED_RESULT", cache_reused: true, reuse_source_result_id: cache.source_result_id || null, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, completed_at: now, updated_at: now }).eq("id", input.taskItemId);
  if (itemWrite.error) throw itemWrite.error;
  const resultStatus = await admin.from("ai_screening_results").update({
    writeback_status: "COMPLETED",
    writeback_warnings: warnings,
    is_latest_valid: true,
    evidence_ids: evidenceWrite.data.map((row) => row.id),
  }).eq("id", resultWrite.data.id);
  if (resultStatus.error) throw resultStatus.error;
  await admin.from("ai_screening_model_calls").upsert({ task_id: input.taskId, task_item_id: input.taskItemId, customer_id: customer.id, channel: "cross_user_result_reuse", attempt_number: 1, model: "REUSED_RESULT", model_version: String((cachedResult.model_snapshot as Record<string, unknown> | undefined)?.primary_model || "REUSED_RESULT"), input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, pricing_snapshot: { reused: true }, cost_usd: 0, status: "COMPLETED", cache_hit: true, completed_at: now, duration_ms: Date.now() - started }, { onConflict: "task_item_id,channel,attempt_number" });
  await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
  return { status: "COMPLETED" as const, resultId: resultWrite.data.id, reused: true };
}

export async function runCustomerAnalysis(input: { taskId: string; taskItemId: string; customerId: string; strategy: AiStrategy; attemptNumber?: number }) {
  const started = Date.now();
  // Do not impose one hard timeout on the whole customer. Each public source and
  // model call owns a bounded timeout, while completed source checkpoints remain
  // reusable if a later source is slow or the model call needs retrying.
  const analysisController = new AbortController();
  const customer = await readCustomer(input.customerId);
  const admin = createAdminClient();
  await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "CUSTOMER_LOADED", startedAt: started });
  const reusable = await findReusableAnalysis(customer, input.strategy);
  if (reusable) {
    return completeFromReusableCache(input, customer, reusable as Record<string, unknown>, started);
  }
  const checkpoint = await admin.from("ai_screening_task_items").select("channel_checkpoint").eq("id", input.taskItemId).maybeSingle();
  if (checkpoint.error) throw checkpoint.error;
  const savedRecords = checkpoint.data?.channel_checkpoint && typeof checkpoint.data.channel_checkpoint === "object"
    ? (checkpoint.data.channel_checkpoint as { records?: ChannelRecord[] }).records : [];
  const records: ChannelRecord[] = Array.isArray(savedRecords) ? savedRecords.filter((item) => item && AI_CHANNEL_ORDER.includes(item.channel)) : [];
  let analysis: CustomerAnalysis | null = null;
  let usage = { ...ZERO_USAGE };
  let earlyStopReason: string | null = null;
  try {
    // Both modes start with the two highest-value public sources. Secondary
    // channels are collected in small batches only when the primary evidence
    // cannot support a reliable conclusion. This is faster and avoids sending
    // redundant public content to the model.
    const primaryChannels = ["website", "google_maps"] as AiChannel[];
    const pendingChannels = primaryChannels.filter((channel) => !records.some((item) => item.channel === channel && ["COLLECTED", "SKIPPED"].includes(item.status)));
    if (pendingChannels.length) {
      const collected = await Promise.all(pendingChannels.map((channel) => collectChannel(customer, channel, analysisController.signal)));
      for (const current of collected) {
        const index = records.findIndex((item) => item.channel === current.channel);
        if (index >= 0) records[index] = current; else records.push(current);
      }
      await saveCheckpoint(input.taskItemId, records, pendingChannels[pendingChannels.length - 1]);
    }
    await recordStage({
      taskId: input.taskId,
      taskItemId: input.taskItemId,
      customerId: input.customerId,
      stage: "SOURCES_COLLECTED",
      startedAt: started,
      details: {
        collected_channels: records.filter((item) => item.status === "COLLECTED").map((item) => item.channel),
        failed_channels: records.filter((item) => item.status === "FAILED").map((item) => item.channel),
      },
    });
    analysis = deterministicAnalysis(customer, records);
    if (!analysis) {
      const secondaryChannels = AI_CHANNEL_ORDER.filter((channel) => !primaryChannels.includes(channel) && Boolean(channelUrl(customer, channel)) && !records.some((item) => item.channel === channel));
      for (let index = 0; index < secondaryChannels.length && !analysis; index += 2) {
        const batch = secondaryChannels.slice(index, index + 2);
        const secondary = await Promise.all(batch.map((channel) => collectChannel(customer, channel, analysisController.signal)));
        records.push(...secondary);
        await saveCheckpoint(input.taskItemId, records, batch[batch.length - 1]);
        analysis = deterministicAnalysis(customer, records);
        if (analysis) earlyStopReason = "补充公开渠道已取得足够的直接经营证据，停止继续采集并由规则引擎完成判断。";
      }
    }
    let modelRequestCount = 0;
    const maxModelCalls = input.strategy === "DEEP"
      ? Math.max(1, Math.min(2, Number(process.env.AI_SCREENING_DEEP_MAX_MODEL_CALLS_PER_CUSTOMER || 1)))
      : 1;
    if (analysis) {
      earlyStopReason = "已取得可核验的直接行业证据，规则引擎完成判断，未调用大模型。";
    } else if (!hasUsableCollectedEvidence(records)) {
      throw new Error("AI_EVIDENCE_NOT_AVAILABLE");
    } else if (input.strategy === "DEEP") {
      const outcome = await analyzeWithRecovery({ ...input, attemptNumber: input.attemptNumber || 1, customer, records, signal: analysisController.signal, tier: "deep", maxRequests: maxModelCalls as 1 | 2 });
      analysis = outcome.analysis;
      modelRequestCount = outcome.requestCount;
      usage = addUsage(usage, analysis.usage);
    } else {
      const outcome = await analyzeWithRecovery({ ...input, attemptNumber: input.attemptNumber || 1, customer, records, signal: analysisController.signal, tier: "fast", maxRequests: 1 });
      analysis = outcome.analysis;
      modelRequestCount = outcome.requestCount;
      usage = addUsage(usage, analysis.usage);
    }
    const needsEscalation = analysis.usage.model !== "RULE_ENGINE"
      && analysis.evidence_conflicts.length > 0
      && modelRequestCount < maxModelCalls;
    if (needsEscalation) {
      const callStarted = Date.now();
      try {
        const escalated = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: null,
          evidence: evidenceForModel(records, "escalation"),
        }, { signal: analysisController.signal, timeoutMs: 45_000, tier: "escalation" });
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, usage: escalated.usage, status: "COMPLETED" });
        modelRequestCount += 1;
        usage = addUsage(usage, escalated.usage);
        analysis = escalated;
      } catch (error) {
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, status: "FAILED", error });
        if (input.strategy === "DEEP" && analysis.confidence_score < 60) throw error;
      }
    }
    await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "MODEL_COMPLETED", startedAt: started, details: { model_calls: usage.model_calls, total_tokens: usage.total_tokens } });

    const identity = resolveIdentity(customer, records, analysis);
    const policyEvidence = policyEvidenceFromAnalysis(analysis);
    const primaryIndustry = primaryIndustryFor(analysis.industry_type);
    const explicitRejectEvidence = policyEvidence.some((item) => item.kind === "矛盾" && /只销售手机成品|运营商|外配件|软件|IT咨询|永久关闭|停业|无关业务/.test(item.fact));
    const gate = evaluateEvidenceGate({
      strategy: input.strategy, identityStatus: identity.status, identityConfidence: identity.confidence,
      industryConfidence: analysis.confidence_score, decisionConfidence: analysis.confidence_score,
      score: analysis.ai_score, industry: primaryIndustry, evidence: policyEvidence,
      hasCriticalConflict: analysis.evidence_conflicts.length > 0 || ["AMBIGUOUS", "CONFLICTED"].includes(identity.status),
      explicitRejectEvidence,
    });
    if (!["AUTO_DEVELOP", "AUTO_REJECT"].includes(gate.automationStatus) || !analysis.evidence_summaries.length) {
      throw new Error("AI_EVIDENCE_GATE_NOT_SATISFIED");
    }
    const reconciled = contactCandidatesFromRecords(customer, records, identity.status);
    const verifiedNew = reconciled.contacts.filter((item) => ["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(item.verificationStatus));
    const websiteEmail = verifiedNew.filter((item) => item.type === "EMAIL").map((item) => item.valueRaw).filter((value, index, all) => all.indexOf(value) === index).join(", ");
    const websitePhone = verifiedNew.filter((item) => item.type === "PHONE").map((item) => item.valueRaw).filter((value, index, all) => all.indexOf(value) === index).join(", ");
    const discoveredWhatsapps = reconciled.contacts.filter((item) => item.type === "WHATSAPP").map((item) => item.valueRaw);
    const analyzedChannels = records.filter((item) => item.status === "COLLECTED").map((item) => item.channel);
    const skippedChannels = records.filter((item) => item.status !== "COLLECTED").map((item) => ({ channel: item.channel, status: item.status, reason: item.error }));
    const retryAt = gate.automationStatus === "AUTO_HOLD" ? new Date(Date.now() + (identity.status === "NOT_FOUND" ? 30 : 7) * 86_400_000).toISOString() : null;
    const google = records.find((item) => item.channel === "google_maps")?.evidence as GooglePlaceEvidence | undefined;
    const scaleSignals = [Number(google?.user_ratings_total || 0) > 0 ? `Google评论量：${google?.user_ratings_total}` : "", records.filter((item) => item.status === "COLLECTED").length > 1 ? "存在多个已核实公开来源" : ""].filter(Boolean);
    const resultPayload = {
      customer_id: customer.id, task_id: input.taskId, task_item_id: input.taskItemId,
      score: analysis.ai_score, grade: analysis.ai_level,
      target_decision: compatibilityTargetDecision(gate.automationStatus), automation_status: gate.automationStatus,
      customer_type: analysis.industry_type, industry_type: analysis.industry_type,
      primary_industry: primaryIndustry, secondary_industries: [], business_activities: [],
      industry_confidence: analysis.confidence_score, identity_confidence: identity.confidence,
      decision_confidence: analysis.confidence_score, contact_confidence: reconciled.preferred ? (reconciled.preferred.identityStatus === "MATCHED" ? 90 : 55) : 0,
      scale_confidence: scaleSignals.length ? 40 : 0, evidence_sufficiency_score: Math.min(100, policyEvidence.filter((item) => item.kind !== "中性").length * 20),
      identity_status: identity.status, identity_details: identity,
      verified_business_name: identity.verifiedBusinessName, verified_address: identity.verifiedAddress,
      verified_website: identity.verifiedWebsite, verified_google_maps_url: identity.verifiedGoogleMapsUrl,
      place_id: identity.placeId, candidate_count: identity.candidateCount,
      match_signals: identity.matchSignals, mismatch_signals: identity.mismatchSignals,
      industry_evidence_ids: gate.evidenceIds, industry_conflicts: analysis.evidence_conflicts,
      scale_analysis: { scale_level: "UNKNOWN", scale_confidence: scaleSignals.length ? 40 : 0, scale_signals: scaleSignals, location_count: google?.place_id ? 1 : null, review_activity: google?.user_ratings_total || null, procurement_signals: [], trade_records: [] },
      preferred_contact_type: reconciled.preferred?.type || null, preferred_contact_value: reconciled.preferred?.valueRaw || null,
      preferred_contact_source_url: reconciled.preferred?.sourceUrl || null,
      preferred_contact_reason: reconciled.preferred ? `优先采用${reconciled.preferred.sourceChannel === "website" ? "已确认企业官网" : reconciled.preferred.sourceChannel === "google_maps" ? "已匹配Google具体门店" : "已确认官方公开页面"}中的联系方式；未覆盖原始数据。` : null,
      preferred_contact_confidence: reconciled.preferred ? (reconciled.preferred.identityStatus === "MATCHED" ? 90 : 55) : 0,
      analysis_version: ANALYSIS_VERSION, retry_at: retryAt,
      summary: analysis.ai_reason, ai_reason: analysis.ai_reason,
      business_relevance: analysis.business_relevance, customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion,
      confidence_score: analysis.confidence_score, evidence_sufficiency: analysis.evidence_sufficiency,
      evidence_conflicts: analysis.evidence_conflicts, strategy: input.strategy, strategy_version: "1.0",
      analyzed_channels: analyzedChannels, skipped_channels: skippedChannels, early_stop_reason: earlyStopReason,
      model: usage.model, model_calls: usage.model_calls,
      input_tokens: usage.input_tokens, cached_input_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, cost_usd: usage.cost_usd,
      pricing_snapshot: usage.pricing_snapshot, model_snapshot: { primary_model: usage.model }, completed_at: new Date().toISOString(),
      score_breakdown: analysis.score_breakdown,
      entity_match: identity,
      manual_review_status: gate.automationStatus === "AUTO_HOLD" ? "NEEDS_REVIEW" : "NOT_REVIEWED",
      suggested_contact_order: analysis.suggested_contact_order,
      discovered_contacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps, contacts: reconciled.contacts },
      model_version: usage.model, rule_version: AI_RULE_VERSION, field_mapping_version: AI_FIELD_MAPPING_VERSION,
      verified_industry: primaryIndustry,
      target_fit: gate.automationStatus === "AUTO_DEVELOP" ? "TARGET" : gate.automationStatus === "AUTO_REJECT" ? "NOT_TARGET" : "NEEDS_REVIEW",
      lead_priority: analysis.ai_level,
      purchase_scale: "UNKNOWN",
      decision_status: gate.automationStatus === "AUTO_HOLD" ? "NEEDS_REVIEW" : gate.automationStatus,
      short_reason: gate.reason,
      attempt_number: input.attemptNumber || 1,
      is_latest_valid: false,
      writeback_status: "PENDING",
      writeback_warnings: [],
    };
    const invalidatePrevious = await admin.from("ai_screening_results").update({ is_latest_valid: false }).eq("task_item_id", input.taskItemId).eq("is_latest_valid", true);
    if (invalidatePrevious.error) throw invalidatePrevious.error;
    const resultWrite = await admin.from("ai_screening_results").insert(resultPayload).select("id").single();
    if (resultWrite.error || !resultWrite.data) throw resultWrite.error || new Error("RESULT_WRITE_FAILED");

    // A saved model conclusion is only a checkpoint. It is not a completed AI
    // screening until evidence and the customer writeback are both durable.
    const analysisComplete = await admin.from("ai_screening_task_items").update({
      status: "RUNNING",
      analysis_status: "RUNNING",
      writeback_status: "PENDING",
      result_id: resultWrite.data.id,
      automation_status: gate.automationStatus,
      retry_at: retryAt,
      progress: 80,
      current_step: "RESULT_SAVED",
      pipeline_stage: "RESULT_SAVED",
      error_message: null,
      error_code: null,
      error_context: {},
      analyzed_channels: analyzedChannels,
      skipped_channels: skippedChannels,
      early_stop_reason: earlyStopReason,
      input_tokens: usage.input_tokens,
      cached_input_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      cost_usd: usage.cost_usd,
      duration_ms: Date.now() - started,
      completed_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskItemId);
    if (analysisComplete.error) throw analysisComplete.error;
    await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "RESULT_SAVED", startedAt: started, details: { result_id: resultWrite.data.id } });
    const writebackWarnings: Array<ReturnType<typeof normalizeError>> = [];

    // Failed/skipped channels are audit limitations, never business evidence.
    const readableEvidence = analysis.evidence_summaries;
    const evidenceRows = readableEvidence.map((summary) => {
      const channel = AI_CHANNEL_ORDER.includes(summary.channel as AiChannel) ? summary.channel as AiChannel : "other";
      const source = records.find((item) => item.channel === channel);
      const normalizedFact = summary.fact_zh.trim().slice(0, 1600);
      const acquiredByPublicSearch = source?.status !== "COLLECTED";
      const policy = policyEvidence.find((item) => item.channel === summary.channel && item.sourceUrl === summary.source_url && item.fact === summary.fact_zh);
      const evidenceId = randomUUID();
      const canonicalUrl = summary.source_url || source?.source_url || null;
      return {
        id: evidenceId,
        result_id: resultWrite.data.id, task_id: input.taskId, task_item_id: input.taskItemId, customer_id: customer.id,
        source_id: policy?.sourceId || sourceId(channel, summary.source_url || source?.source_url || "", normalizedFact),
        evidence_type: summary.evidence_type, channel,
        source_channel: channel,
        source_name: AI_CHANNEL_LABELS[channel],
        source_type: channel === "google_maps" ? "BUSINESS_PROFILE" : channel === "website" ? "OFFICIAL_WEBSITE" : "PUBLIC_PROFILE",
        source_url: canonicalUrl,
        canonical_url: canonicalUrl,
        verification_url: canonicalUrl,
        source_title: summary.title_zh.trim().slice(0, 180) || null,
        source_account: identity.verifiedBusinessName || customer.company_name,
        source_entity_id: channel === "google_maps" ? identity.placeId : null,
        observed_at: new Date().toISOString(),
        entity_match_score: identity.confidence,
        title: summary.title_zh.trim().slice(0, 180) || `${AI_CHANNEL_LABELS[channel]}关键依据`,
        page_title: summary.title_zh.trim().slice(0, 180) || null,
        content: normalizedFact,
        original_excerpt: normalizedFact,
        original_fact: normalizedFact,
        translated_fact: normalizedFact,
        raw_excerpt: normalizedFact,
        normalized_fact: normalizedFact,
        identity_match_status: identity.status,
        source_reliability: ["website", "google_maps"].includes(channel) ? "OFFICIAL_OR_PLATFORM" : acquiredByPublicSearch ? "PUBLIC_CORROBORATION" : "CONFIRMED_PUBLIC_PAGE",
        evidence_strength: policy ? evidenceStrengthFor(policy) : "WEAK_HINT",
        supports: summary.evidence_type === "支持" ? "目标客户判断" : null,
        contradicts: summary.evidence_type === "矛盾" ? "目标客户判断" : null,
        evidence_confidence: Math.max(0, Math.min(100, Math.round(summary.confidence || 0))),
        extraction_method: acquiredByPublicSearch ? "OPENAI_WEB_SEARCH" : "DIRECT_SOURCE_READ",
        verification_status: identity.status,
        verification_checked_at: new Date().toISOString(),
        metadata: {
          channel,
          status: "COLLECTED",
          acquisition: acquiredByPublicSearch ? "OPENAI_WEB_SEARCH" : "DIRECT_SOURCE_READ",
          media_urls: source?.evidence && "image_urls" in source.evidence
            ? [...(source.evidence.image_urls || []), ...("video_urls" in source.evidence ? source.evidence.video_urls || [] : [])].slice(0, 16)
            : [],
        },
        status: "COLLECTED",
        fetch_status: "COLLECTED",
        error_code: null,
        failure_reason: null,
        content_hash: createHash("sha256").update(`${channel}|${normalizedFact}|${summary.source_url || source?.source_url || ""}`).digest("hex"),
      };
    });
    if (!evidenceRows.length) throw new Error("AI_EVIDENCE_ROWS_EMPTY");
    const savedEvidenceIds: string[] = [];
    {
      const existingEvidence = await admin.from("ai_screening_evidence").select("id,content_hash").eq("result_id", resultWrite.data.id);
      if (existingEvidence.error) throw existingEvidence.error;
      const completedEvidence = new Set((existingEvidence.data || []).map((row) => row.content_hash).filter(Boolean));
      const pendingEvidence = evidenceRows.filter((row) => !completedEvidence.has(row.content_hash));
      if (pendingEvidence.length) {
        const evidenceWrite = await admin.from("ai_screening_evidence").insert(pendingEvidence).select("id");
        if (evidenceWrite.error) throw evidenceWrite.error;
        savedEvidenceIds.push(...(evidenceWrite.data || []).map((row) => String(row.id)));
      }
      savedEvidenceIds.push(...(existingEvidence.data || []).map((row) => String(row.id)));
      const resultEvidence = await admin.from("ai_screening_results").update({
        evidence_ids: [...new Set(savedEvidenceIds)],
        contradiction_evidence_ids: evidenceRows.filter((row) => row.evidence_type === "矛盾").map((row) => row.id),
      }).eq("id", resultWrite.data.id);
      if (resultEvidence.error) throw resultEvidence.error;
      await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "EVIDENCE_SAVED", startedAt: started, details: { evidence_count: savedEvidenceIds.length } });
    }

    const customerUpdate = {
      industry: primaryIndustry === "UNKNOWN" ? customer.industry : analysis.industry_type,
      ai_score: analysis.ai_score, ai_level: analysis.ai_level,
      ai_reason: `${analysis.ai_reason}\n自动处理状态：${gate.automationStatus}；${gate.reason}`,
      is_target_customer: gate.automationStatus === "AUTO_DEVELOP" ? true : gate.automationStatus === "AUTO_REJECT" ? false : null,
      ai_screening_done: true, ai_status: "COMPLETED",
      business_relevance: analysis.business_relevance, customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion, website_email: websiteEmail || null,
      website_phone: websitePhone || null, ai_last_result_id: resultWrite.data.id,
      ai_last_screened_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    {
      const customerWrite = await admin.from("customers").update(customerUpdate).eq("id", customer.id);
      if (customerWrite.error) throw customerWrite.error;
      await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "CUSTOMER_WRITTEN_BACK", startedAt: started });
    }
    await optionalWrite("CONTACT_WRITEBACK", writebackWarnings, async () => {
      await saveVerifiedContacts({ taskId: input.taskId, resultId: resultWrite.data.id, customer, contacts: reconciled.contacts, preferred: reconciled.preferred });
      await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "CONTACTS_SAVED", startedAt: started, details: { contact_count: reconciled.contacts.length } });
    });
    await optionalWrite("CACHE_WRITEBACK", writebackWarnings, async () => {
      await saveReusableAnalysis({
        customer,
        strategy: input.strategy,
        resultId: resultWrite.data.id,
        analysisResult: { ...(resultPayload as unknown as Record<string, unknown>), is_latest_valid: true, writeback_status: "COMPLETED" },
        evidenceSnapshot: evidenceRows as unknown as Array<Record<string, unknown>>,
        discoveredContacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps, contacts: reconciled.contacts },
        modelSnapshot: { primary_model: usage.model, rule_version: AI_RULE_VERSION },
      });
      await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "CACHE_SAVED", startedAt: started });
    });

    const finalItem = await admin.from("ai_screening_task_items").update({
      status: "COMPLETED",
      analysis_status: "COMPLETED",
      writeback_status: "COMPLETED",
      writeback_warning_count: writebackWarnings.length,
      error_context: writebackWarnings.length ? { writeback_warnings: writebackWarnings } : null,
      current_step: "COMPLETED",
      pipeline_stage: "COMPLETED",
      duration_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskItemId);
    if (finalItem.error) throw finalItem.error;
    const finalResult = await admin.from("ai_screening_results").update({
      writeback_status: "COMPLETED",
      writeback_warnings: writebackWarnings,
      is_latest_valid: true,
    }).eq("id", resultWrite.data.id);
    if (finalResult.error) throw finalResult.error;
    await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "COMPLETED", startedAt: started, status: "COMPLETED", details: { writeback_warning_count: writebackWarnings.length } });
    const totals = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
    if (totals.error) throw totals.error;
    return { status: "COMPLETED" as const, resultId: resultWrite.data.id, writebackWarnings };
  } finally {
    analysisController.abort();
  }
}

export function publicAiError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
  if (raw.includes("AI_EVIDENCE_NOT_AVAILABLE") || raw.includes("AI_EVIDENCE_GATE_NOT_SATISFIED") || raw.includes("AI_EVIDENCE_ROWS_EMPTY")) {
    return { code: "AI_EVIDENCE_INSUFFICIENT", message: "本次未取得达到自动判定门槛的可核验经营事实；未写入AI评分，可在公开入口可访问后重试" };
  }
  if (raw.includes("OPENAI_TIMEOUT")) return { code: "OPENAI_TIMEOUT", message: "AI综合判断本次响应超时；已保存公开来源抓取进度，可直接重试而无需重复抓取" };
  if (raw.includes("OPENAI_NOT_CONFIGURED")) return { code: "OPENAI_NOT_CONFIGURED", message: "生产环境未配置OpenAI API密钥" };
  if (raw.includes("OPENAI_API_ERROR")) return { code: "OPENAI_API_ERROR", message: raw.replace(/^.*OPENAI_API_ERROR:/, "OpenAI接口错误：") };
  if (raw.includes("GOOGLE_MAPS_API_KEY_NOT_CONFIGURED")) return { code: "GOOGLE_MAPS_NOT_CONFIGURED", message: "未配置Google Maps API，已保留其他公开渠道证据" };
  return { code: "AI_ANALYSIS_FAILED", message: raw || "AI分析失败" };
}
