import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import {
  analyzeCustomer,
  isComputerHardwareRepairEvidence,
  scoreToLevel,
  type CustomerAnalysis,
} from "./customer-analysis";
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
import {
  buildContactCandidate,
  normalizeEmailStrict,
  normalizePhoneInternational,
  reconcileContacts,
  type ContactCandidate,
  type ContactType,
} from "./contact-intelligence";
import { normalizeError } from "./error-normalization";

type CustomerRow = AiMappedCustomer;

export type ChannelRecord = {
  channel: AiChannel;
  status: "COLLECTED" | "SKIPPED" | "FAILED";
  source_url?: string | null;
  evidence?: WebsiteEvidence | GooglePlaceEvidence;
  error?: string | null;
};

const ANALYSIS_VERSION = "2026.08.27.1";

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

function durableError(error: unknown, stage: string) {
  if (error instanceof Error && error.message && error.message !== "[object Object]") return error;
  const normalized = normalizeError(error, { stage });
  const details = normalized.details ? `；${normalized.details}` : "";
  const hint = normalized.hint ? `；${normalized.hint}` : "";
  const result = new Error(`${normalized.error_code}：${normalized.error_message}${details}${hint}`);
  Object.assign(result, { code: normalized.error_code, details: normalized.details, hint: normalized.hint });
  return result;
}

export function resultLeadPriority(insufficientData: boolean, level: CustomerAnalysis["ai_level"]) {
  // ai_screening_results.lead_priority is NOT NULL in production. An
  // evidence-insufficient customer is still a completed screening result, but
  // receives no score/grade and the lowest workflow priority.
  return insufficientData ? "LOW" : level;
}

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
  if (event.error) throw durableError(event.error, `STAGE_EVENT_${input.stage}`);
  const item = await admin.from("ai_screening_task_items").update({
    pipeline_stage: input.stage,
    current_step: input.stage,
    checkpoint: { stage: input.stage, completed_at: completedAt, ...(input.details || {}) },
    updated_at: completedAt,
  }).eq("id", input.taskItemId);
  if (item.error) throw durableError(item.error, `STAGE_ITEM_${input.stage}`);
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

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "me.com", "yahoo.com", "yahoo.co.uk", "proton.me",
  "protonmail.com", "aol.com", "qq.com", "163.com", "126.com", "wp.pl",
  "onet.pl", "o2.pl", "interia.pl",
]);

function emailBusinessDomain(value?: string | null) {
  const domain = normalizeEmail(value).split("@").at(-1) || "";
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain) || domain.split(".").length < 2) return "";
  return domain;
}

/**
 * A company-domain mailbox is a strong public locator. Imported branch rows
 * frequently contain the official mailbox but omit the website column. Use the
 * domain only to retrieve public evidence; it is never itself treated as proof
 * of an industry or target-customer decision.
 */
function effectiveWebsite(customer: CustomerRow) {
  if (customer.website) return customer.website;
  const domain = emailBusinessDomain(customer.email);
  return domain ? `https://${domain}` : null;
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

function identityNameSimilarity(left?: string | null, right?: string | null) {
  const a = new Set(compactIdentity(left).split(/\s+/).filter((item) => item.length > 1));
  const b = new Set(compactIdentity(right).split(/\s+/).filter((item) => item.length > 1));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  return Math.max(overlap / Math.max(a.size, b.size), overlap / Math.min(a.size, b.size));
}

export function resolveIdentity(customer: CustomerRow, records: ChannelRecord[], analysis?: CustomerAnalysis | null) {
  const google = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  const website = records.find((item) => item.channel === "website" && item.status === "COLLECTED")?.evidence as WebsiteEvidence | undefined;
  // Prefer a fully matched Google entity. If Google is only ambiguous while a
  // supplied official website was successfully read, evaluate that website
  // instead of letting the weaker Maps candidate override stronger identity
  // signals from the exact domain, email and business name.
  const googleConfidence = Number(google?.identity_confidence || 0);
  const googleMatchSignals = google?.match_signals || [];
  const googleMismatchSignals = google?.mismatch_signals || [];
  const exactGoogleSignals = googleMatchSignals.filter((signal) => /名称|电话|官网|域名|地址|具体Google商家入口/.test(signal)).length;
  const normalizedGoogleStatus: IdentityStatus | null = google?.identity_status
    ? (google.identity_status === "AMBIGUOUS" && googleConfidence >= 90 && exactGoogleSignals >= 2 && googleMismatchSignals.length === 0
      ? "MATCHED"
      : google.identity_status as IdentityStatus)
    : null;
  if (normalizedGoogleStatus && (googleConfidence >= 90 || !website?.reachable)) return {
    status: normalizedGoogleStatus,
    confidence: googleConfidence,
    verifiedBusinessName: google?.name || null,
    verifiedAddress: google?.formatted_address || null,
    verifiedWebsite: google?.website || null,
    verifiedGoogleMapsUrl: google?.verified_google_maps_url || customer.google_url,
    placeId: google?.place_id || null,
    candidateCount: Number(google?.candidate_count || 0),
    matchSignals: googleMatchSignals,
    mismatchSignals: googleMismatchSignals,
  };
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
  const nameScore = Math.round(identityNameSimilarity(customer.company_name, pageText) * 65);
  const originalPhone = normalizePhone(customer.phone);
  const phoneMatch = Boolean(originalPhone && website.phones.some((item) => normalizePhone(item) === originalPhone));
  const emailDomain = normalizeEmail(customer.email).split("@")[1] || "";
  let websiteDomain = ""; try { websiteDomain = new URL(website.url).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  const customerWebsite = effectiveWebsite(customer);
  let inputWebsiteDomain = ""; try { inputWebsiteDomain = new URL(/^https?:\/\//i.test(String(customerWebsite || "")) ? String(customerWebsite) : `https://${customerWebsite}`).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  const providedDomainMatch = Boolean(inputWebsiteDomain && websiteDomain && inputWebsiteDomain === websiteDomain);
  const emailMatch = Boolean(emailDomain && websiteDomain && (emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`)));
  const addressMatch = Boolean(customer.address && compactIdentity(pageText).includes(compactIdentity(customer.address).slice(0, 24)));
  // The exact domain of a non-personal company mailbox is a strong identity
  // signal for imported branch records whose display name may only be a mall or
  // district name. It verifies the company, but still does not prove industry.
  const score = Math.min(100, Math.max(providedDomainMatch ? 75 : 0, nameScore + (providedDomainMatch ? 30 : 0) + (phoneMatch ? 25 : 0) + (emailMatch ? 50 : 0) + (addressMatch ? 20 : 0)));
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

function splitContacts(value?: string | null) {
  return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function contactTypeForUrl(value?: string | null): ContactType {
  const url = String(value || "").toLowerCase();
  if (/facebook\.com/.test(url)) return "FACEBOOK";
  if (/instagram\.com/.test(url)) return "INSTAGRAM";
  if (/linkedin\.com/.test(url)) return "LINKEDIN";
  if (/tiktok\.com/.test(url)) return "TIKTOK";
  if (/wa\.me|whatsapp\.com/.test(url)) return "WHATSAPP";
  return "OTHER";
}

function originalValuesForType(customer: CustomerRow, type: ContactType) {
  if (type === "EMAIL") return splitContacts(customer.email);
  if (type === "PHONE" || type === "WHATSAPP") return splitContacts(customer.phone);
  if (type === "FACEBOOK") return splitContacts(customer.facebook_url);
  if (type === "INSTAGRAM") return splitContacts(customer.instagram_url);
  if (type === "LINKEDIN") return splitContacts(customer.linkedin_url);
  if (type === "TIKTOK") return splitContacts(customer.tiktok_url);
  return customer.other_public_urls || [];
}

function contactCandidatesFromRecords(customer: CustomerRow, records: ChannelRecord[], identityStatus: IdentityStatus) {
  const candidates: ContactCandidate[] = [];
  const add = (type: ContactType, value: string, channel: string, url: string, title?: string | null) => {
    const candidate = buildContactCandidate({ type, value, country: customer.country, sourceChannel: channel, sourceUrl: url, sourcePageTitle: title, identityStatus, originalValues: originalValuesForType(customer, type) });
    if (candidate) candidates.push(candidate);
  };
  for (const record of records) {
    if (record.status !== "COLLECTED" || !record.evidence) continue;
    if (record.channel === "google_maps") {
      const item = record.evidence as GooglePlaceEvidence;
      const url = item.verified_google_maps_url || record.source_url || customer.google_url || "";
      if (item.phone) add("PHONE", item.phone, "google_maps", url, item.name);
      for (const email of item.emails || []) add("EMAIL", email, "google_maps", url, item.name);
      if (item.website) add(contactTypeForUrl(item.website), item.website, "google_maps", url, item.name);
      continue;
    }
    const item = record.evidence as WebsiteEvidence;
    const pages = [{ url: item.url, title: item.title, emails: item.emails, phones: item.phones, whatsapps: item.whatsapps || [], social_urls: item.social_urls || [] }, ...(item.pages || []).map((page) => ({ ...page, whatsapps: page.whatsapps || [], social_urls: page.social_urls || [] }))];
    for (const page of pages) {
      for (const email of page.emails || []) add("EMAIL", email, record.channel, page.url, page.title);
      for (const phone of page.phones || []) add("PHONE", phone, record.channel, page.url, page.title);
      for (const whatsapp of page.whatsapps || []) add("WHATSAPP", whatsapp, record.channel, page.url, page.title);
      for (const socialUrl of page.social_urls || []) add(contactTypeForUrl(socialUrl), socialUrl, record.channel, page.url, page.title);
    }
    if (["facebook", "instagram", "linkedin", "tiktok"].includes(record.channel) && record.source_url) {
      add(contactTypeForUrl(record.source_url), record.source_url, record.channel, record.source_url, item.title);
    }
  }
  return reconcileContacts(candidates);
}

function reconcileCachedContacts(customer: CustomerRow, contacts?: ContactCandidate[]) {
  const rebuilt = (contacts || []).map((item) => buildContactCandidate({
    type: item.type,
    value: item.valueRaw,
    country: customer.country,
    sourceChannel: item.sourceChannel,
    sourceUrl: item.sourceUrl,
    sourcePageTitle: item.sourcePageTitle,
    identityStatus: item.identityStatus,
    originalValues: originalValuesForType(customer, item.type),
    capturedAt: item.capturedAt,
  })).filter((item): item is ContactCandidate => Boolean(item));
  return reconcileContacts(rebuilt);
}

function mergedVerifiedContactValues(customer: CustomerRow, contacts: ContactCandidate[], type: "EMAIL" | "PHONE") {
  const existing = splitContacts(type === "EMAIL" ? customer.website_email : customer.website_phone);
  const normalized = (value: string) => type === "EMAIL"
    ? normalizeEmailStrict(value)
    : normalizePhoneInternational(value, customer.country);
  const unique = new Map<string, string>();
  for (const raw of existing) {
    const key = normalized(raw);
    if (key && !unique.has(key)) unique.set(key, raw);
  }
  for (const contact of contacts) {
    if (contact.type !== type || contact.verificationStatus !== "NEW_VERIFIED") continue;
    if (!unique.has(contact.valueNormalized)) unique.set(contact.valueNormalized, contact.valueRaw);
  }
  return [...unique.values()].join(", ");
}

function firstVerifiedContact(contacts: ContactCandidate[], type: ContactType) {
  return contacts.find((item) => item.type === type
    && ["NEW_VERIFIED", "MATCHED_ORIGINAL"].includes(item.verificationStatus))?.valueRaw || null;
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
    language: item.language,
    title: item.title,
    description: item.description?.slice(0, deep ? 360 : 240),
    structured_types: (item.structured_types || []).slice(0, 12),
    structured_names: (item.structured_names || []).slice(0, 6),
    structured_descriptions: (item.structured_descriptions || []).map((value) => value.slice(0, 240)).slice(0, deep ? 6 : 3),
    headings: (item.headings || []).slice(0, deep ? 6 : 4),
    text_excerpt: item.text_excerpt?.slice(0, deep ? 900 : 520),
    image_alts: (item.image_alts || []).filter(Boolean).slice(0, deep ? 5 : 3),
    image_urls: (item.image_urls || []).slice(0, deep ? 2 : 1),
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
      image_urls: (page.image_urls || []).slice(0, 1),
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
      reviews: (google.reviews || []).slice(0, deep ? 3 : 2).map((review) => review.slice(0, deep ? 220 : 160)),
      image_urls: (google.image_urls || []).slice(0, deep ? 2 : 1),
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

const RULE_INDUSTRIES: Array<{ pattern: RegExp; industry: CustomerAnalysis["industry_type"]; baseScore: number; target: boolean }> = [
  { pattern: /(?:mobile[_ ]phone[_ ]repair|cell[_ ]phone[_ ]repair|phone[_ ]repair|smartphone[_ ]repair|reparaci[oó]n (?:de )?(?:tel[eé]fonos m[oó]viles|m[oó]viles|celulares)|r[eé]paration de t[eé]l[eé]phones|handy(?:reparatur|service)|serwis(?:u|em)? (?:telefon[oó]w|gsm|smartfon[oó]w)|napraw(?:a|y|ie) (?:telefon[oó]w|smartfon[oó]w)|手机维修店|手机维修服务|维修手机|手机维修)/i, industry: "手机维修店", baseScore: 52, target: true },
  { pattern: /(?:apple device repair|iphone repair|macbook repair|apple repair|pogwarancyjny serwis apple|serwis(?:u|em)? (?:sprz[eę]tu |urz[aą]dze[nń] )?(?:apple|iphone|ipad|macbook)|napraw(?:a|y|ie) (?:urz[aą]dze[nń] )?(?:apple|iphone|ipad|macbook)|reparaci[oó]n (?:de )?(?:iphone|ipad|macbook|dispositivos apple)|r[eé]paration (?:d['’])?(?:iphone|ipad|macbook|appareils apple)|riparazione (?:iphone|ipad|macbook|dispositivi apple)|repara[cç][aã]o (?:de )?(?:iphone|ipad|macbook|dispositivos apple))/i, industry: "Apple或MacBook维修店", baseScore: 56, target: true },
  { pattern: /(?:computer repair|pc repair|laptop repair|reparaci[oó]n (?:de )?(?:ordenadores|computadoras)|r[eé]paration (?:d['’]ordinateur|informatique)|computerreparatur|serwis (?:komputer[oó]w|laptop[oó]w)|naprawa (?:komputer[oó]w|laptop[oó]w)|电脑维修|计算机维修|电脑硬件维修)/i, industry: "电脑维修店", baseScore: 50, target: true },
  { pattern: /(?:wholesale|wholesaler|distributor|distribution|importer|b2b|bulk order|trade account|hurtownia|sprzedaż hurtowa|dystrybutor|批发|分销|进口商)/i, industry: "进口商或分销商", baseScore: 70, target: true },
  { pattern: /(?:mobile phone accessories|cell phone accessories|phone accessories|akcesoria (?:do )?(?:telefon[oó]w|gsm)|手机配件商店|手机配件)/i, industry: "手机外配件零售", baseScore: 45, target: true },
  { pattern: /(?:software development|software company|it consult(?:ing|ancy)|web hosting|data protection|cyber ?security|cloud services|computer services?|computer technical support|IT support|technical support|managed IT|managed services|network (?:setup|configuration|maintenance|management|support)|NAS (?:setup|configuration|maintenance|support)|server (?:setup|configuration|maintenance|support)|system (?:setup|configuration|maintenance|troubleshooting)|IT[- ]service|Netzwerk(?:service|betreuung)|Systembetreuung|wsparcie IT|konfiguracja sieci|软件开发|软件公司|IT咨询|计算机服务|计算机技术支持|电脑技术支持|IT系统|网络(?:设置|配置|维护|管理|支持)|NAS(?:设置|配置|维护|支持)|服务器(?:设置|配置|维护|支持)|系统(?:设置|配置|维护|故障排除)|网络托管|数据保护|信息安全)/i, industry: "软件或IT服务", baseScore: 18, target: false },
  { pattern: /(?:mobile network operator|telecommunications service provider|sim card|mobile plan|运营商营业厅|手机套餐|电信运营商)/i, industry: "运营商营业厅", baseScore: 22, target: false },
];

const PRODUCT_RELEVANCE_PATTERN = /(?:mobile|phone|cellular|smartphone|iphone|ipad|macbook|computer|laptop|gsm|lcd|oled|screen|battery|repair parts?|spare parts?|accessor(?:y|ies)|telefon|komputer|smartfon|手机|电脑|屏幕|电池|配件|维修件)/i;

function ruleIsSupported(rule: (typeof RULE_INDUSTRIES)[number], text: string) {
  if (!rule.pattern.test(text)) return false;
  // 任何行业都可以出现“批发/分销”字样；必须同时证明手机、电脑或维修配件产品相关，才能归入高价值渠道客户。
  if (rule.industry === "进口商或分销商") return PRODUCT_RELEVANCE_PATTERN.test(text);
  if (rule.industry === "电脑维修店") return isComputerHardwareRepairEvidence(text);
  return true;
}

function deterministicScore(input: {
  rule: (typeof RULE_INDUSTRIES)[number];
  candidate: { channel: string; text: string; confidence: number };
  customer: CustomerRow;
  records: ChannelRecord[];
  google?: GooglePlaceEvidence;
}) {
  const matchingRecords = input.records.filter((record) => {
    if (record.status !== "COLLECTED" || !record.evidence) return false;
    if (record.channel === "google_maps") {
      const evidence = record.evidence as GooglePlaceEvidence;
      return input.rule.pattern.test([...(evidence.types || []), evidence.name, evidence.description].filter(Boolean).join(" "));
    }
    const evidence = record.evidence as WebsiteEvidence;
    return input.rule.pattern.test([evidence.title, evidence.description, ...(evidence.headings || []), evidence.text_excerpt].filter(Boolean).join(" "));
  });
  const matchingSources = new Set(matchingRecords.map((record) => {
    try { return new URL(record.source_url || "").origin; } catch { return record.channel; }
  }).filter(Boolean)).size;
  const combinedText = matchingRecords.map((record) => {
    if (record.channel === "google_maps") {
      const evidence = record.evidence as GooglePlaceEvidence;
      return [...(evidence.types || []), evidence.description, ...(evidence.reviews || [])].filter(Boolean).join("；");
    }
    const evidence = record.evidence as WebsiteEvidence;
    return [evidence.title, evidence.description, ...(evidence.structured_descriptions || []), ...(evidence.headings || []), evidence.text_excerpt].filter(Boolean).join("；");
  }).join("；");
  const specificServices = [
    /(?:screen replacement|lcd|oled|touch ?screen|wymian\w* (?:szyb|wyświetlacz)|换屏|更换屏幕|玻璃更换|触摸屏)/i,
    /(?:battery replacement|wymian\w* bater|换电池|电池更换)/i,
    /(?:charging port|dock connector|motherboard|mainboard|keyboard replacement|camera replacement|尾插|充电口|主板维修|键盘更换|摄像头|排线)/i,
    /(?:repair bench|device disassembly|repair work|维修工作台|拆机维修|维修作业|内配件|维修配件)/i,
    /(?:wholesale|distributor|importer|b2b|moq|trade account|配件批发|配件分销|配件进口|批量供货)/i,
  ].filter((pattern) => pattern.test(combinedText || input.candidate.text)).length;
  const directTargetPattern = /(?:screen replacement|battery replacement|charging port|dock connector|motherboard|mainboard|keyboard replacement|camera replacement|repair bench|device disassembly|lcd|oled|touch ?screen|wymian\w* (?:szyb|wyświetlacz|bater)|换屏|屏幕更换|玻璃更换|电池更换|换电池|尾插|充电口|主板维修|键盘更换|摄像头|排线|维修工作台|拆机维修|维修作业|内配件|维修配件|wholesale|distributor|importer|b2b|moq|trade account|配件批发|配件分销|配件进口|批量供货)/i;
  const recordTargetText = (record: ChannelRecord) => {
    if (!record.evidence) return "";
    if (record.channel === "google_maps") {
      const evidence = record.evidence as GooglePlaceEvidence;
      return [evidence.description, ...(evidence.reviews || [])].filter(Boolean).join("；");
    }
    const evidence = record.evidence as WebsiteEvidence;
    return [evidence.title, evidence.description, ...(evidence.structured_descriptions || []), ...(evidence.headings || []), evidence.text_excerpt].filter(Boolean).join("；");
  };
  const googleDirectTargetEvidence = matchingRecords.some((record) => record.channel === "google_maps" && directTargetPattern.test(recordTargetText(record)));
  const websiteDirectTargetEvidence = matchingRecords.some((record) => record.channel === "website" && directTargetPattern.test(recordTargetText(record)));
  const verifiedContacts = input.records.some((record) => {
    if (record.status !== "COLLECTED" || !record.evidence) return false;
    const evidence = record.evidence as WebsiteEvidence & GooglePlaceEvidence;
    return Boolean(evidence.phone || evidence.phones?.length || evidence.emails?.length);
  });
  const reviewCount = Number(input.google?.user_ratings_total || 0);
  const repairOnly = /维修店/.test(input.rule.industry);
  const wholesale = input.rule.industry === "进口商或分销商";
  const accessoryRetail = input.rule.industry === "手机外配件零售";
  const verifiedChain = /(?:连锁|多家门店|多门店|分店|multiple locations|chain of repair|sie[cć] serwis)/i.test(combinedText);
  const highVolumeRepair = repairOnly
    && matchingSources >= 2
    && specificServices >= 2
    && (reviewCount >= 100 || verifiedChain || /(?:大型维修中心|多名维修技师|丰富维修案例|维修工作台|配件库存|large repair center|multiple technicians)/i.test(combinedText));
  const verifiedProcurementEvidence = input.records.some((record) => {
    if (record.status !== "COLLECTED" || !record.evidence || typeof record.evidence !== "object") return false;
    const evidence = record.evidence as Record<string, unknown>;
    const rows = [...(Array.isArray(evidence.customs_records) ? evidence.customs_records : []), ...(Array.isArray(evidence.trade_records) ? evidence.trade_records : [])];
    return rows.some((row) => row && typeof row === "object" && /^https?:\/\//i.test(String((row as Record<string, unknown>).source_url || record.source_url || ""))
      && PRODUCT_RELEVANCE_PATTERN.test(String((row as Record<string, unknown>).product || ""))
      && ["quantity", "amount", "date"].some((key) => Boolean((row as Record<string, unknown>)[key])));
  });

  // 客户价值由独立事实维度组成，不能因行业标签而集中得到固定分数。
  const businessFit = wholesale ? 38 : repairOnly ? Math.min(38, 32 + specificServices * 2) : accessoryRetail ? 24 : input.rule.target ? 28 : 12;
  const scaleValue = verifiedChain ? 20 : highVolumeRepair ? 18 : wholesale ? (matchingSources >= 2 ? 15 : 8) : repairOnly ? (matchingSources >= 2 ? 8 : 6) : 5;
  const procurementValue = verifiedProcurementEvidence ? 20 : wholesale ? (matchingSources >= 2 ? 10 : 6) : highVolumeRepair ? 8 : repairOnly ? 3 : 2;
  const evidenceValue = matchingSources >= 3 ? 15 : matchingSources >= 2 ? 12 : 10;
  const websiteReachable = input.records.some((record) => record.channel === "website" && record.status === "COLLECTED");
  const activityValue = Math.min(8, (reviewCount >= 100 ? 7 : reviewCount >= 20 ? 5 : reviewCount > 0 ? 3 : 0) + (websiteReachable ? 2 : 0));
  const contactValue = verifiedContacts ? (input.customer.phone && input.customer.email ? 5 : 4) : 0;
  const multiSourceOperatingBonus = matchingSources >= 2 ? 3 : 0;
  const completeDirectTargetChain = input.rule.target
    && matchingSources >= 2
    && websiteReachable
    && googleDirectTargetEvidence
    && websiteDirectTargetEvidence
    && specificServices >= 1;
  const rawScore = businessFit + scaleValue + procurementValue + evidenceValue + activityValue + contactValue
    + multiSourceOperatingBonus + (completeDirectTargetChain ? 12 : 0);
  const qualifiesForA = completeDirectTargetChain || (input.rule.target && matchingSources >= 2
    && (verifiedProcurementEvidence || highVolumeRepair || (wholesale && scaleValue >= 15)));
  const targetMaximum = repairOnly
    ? highVolumeRepair ? 94 : completeDirectTargetChain ? 89 : 84
    : accessoryRetail ? 69
      : qualifiesForA ? (verifiedProcurementEvidence ? 100 : 89) : 84;
  const score = Math.max(0, Math.min(input.rule.target ? targetMaximum : 39, rawScore));
  const evidenceCompleteness = Math.min(100, 35 + evidenceValue * 3 + contactValue * 3 + activityValue * 2);
  return {
    score,
    breakdown: {
      entity_consistency: Math.max(0, Math.min(100, input.candidate.confidence)),
      company_authenticity: Math.min(100, 55 + evidenceValue * 2 + activityValue * 2),
      business_activity: Math.min(100, 35 + activityValue * 7 + scaleValue),
      mobile_parts_match: input.rule.target ? Math.min(100, businessFit * 2.5) : Math.min(score, 40),
      macbook_parts_match: /apple|iphone|macbook/i.test(input.candidate.text) ? Math.min(100, score + 5) : 0,
      wholesale_import_distribution: wholesale ? Math.min(100, 55 + scaleValue + procurementValue) : Math.min(35, score),
      repair_business_match: repairOnly ? Math.min(100, 55 + specificServices * 10 + Math.min(20, scaleValue)) : Math.min(45, score),
      bulk_purchase_potential: Math.min(100, 25 + scaleValue * 2 + procurementValue * 2),
      contactability: input.customer.phone && input.customer.email ? 90 : input.customer.phone || input.customer.email ? 70 : 35,
      evidence_completeness: evidenceCompleteness,
      contradiction_risk: 0,
    } satisfies CustomerAnalysis["score_breakdown"],
  };
}

function conciseDeterministicFact(candidate: { channel: string; text: string }, industry: CustomerAnalysis["industry_type"]) {
  if (candidate.channel === "google_maps") {
    const chineseTypes = candidate.text.split("；").filter((item) => /[\u3400-\u9fff]/.test(item) && item.length <= 24).slice(0, 4);
    return chineseTypes.length
      ? `Google商家页公开分类为“${chineseTypes.join("、")}”，可直接确认其经营范围属于“${industry}”相关业务。`
      : `Google商家页公开分类和经营说明明确显示该企业从事“${industry}”相关业务。`;
  }
  const specifics: string[] = [];
  if (/(?:wymian\w* (?:szyb|wyświetlacz)|screen replacement|换屏|更换屏幕)/i.test(candidate.text)) specifics.push("屏幕或玻璃更换");
  if (/(?:wymian\w* bater|battery replacement|换电池|电池更换)/i.test(candidate.text)) specifics.push("电池更换");
  if (/(?:iphone|samsung|xiaomi|huawei|macbook)/i.test(candidate.text)) specifics.push("主流手机或电脑品牌维修");
  const detail = specifics.length ? `，并明确提到${specifics.join("、")}` : "";
  return `企业官网页面标题与业务说明明确提供“${industry}”相关服务${detail}。`;
}

function deterministicEvidenceType(target: boolean) {
  return target ? "支持" as const : "矛盾" as const;
}

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
  const websiteRecord = records.find((item) => item.channel === "website" && item.status === "COLLECTED");
  const website = websiteRecord?.evidence as WebsiteEvidence | undefined;
  if (google?.business_status === "CLOSED_PERMANENTLY" && !website?.reachable && /^https?:\/\//i.test(googleUrl)) {
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
      // 商家名称只用于主体匹配，严禁用名称中的 Repair/Serwis 等词推断行业。
      text: [...(google.types || []), google.description].filter(Boolean).join("；"),
      confidence: Math.max(70, Number(google.identity_confidence || 0)),
    });
  }
  if (website?.reachable && /^https?:\/\//i.test(website.url)) {
    candidates.push({
      channel: "website",
      url: website.url,
      title: "企业官网业务说明",
      // 结构化企业名称也是定位线索，不是行业证据。只使用官网业务描述、类型和标题。
      text: [website.title, website.description, ...(website.structured_types || []), ...(website.structured_descriptions || []), ...(website.headings || []), website.text_excerpt?.slice(0, 1600)].filter(Boolean).join("；").slice(0, 4000),
      confidence: 92,
    });
  }
  const matches = candidates.flatMap((candidate) => RULE_INDUSTRIES
    .filter((rule) => {
      if (!ruleIsSupported(rule, candidate.text)) return false;
      if (candidate.channel !== "google_maps" || !rule.target) return true;
      // Google 分类只负责定位候选主体。目标客户分类还需要商家描述、
      // 评论或部件级服务事实佐证；否则交给后续视觉/模型核验。
      const corroborationText = [google?.description, ...(google?.reviews || [])].filter(Boolean).join("；");
      return ruleIsSupported(rule, corroborationText)
        || /(?:换屏|屏幕更换|玻璃更换|换电池|电池更换|尾插|充电口|主板|拆机|维修作业|screen replacement|battery replacement|charging port|motherboard|wymian\w* (?:szyb|wyświetlacz|bater))/i.test(corroborationText);
    })
    .map((rule) => ({ candidate, rule, scored: deterministicScore({ rule, candidate, customer, records, google }) })))
    .sort((left, right) => right.scored.score - left.scored.score || right.candidate.confidence - left.candidate.confidence);
  const selected = matches[0];
  if (!selected) return null;
  const evidenceSummaries = candidates.flatMap((candidate) => {
    const match = matches.find((item) => item.candidate === candidate);
    if (!match) return [];
    return [{
      channel: candidate.channel,
      title_zh: candidate.title,
      fact_zh: conciseDeterministicFact(candidate, match.rule.industry),
      source_url: candidate.url,
      evidence_type: deterministicEvidenceType(match.rule.target),
      confidence: candidate.confidence,
    }];
  }).filter((item, index, all) => all.findIndex((other) => other.channel === item.channel && other.source_url === item.source_url) === index).slice(0, 4);
  const score = selected.scored.score;
  const facts = evidenceSummaries.map((item) => item.fact_zh);
  const sourceNames = [...new Set(evidenceSummaries.map((item) => item.channel === "google_maps" ? "Google商家页" : "企业官网"))].join("和");
  const contactChannels = [customer.phone ? "原始电话" : "", customer.email ? "原始邮箱" : ""].filter(Boolean);
  const repairIndustry = /维修/.test(selected.rule.industry);
  const wholesaleIndustry = /批发|进口|分销/.test(selected.rule.industry);
  return {
    industry_type: selected.rule.industry,
    is_target_customer: selected.rule.target,
    ai_score: score,
    ai_level: scoreToLevel(score),
    ai_reason: `已核验${sourceNames}中的公开经营信息：${facts.join("；")}`,
    business_relevance: wholesaleIndustry
      ? `公开来源明确显示该企业从事${selected.rule.industry}相关业务，与手机和电脑配件外贸批发的渠道客户画像直接匹配。`
      : repairIndustry
        ? `公开来源明确显示该企业提供${selected.rule.industry}相关服务，具备维修用手机或电脑配件的实际使用场景。`
        : `公开来源明确显示该企业经营${selected.rule.industry}相关业务，与目标产品存在可解释的业务关联。`,
    customer_value: wholesaleIndustry
      ? "其公开经营模式具备批量采购或渠道合作场景；实际采购品类、采购量和合作周期仍需销售沟通确认。"
      : repairIndustry
        ? "其维修业务会实际使用屏幕、电池、接口、排线等维修配件，存在补货机会；门店规模和月度用量仍需销售确认。"
        : "已确认其经营业务与目标产品相关，具体采购频率、数量和决策角色仍需销售确认。",
    followup_suggestion: `${contactChannels.length ? `优先通过${contactChannels.join("或")}` : "通过已核验公开联系方式"}联系，引用已确认的“${selected.rule.industry}”业务切入，询问常用配件品类、月度用量、当前采购渠道和报价需求。`,
    confidence_score: Math.max(...evidenceSummaries.map((item) => item.confidence)),
    evidence_sufficiency: "充分",
    evidence_conflicts: [],
    score_breakdown: selected.scored.breakdown,
    suggested_contact_order: ["电话", "邮箱", "WhatsApp"],
    evidence_summaries: evidenceSummaries,
    usage: { ...ZERO_USAGE, model: "RULE_ENGINE" },
  };
}

function insufficientDataAnalysis(customer: CustomerRow, records: ChannelRecord[]): CustomerAnalysis {
  const collected = records.filter((item) => item.status === "COLLECTED");
  const failed = records.filter((item) => item.status === "FAILED");
  const collectedText = collected.length
    ? `已读取${collected.map((item) => AI_CHANNEL_LABELS[item.channel]).join("、")}，但未提取到能够确认经营行业的直接事实`
    : "未找到能够与该客户主体可靠匹配并可读取的公开企业页面";
  const limitation = failed.length
    ? `；${failed.map((item) => AI_CHANNEL_LABELS[item.channel]).join("、")}未能取得有效公开内容`
    : "";
  const reason = `${collectedText}${limitation}。本次筛选已完成，但资料不足，不评级、不打分，也不判定为有效或无效客户。`;
  return {
    // 内部保持合法行业枚举；资料不足时最终写回会将行业、分数和等级留空。
    industry_type: "其他",
    is_target_customer: false,
    ai_score: 0,
    ai_level: "D",
    ai_reason: reason,
    business_relevance: "现有公开资料不足以确认该企业的实际经营范围，不能据此判断与手机、电脑配件业务的相关程度。",
    customer_value: "暂不判断客户价值；需要补充可匹配的官网、具体Google商家页或其他官方公开主页后再分析。",
    followup_suggestion: "如需继续开发，请先补充或核验企业官网、具体Google商家页及有效联系方式，再创建新的AI筛选任务。",
    confidence_score: 0,
    evidence_sufficiency: "不足",
    evidence_conflicts: [],
    score_breakdown: emptyBreakdown(0),
    suggested_contact_order: [],
    evidence_summaries: [],
    usage: { ...ZERO_USAGE, model: "NO_MODEL" },
  };
}

export function verifiedBusinessScope(analysis: CustomerAnalysis) {
  const facts = analysis.evidence_summaries
    .filter((item) => item.evidence_type === "支持" && item.confidence >= 60)
    .map((item) => item.fact_zh.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!facts.length) return null;
  const directFacts = [...new Set(facts)].slice(0, 2).join("；");
  return `主营：${analysis.industry_type}。已核验经营事实：${directFacts}`.slice(0, 600);
}

export function verifiedCompanyScale(records: ChannelRecord[]) {
  type TradeFact = { product?: unknown; quantity?: unknown; amount?: unknown; currency?: unknown; date?: unknown; supplier?: unknown; source_url?: unknown };
  const verified: Array<{ text: string; sourceUrl: string }> = [];
  for (const record of records) {
    if (record.status !== "COLLECTED" || !record.evidence || typeof record.evidence !== "object") continue;
    const evidence = record.evidence as Record<string, unknown>;
    const rawRows = [...(Array.isArray(evidence.customs_records) ? evidence.customs_records : []), ...(Array.isArray(evidence.trade_records) ? evidence.trade_records : [])];
    for (const raw of rawRows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as TradeFact;
      const sourceUrl = typeof row.source_url === "string" && /^https?:\/\//i.test(row.source_url) ? row.source_url : record.source_url || "";
      const product = typeof row.product === "string" ? row.product.trim() : "";
      const quantity = row.quantity == null ? "" : String(row.quantity).trim();
      const amount = row.amount == null ? "" : String(row.amount).trim();
      const date = typeof row.date === "string" ? row.date.trim() : "";
      if (!sourceUrl || !product || (!quantity && !amount && !date)) continue;
      const detail = [date ? `日期${date}` : "", `产品${product}`, quantity ? `数量${quantity}` : "", amount ? `金额${amount}${row.currency ? ` ${String(row.currency)}` : ""}` : "", row.supplier ? `供应商${String(row.supplier)}` : ""].filter(Boolean).join("，");
      verified.push({ text: detail, sourceUrl });
    }
  }
  if (!verified.length) return { companyScale: null, companyScaleEvidence: null };
  const facts = verified.slice(0, 3).map((item) => `${item.text}（核验：${item.sourceUrl}）`).join("；");
  return { companyScale: "存在可核验采购记录", companyScaleEvidence: facts.slice(0, 1200) };
}

function channelUrl(customer: CustomerRow, channel: AiChannel): string | null {
  if (channel === "website") return effectiveWebsite(customer);
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
        ? await collectGooglePlaceEvidence({ company_name: customer.company_name, country: customer.country, address: customer.address, google_url: customer.google_url, phone: customer.phone, website: effectiveWebsite(customer) }, { signal, timeoutMs: 12_000 })
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
  const errorUsage = input.error && typeof input.error === "object"
    ? (input.error as { usage?: CustomerAnalysis["usage"] }).usage
    : undefined;
  const usage = input.usage || errorUsage || ZERO_USAGE;
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
    .select("id,type,value_normalized,source,verification_status")
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
  // Some production projects were initialized before the optional normalized
  // contact unique index existed. Do not let contact persistence depend on that
  // migration: update an existing logical key or insert it when absent.
  const existingRows = existing.data || [];
  for (const row of rows) {
    const match = existingRows.find((item) => item.type === row.type
      && item.value_normalized === row.value_normalized && item.source === row.source);
    const write = match
      ? await admin.from("customer_contacts").update(row).eq("id", match.id)
      : await admin.from("customer_contacts").insert(row);
    if (write.error) throw write.error;
  }
  const audits = input.contacts
    .filter((item) => {
      if (!["MATCHED_ORIGINAL", "NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(item.verificationStatus)) return false;
      const previous = existingByKey.get(`${item.type}|${item.valueNormalized}|${item.sourceChannel}`);
      return previous !== item.verificationStatus;
    })
    .map((item) => ({
      task_id: input.taskId,
      customer_id: input.customer.id,
      result_id: input.resultId,
      action: item.verificationStatus === "MATCHED_ORIGINAL"
        ? "VERIFY_ORIGINAL_CONTACT_SOURCE"
        : item.verificationStatus === "NEW_VERIFIED" ? "DISCOVER_VERIFIED_CONTACT" : "CONTACT_SOURCE_CONFLICT",
      old_value: originalValuesForType(input.customer, item.type).join(", ") || null,
      new_value: item.valueRaw,
      source_url: item.sourceUrl,
      captured_at: item.capturedAt,
      analysis_version: ANALYSIS_VERSION,
    }));
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
  const cachedContacts = reconcileCachedContacts(customer, discovered.contacts);
  const websiteEmail = mergedVerifiedContactValues(customer, cachedContacts.contacts, "EMAIL");
  const websitePhone = mergedVerifiedContactValues(customer, cachedContacts.contacts, "PHONE");
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
      business_scope: cachedResult.business_scope || customer.business_scope || null,
      company_scale: cachedResult.company_scale || customer.company_scale || null,
      company_scale_evidence: cachedResult.company_scale_evidence || customer.company_scale_evidence || null,
      website_email: websiteEmail || null,
      website_phone: websitePhone || null,
      ...(customer.whatsapp ? {} : { whatsapp: firstVerifiedContact(cachedContacts.contacts, "WHATSAPP") }),
      ...(customer.facebook_url ? {} : { facebook_url: firstVerifiedContact(cachedContacts.contacts, "FACEBOOK") }),
      ...(customer.instagram_url ? {} : { instagram_url: firstVerifiedContact(cachedContacts.contacts, "INSTAGRAM") }),
      ...(customer.linkedin_url ? {} : { linkedin_url: firstVerifiedContact(cachedContacts.contacts, "LINKEDIN") }),
      ...(customer.tiktok_url ? {} : { tiktok_url: firstVerifiedContact(cachedContacts.contacts, "TIKTOK") }),
      ai_last_result_id: resultWrite.data.id,
      ai_last_screened_at: now,
      updated_at: now,
  }).eq("id", customer.id);
  if (customerWrite.error) throw customerWrite.error;
  if (cachedContacts.contacts.length) {
    const preferredValue = String(cachedResult.preferred_contact_value || "");
    const preferred = cachedContacts.contacts.find((item) => item.valueRaw === preferredValue || item.valueNormalized === preferredValue) || cachedContacts.preferred || null;
    await optionalWrite("REUSED_CONTACT_WRITEBACK", warnings, () => saveVerifiedContacts({ taskId: input.taskId, resultId: resultWrite.data.id, customer, contacts: cachedContacts.contacts, preferred }));
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
      analysis = insufficientDataAnalysis(customer, records);
      earlyStopReason = "公开来源检索已完成，但没有取得可用于行业判断的可靠经营事实；本次不调用大模型。";
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
          customer_name: customer.company_name, country: customer.country, website: effectiveWebsite(customer),
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
    const insufficientData = gate.automationStatus === "AUTO_HOLD" || !analysis.evidence_summaries.length;
    const reconciled = contactCandidatesFromRecords(customer, records, identity.status);
    // Conflicting official sources remain visible in customer_contacts for
    // manual verification, but are not written into the customer's usable
    // system-discovered fields. Only an unambiguous new contact is promoted.
    const websiteEmail = mergedVerifiedContactValues(customer, reconciled.contacts, "EMAIL");
    const websitePhone = mergedVerifiedContactValues(customer, reconciled.contacts, "PHONE");
    const discoveredWhatsapps = reconciled.contacts.filter((item) => item.type === "WHATSAPP").map((item) => item.valueRaw);
    const analyzedChannels = records.filter((item) => item.status === "COLLECTED").map((item) => item.channel);
    const skippedChannels = records.filter((item) => item.status !== "COLLECTED").map((item) => ({ channel: item.channel, status: item.status, reason: item.error }));
    const retryAt = null;
    const google = records.find((item) => item.channel === "google_maps")?.evidence as GooglePlaceEvidence | undefined;
    const businessScope = insufficientData ? null : verifiedBusinessScope(analysis);
    const verifiedScale = verifiedCompanyScale(records);
    const scaleSignals = verifiedScale.companyScaleEvidence ? [verifiedScale.companyScaleEvidence] : [];
    const resultPayload = {
      customer_id: customer.id, task_id: input.taskId, task_item_id: input.taskItemId,
      score: insufficientData ? null : analysis.ai_score, grade: insufficientData ? null : analysis.ai_level,
      target_decision: insufficientData ? "REVIEW" : compatibilityTargetDecision(gate.automationStatus), automation_status: gate.automationStatus,
      customer_type: insufficientData ? null : analysis.industry_type, industry_type: insufficientData ? null : analysis.industry_type,
      primary_industry: primaryIndustry, secondary_industries: [], business_activities: businessScope ? [businessScope] : [],
      business_scope: businessScope,
      company_scale: verifiedScale.companyScale,
      company_scale_evidence: verifiedScale.companyScaleEvidence,
      industry_confidence: insufficientData ? 0 : analysis.confidence_score, identity_confidence: identity.confidence,
      decision_confidence: insufficientData ? 0 : analysis.confidence_score, contact_confidence: reconciled.preferred ? (reconciled.preferred.identityStatus === "MATCHED" ? 90 : 55) : 0,
      scale_confidence: scaleSignals.length ? 90 : 0, evidence_sufficiency_score: Math.min(100, policyEvidence.filter((item) => item.kind !== "中性").length * 20),
      identity_status: identity.status, identity_details: identity,
      verified_business_name: identity.verifiedBusinessName, verified_address: identity.verifiedAddress,
      verified_website: identity.verifiedWebsite, verified_google_maps_url: identity.verifiedGoogleMapsUrl,
      place_id: identity.placeId, candidate_count: identity.candidateCount,
      match_signals: identity.matchSignals, mismatch_signals: identity.mismatchSignals,
      industry_evidence_ids: gate.evidenceIds, industry_conflicts: analysis.evidence_conflicts,
      scale_analysis: { scale_level: verifiedScale.companyScale || "UNKNOWN", scale_confidence: scaleSignals.length ? 90 : 0, scale_signals: scaleSignals, location_count: google?.place_id ? 1 : null, review_activity: google?.user_ratings_total || null, procurement_signals: scaleSignals, trade_records: [] },
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
      manual_review_status: insufficientData ? "INSUFFICIENT_DATA" : "NOT_REVIEWED",
      suggested_contact_order: analysis.suggested_contact_order,
      discovered_contacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps, contacts: reconciled.contacts },
      model_version: usage.model, rule_version: AI_RULE_VERSION, field_mapping_version: AI_FIELD_MAPPING_VERSION,
      verified_industry: primaryIndustry,
      target_fit: gate.automationStatus === "AUTO_DEVELOP" ? "TARGET" : gate.automationStatus === "AUTO_REJECT" ? "NOT_TARGET" : "INSUFFICIENT_DATA",
      lead_priority: resultLeadPriority(insufficientData, analysis.ai_level),
      purchase_scale: verifiedScale.companyScale || "UNKNOWN",
      decision_status: insufficientData ? "INSUFFICIENT_DATA" : gate.automationStatus,
      short_reason: insufficientData ? analysis.ai_reason : gate.reason,
      attempt_number: input.attemptNumber || 1,
      is_latest_valid: false,
      writeback_status: "PENDING",
      writeback_warnings: [],
    };
    const invalidatePrevious = await admin.from("ai_screening_results").update({ is_latest_valid: false }).eq("task_item_id", input.taskItemId).eq("is_latest_valid", true);
    if (invalidatePrevious.error) throw durableError(invalidatePrevious.error, "INVALIDATE_PREVIOUS_RESULT");
    const resultWrite = await admin.from("ai_screening_results").insert(resultPayload).select("id").single();
    if (resultWrite.error || !resultWrite.data) throw durableError(resultWrite.error || new Error("RESULT_WRITE_FAILED"), "RESULT_WRITE");

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
    if (analysisComplete.error) throw durableError(analysisComplete.error, "RESULT_CHECKPOINT_WRITE");
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
    const savedEvidenceIds: string[] = [];
    if (evidenceRows.length) {
      const existingEvidence = await admin.from("ai_screening_evidence").select("id,content_hash").eq("result_id", resultWrite.data.id);
      if (existingEvidence.error) throw durableError(existingEvidence.error, "EVIDENCE_LOOKUP");
      const completedEvidence = new Set((existingEvidence.data || []).map((row) => row.content_hash).filter(Boolean));
      const pendingEvidence = evidenceRows.filter((row) => !completedEvidence.has(row.content_hash));
      if (pendingEvidence.length) {
        const evidenceWrite = await admin.from("ai_screening_evidence").insert(pendingEvidence).select("id");
        if (evidenceWrite.error) throw durableError(evidenceWrite.error, "EVIDENCE_WRITE");
        savedEvidenceIds.push(...(evidenceWrite.data || []).map((row) => String(row.id)));
      }
      savedEvidenceIds.push(...(existingEvidence.data || []).map((row) => String(row.id)));
      const resultEvidence = await admin.from("ai_screening_results").update({
        evidence_ids: [...new Set(savedEvidenceIds)],
        contradiction_evidence_ids: evidenceRows.filter((row) => row.evidence_type === "矛盾").map((row) => row.id),
      }).eq("id", resultWrite.data.id);
      if (resultEvidence.error) throw durableError(resultEvidence.error, "RESULT_EVIDENCE_LINK");
      await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "EVIDENCE_SAVED", startedAt: started, details: { evidence_count: savedEvidenceIds.length } });
    }

    const customerUpdate = {
      industry: insufficientData || primaryIndustry === "UNKNOWN" ? customer.industry : analysis.industry_type,
      ai_score: insufficientData ? null : analysis.ai_score, ai_level: insufficientData ? null : analysis.ai_level,
      ai_reason: analysis.ai_reason,
      is_target_customer: insufficientData ? null : gate.automationStatus === "AUTO_DEVELOP" ? true : false,
      ai_screening_done: true, ai_status: "COMPLETED",
      business_relevance: analysis.business_relevance, customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion, website_email: websiteEmail || null,
      website_phone: websitePhone || null,
      business_scope: businessScope,
      company_scale: verifiedScale.companyScale || customer.company_scale || null,
      company_scale_evidence: verifiedScale.companyScaleEvidence || customer.company_scale_evidence || null,
      ...(customer.whatsapp ? {} : { whatsapp: firstVerifiedContact(reconciled.contacts, "WHATSAPP") }),
      ...(customer.facebook_url ? {} : { facebook_url: firstVerifiedContact(reconciled.contacts, "FACEBOOK") }),
      ...(customer.instagram_url ? {} : { instagram_url: firstVerifiedContact(reconciled.contacts, "INSTAGRAM") }),
      ...(customer.linkedin_url ? {} : { linkedin_url: firstVerifiedContact(reconciled.contacts, "LINKEDIN") }),
      ...(customer.tiktok_url ? {} : { tiktok_url: firstVerifiedContact(reconciled.contacts, "TIKTOK") }),
      ai_last_result_id: resultWrite.data.id,
      ai_last_screened_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    {
      const customerWrite = await admin.from("customers").update(customerUpdate).eq("id", customer.id);
      if (customerWrite.error) throw durableError(customerWrite.error, "CUSTOMER_AI_WRITEBACK");
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
      // Production keeps this JSONB column NOT NULL. An empty successful run
      // must therefore persist an empty object instead of null; otherwise a
      // fully analyzed customer is incorrectly reported as FAILED here.
      error_context: writebackWarnings.length ? { writeback_warnings: writebackWarnings } : {},
      current_step: "COMPLETED",
      pipeline_stage: "COMPLETED",
      duration_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskItemId);
    if (finalItem.error) throw durableError(finalItem.error, "TASK_ITEM_COMPLETION");
    const finalResult = await admin.from("ai_screening_results").update({
      writeback_status: "COMPLETED",
      writeback_warnings: writebackWarnings,
      is_latest_valid: true,
    }).eq("id", resultWrite.data.id);
    if (finalResult.error) throw durableError(finalResult.error, "RESULT_COMPLETION");
    await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "COMPLETED", startedAt: started, status: "COMPLETED", details: { writeback_warning_count: writebackWarnings.length } });
    const totals = await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
    if (totals.error) throw durableError(totals.error, "TASK_TOTAL_REFRESH");
    return { status: "COMPLETED" as const, resultId: resultWrite.data.id, writebackWarnings };
  } finally {
    analysisController.abort();
  }
}

export function publicAiError(error: unknown) {
  const normalized = normalizeError(error, { stage: "ANALYSIS" });
  const raw = normalized.error_message;
  if (raw.includes("AI_EVIDENCE_NOT_AVAILABLE") || raw.includes("AI_EVIDENCE_ROWS_EMPTY")) {
    return { code: "AI_EVIDENCE_INSUFFICIENT", message: "本次未取得达到自动判定门槛的可核验经营事实；未写入AI评分，可在公开入口可访问后重试" };
  }
  if (raw.includes("OPENAI_TIMEOUT")) return { code: "OPENAI_TIMEOUT", message: "AI综合判断本次响应超时；已保存公开来源抓取进度，可直接重试而无需重复抓取" };
  if (raw.includes("OPENAI_NOT_CONFIGURED")) return { code: "OPENAI_NOT_CONFIGURED", message: "生产环境未配置OpenAI API密钥" };
  if (raw.includes("OPENAI_API_ERROR")) return { code: "OPENAI_API_ERROR", message: raw.replace(/^.*OPENAI_API_ERROR:/, "OpenAI接口错误：") };
  if (raw.includes("GOOGLE_MAPS_API_KEY_NOT_CONFIGURED")) return { code: "GOOGLE_MAPS_NOT_CONFIGURED", message: "未配置Google Maps API，已保留其他公开渠道证据" };
  if (normalized.error_code === "23502") {
    return { code: "ANALYSIS_RESULT_WRITE_FAILED", message: `分析结果保存失败：${raw}` };
  }
  return {
    code: normalized.error_code === "UNKNOWN_ERROR" ? "AI_ANALYSIS_FAILED" : normalized.error_code,
    message: raw || "AI分析失败",
  };
}
