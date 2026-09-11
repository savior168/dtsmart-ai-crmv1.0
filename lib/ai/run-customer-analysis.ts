import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { budgetExceededMessage, releaseApiCostBudget, reserveApiCostBudget } from "../api-cost-budget";
import {
  analyzeCustomer,
  groundCustomerAnalysis,
  isComputerHardwareRepairEvidence,
  isDirectNonTargetBusinessEvidence,
  hasDirectTargetBusinessEvidence,
  positiveTargetEvidenceText,
  scoreToLevel,
  type CustomerAnalysis,
} from "./customer-analysis";
import {
  collectDeepWebsiteEvidence,
  collectGooglePlaceEvidence,
  collectPublicGooglePlaceEvidence,
  collectPublicPageEvidence,
  discoverPublicBusinessUrls,
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
  type AutomationStatus,
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
import { jsonSafe, normalizeError } from "./error-normalization";

type CustomerRow = AiMappedCustomer;

export function shouldReuseAnalysisForTask(filters: unknown) {
  if (!filters || typeof filters !== "object") return true;
  const value = filters as Record<string, unknown>;
  return !Boolean(value.force_fresh_analysis || value.reanalysis_scope === "INVALID");
}

export function reusableResultAllowedForTask(filters: unknown, cached: unknown) {
  if (!filters || typeof filters !== "object") return true;
  const value = filters as Record<string, unknown>;
  if (!value.reuse_only_valid_results) return true;
  if (!cached || typeof cached !== "object") return false;
  const row = cached as Record<string, unknown>;
  const analysis = row.analysis_result && typeof row.analysis_result === "object"
    ? row.analysis_result as Record<string, unknown> : {};
  return analysis.automation_status === "AUTO_DEVELOP"
    && analysis.target_decision === "VALID"
    && analysis.evidence_sufficiency === "充分"
    && Number(analysis.confidence_score || 0) >= 82;
}

export type ChannelRecord = {
  channel: AiChannel;
  status: "COLLECTED" | "SKIPPED" | "FAILED";
  source_url?: string | null;
  evidence?: WebsiteEvidence | GooglePlaceEvidence;
  error?: string | null;
};

const ANALYSIS_VERSION = "2026.09.09.21";
const OPENAI_MIN_SAFE_RESERVATION_USD = 0.15;

function openAiBudgetReservationUsd() {
  const configured = Number(process.env.OPENAI_MAX_RESERVED_USD_PER_CALL || OPENAI_MIN_SAFE_RESERVATION_USD);
  return Number.isFinite(configured) ? Math.max(OPENAI_MIN_SAFE_RESERVATION_USD, configured) : OPENAI_MIN_SAFE_RESERVATION_USD;
}

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

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

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
  // low-evidence customer is still a completed, scored screening result, but
  // receives the lowest workflow priority.
  return insufficientData ? "LOW" : level || "LOW";
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
  userId?: string | null;
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
  if (customer.website && !aiChannelForPublicUrl(customer.website)) return customer.website;
  const domain = emailBusinessDomain(customer.email);
  return domain ? `https://${domain}` : null;
}

const NON_OFFICIAL_WEBSITE_HOSTS = /(?:facebook|instagram|linkedin|tiktok|youtube|google|goo\.gl|yelp|tripadvisor|yellowpages|11880|golocal|cylex|trustpilot|wikipedia|amazon|ebay|kleinanzeigen|fastbase|mobilverksteder)\./i;

function hasCriticalIdentityMismatch(signals?: string[]) {
  // A different public telephone is a contact conflict, not proof that the
  // business is different. Name + full address can still identify the same
  // merchant; preserve both numbers with their sources and assess the business.
  return Boolean(signals?.some((signal) => /地址信息不一致|官网与原始官网域名不一致/.test(signal)));
}

function websiteHost(value?: string | null) {
  try {
    return new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${value}`).hostname
      .replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Google返回网址后仍须先通过具体商家主体门槛，不能把目录或同名企业当官网。 */
export function verifiedOfficialWebsiteFromGoogle(records: ChannelRecord[]) {
  const record = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED");
  const google = record?.evidence as GooglePlaceEvidence | undefined;
  const candidate = String(google?.website || "").trim();
  const host = websiteHost(candidate);
  if (!candidate || !host || NON_OFFICIAL_WEBSITE_HOSTS.test(host)) return null;
  const confidence = Number(google?.identity_confidence || 0);
  const strongSignals = (google?.match_signals || []).filter((signal) => /名称|地址|电话|官网|域名|具体Google商家入口|Place ID/.test(signal));
  const signalText = strongSignals.join("；");
  const exactNameAndAddress = /名称/.test(signalText) && /地址/.test(signalText);
  const minimumConfidence = exactNameAndAddress ? 80 : 90;
  if (google?.identity_status !== "MATCHED" || confidence < minimumConfidence || strongSignals.length < 2 || hasCriticalIdentityMismatch(google?.mismatch_signals)) return null;
  return candidate;
}

/**
 * 官网页面自身必须再次证明它属于当前客户。
 * 客户填写的网址和Google返回的网址都只视为定位线索，不能仅因URL存在就参与分析或联系方式回写。
 */
export function websiteRecordMatchesEntity(customer: CustomerRow, records: ChannelRecord[], websiteRecord: ChannelRecord) {
  if (websiteRecord.status !== "COLLECTED" || !websiteRecord.evidence) return false;
  const googleCandidate = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  // An ambiguous or rejected Places candidate is only a search diagnostic. It
  // must never enter the model prompt as if it were the customer's business.
  // Legacy rows without an identity status remain readable, while every new
  // collector result has to be MATCHED/LIKELY_MATCHED before it can influence
  // industry, score or contacts.
  const google = googleCandidate && (!googleCandidate.identity_status
    || ["MATCHED", "LIKELY_MATCHED"].includes(String(googleCandidate.identity_status)))
    ? googleCandidate
    : undefined;
  const website = websiteRecord.evidence as WebsiteEvidence;
  const host = websiteHost(website.url);
  if (!website.reachable || !host || NON_OFFICIAL_WEBSITE_HOSTS.test(host)) return false;
  const pageText = [website.title, website.description, ...(website.structured_names || []), ...(website.structured_descriptions || []), website.text_excerpt]
    .filter(Boolean).join(" ");
  const nameSimilarity = Math.max(
    identityNameSimilarity(customer.company_name, pageText),
    identityNameSimilarity(google?.name, pageText),
  );
  const strongNameMatch = nameSimilarity >= 0.75;
  const knownPhones = [customer.phone, google?.phone]
    .map((value) => normalizePhoneInternational(value, customer.country))
    .filter(Boolean);
  const phoneMatch = website.phones.some((value) => knownPhones.includes(normalizePhoneInternational(value, customer.country)));
  const customerDomain = emailBusinessDomain(customer.email);
  const emailDomainMatch = Boolean(customerDomain && (host === customerDomain || host.endsWith(`.${customerDomain}`)));
  const googleWebsite = verifiedOfficialWebsiteFromGoogle(records);
  const exactGoogleWebsite = Boolean(googleWebsite && websiteHost(googleWebsite) === host);
  const domainNameMatch = identityNameSimilarity(customer.company_name, host.replace(/\./g, " ")) >= 0.55;
  const pageAddress = [customer.address, google?.formatted_address].filter(Boolean)
    .find((value) => addressAppearsOnPage(value, pageText));
  // 电话或企业邮箱域名属于强信号。Google具体商家已通过名称、地址、电话、
  // Place ID等多信号严格匹配时，该商家资料绑定的可访问官网本身就是权威关联，
  // 即使页面由脚本渲染而没有在首屏重复商家名称，也必须继续抓取分析。
  // 非Google绑定的原始网址仍要求页面名称和域名/地址形成交叉信号。
  return phoneMatch || emailDomainMatch || exactGoogleWebsite || (strongNameMatch && (domainNameMatch || Boolean(pageAddress)));
}

// 保留旧导出名，避免已有测试或调用方中断。
export const discoveredWebsiteMatchesEntity = websiteRecordMatchesEntity;

function compactIdentity(value?: string | null) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function identitySimilarity(left?: string | null, right?: string | null) {
  const a = new Set(compactIdentity(left).split(/\s+/).filter((item) => item.length > 1));
  const b = new Set(compactIdentity(right).split(/\s+/).filter((item) => item.length > 1));
  if (!a.size || !b.size) return 0;
  return [...a].filter((item) => b.has(item)).length / Math.max(a.size, b.size);
}

function addressAppearsOnPage(address?: string | null, pageText?: string | null) {
  const addressTokens = compactIdentity(address).split(/\s+/).filter((item) => item.length > 1);
  const pageTokens = new Set(compactIdentity(pageText).split(/\s+/).filter(Boolean));
  if (addressTokens.length < 3 || !pageTokens.size) return false;
  const significant = addressTokens.filter((item) => /\d/.test(item) || item.length >= 4);
  const exactLocator = significant.some((item) => /\d/.test(item) && pageTokens.has(item));
  const matched = significant.filter((item) => pageTokens.has(item)).length;
  return exactLocator && significant.length >= 3 && matched / significant.length >= 0.65;
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
  const websiteRecord = records.find((item) => item.channel === "website" && item.status === "COLLECTED");
  const website = websiteRecord?.evidence as WebsiteEvidence | undefined;
  const admittedWebsite = Boolean(websiteRecord && websiteRecordMatchesEntity(customer, records, websiteRecord));
  // Prefer a fully matched Google entity. If Google is only ambiguous while a
  // supplied official website was successfully read, evaluate that website
  // instead of letting the weaker Maps candidate override stronger identity
  // signals from the exact domain, email and business name.
  const googleConfidence = Number(google?.identity_confidence || 0);
  const googleMatchSignals = google?.match_signals || [];
  const googleMismatchSignals = google?.mismatch_signals || [];
  const exactGoogleSignals = googleMatchSignals.filter((signal) => /名称|电话|官网|域名|地址|具体Google商家入口|Place ID/i.test(signal)).length;
  const onlyReplaceableContactMismatches = googleMismatchSignals.length > 0
    && googleMismatchSignals.every((signal) => /电话|官网|域名|换号|分店/.test(signal));
  const normalizedGoogleStatus: IdentityStatus | null = google?.identity_status
    ? ((google.identity_status === "AMBIGUOUS" && googleConfidence >= 90 && exactGoogleSignals >= 2 && !hasCriticalIdentityMismatch(googleMismatchSignals))
      || (google.identity_status === "CONFLICTED" && googleConfidence >= 90 && exactGoogleSignals >= 3 && onlyReplaceableContactMismatches)
      ? "MATCHED"
      : google.identity_status as IdentityStatus)
    : null;
  if (normalizedGoogleStatus
      && ["MATCHED", "LIKELY_MATCHED"].includes(normalizedGoogleStatus)
      && googleConfidence >= 70
      && (googleConfidence >= 90 || !website?.reachable)) return {
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
  const recoveredIdentityRecord = records.find((record) => ["facebook", "instagram", "linkedin", "tiktok", "other"].includes(record.channel)
    && record.status === "COLLECTED" && recoveryRecordMatchesEntity(customer, records, record));
  if (recoveredIdentityRecord?.evidence) {
    const recovered = recoveredIdentityRecord.evidence as WebsiteEvidence;
    const recoveredText = [recovered.title, recovered.description, ...(recovered.structured_names || []),
      ...(recovered.structured_descriptions || []), ...(recovered.headings || []), recovered.text_excerpt].filter(Boolean).join(" ");
    const nameMatch = identityNameSimilarity(customer.company_name, recoveredText) >= 0.75;
    const originalPhone = normalizePhoneInternational(customer.phone, customer.country);
    const recoveredPhones = (recovered.phones || []).map((value) => normalizePhoneInternational(value, customer.country)).filter(Boolean);
    const phoneMatch = Boolean(originalPhone && recoveredPhones.includes(originalPhone));
    const addressMatch = addressAppearsOnPage(customer.address, recoveredText);
    if (nameMatch && (phoneMatch || addressMatch)) {
      const phoneConflict = Boolean(originalPhone && recoveredPhones.length && !phoneMatch);
      return {
        status: "MATCHED" as const,
        confidence: phoneMatch && addressMatch ? 98 : 92,
        verifiedBusinessName: recovered.title || customer.company_name,
        verifiedAddress: addressMatch ? customer.address : null,
        verifiedWebsite: null,
        verifiedGoogleMapsUrl: records.find((record) => record.channel === "google_maps")?.source_url || customer.google_url,
        placeId: null,
        candidateCount: 1,
        matchSignals: ["补充公开来源中的企业名称一致", phoneMatch ? "补充公开来源中的电话一致" : "", addressMatch ? "补充公开来源中的完整地址一致" : ""].filter(Boolean),
        mismatchSignals: phoneConflict ? ["补充公开来源电话与原始电话不同，可能是换号或历史号码；未自动覆盖原始电话"] : [],
      };
    }
  }
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
  const originalPhone = normalizePhoneInternational(customer.phone, customer.country);
  const phoneMatch = Boolean(originalPhone && website.phones.some((item) => normalizePhoneInternational(item, customer.country) === originalPhone));
  const emailDomain = normalizeEmail(customer.email).split("@")[1] || "";
  let websiteDomain = ""; try { websiteDomain = new URL(website.url).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  const customerWebsite = effectiveWebsite(customer);
  let inputWebsiteDomain = ""; try { inputWebsiteDomain = new URL(/^https?:\/\//i.test(String(customerWebsite || "")) ? String(customerWebsite) : `https://${customerWebsite}`).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  const providedDomainMatch = Boolean(inputWebsiteDomain && websiteDomain && inputWebsiteDomain === websiteDomain);
  const emailMatch = Boolean(emailDomain && websiteDomain && (emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`)));
  const addressMatch = addressAppearsOnPage(customer.address, pageText);
  // The exact domain of a non-personal company mailbox is a strong identity
  // signal for imported branch records whose display name may only be a mall or
  // district name. It verifies the company, but still does not prove industry.
  // An exact normalized public phone uniquely ties the page to the customer in
  // the same way the website admission gate already does. It must not be
  // weakened merely because the brand is translated, reordered or spelled
  // differently in the page title (for example Smartphone Doctor / Smartfon
  // Doctor). Domain and name remain corroborating signals when phone is absent.
  const score = Math.min(100, Math.max(phoneMatch ? 90 : 0, admittedWebsite ? 80 : 0, providedDomainMatch ? 75 : 0, nameScore + (providedDomainMatch ? 30 : 0) + (phoneMatch ? 25 : 0) + (emailMatch ? 50 : 0) + (addressMatch ? 20 : 0)));
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

export function prioritizeGoogleReviews(reviews: string[]) {
  return [...new Set((reviews || []).map((review) => String(review || "").replace(/\s+/g, " ").trim()).filter(Boolean))]
    .map((review, index) => ({
      review,
      index,
      score: verifiedFactLabels(review).length * 20
        + (/(?:repair|fix|replace|screen|battery|charging|motherboard|parts?|accessor|napraw|serwis|repar|维修|修理|更换|屏幕|电池|充电口|主板|配件)/i.test(review) ? 8 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.review);
}

const NON_TARGET_FACT_LABEL = /IT系统|软件开发|云服务|网络托管|运营商|通信合约|通信套餐|固定电话|互联网|宽带|MagentaTV|电视服务|电信合作伙伴|铁路|电气|食品|药房|药店|药剂师|疫苗接种|电子烟|烟草|水烟|拍卖|破产清算|资产处置/;

function recordBusinessText(record?: ChannelRecord) {
  if (!record?.evidence) return "";
  if (record.channel === "google_maps") {
    const item = record.evidence as GooglePlaceEvidence;
    // 商家名称和Google分类只用于主体定位；这里只使用商家描述和评论，
    // 避免把名称中的 Repair/Serwis 或单一平台分类误当成经营事实。
    return [item.description, ...(item.reviews || [])].filter(Boolean).join("；");
  }
  const item = record.evidence as WebsiteEvidence;
  if (record.channel === "other") {
    // A directory's flattened body is not listing-scoped and may contain
    // nearby merchants or generic articles. Keep normalization on the same
    // strict metadata boundary used by deterministic analysis.
    return [item.title, item.description, ...(item.structured_types || [])]
      .filter(Boolean).join("；");
  }
  return [item.description, ...(item.structured_descriptions || []), ...(item.headings || []), item.text_excerpt]
    .filter(Boolean).join("；");
}

/**
 * The model occasionally labels a direct source fact as "neutral". Reconcile
 * that label against the source-language excerpt before the evidence gate runs.
 * This never promotes a company name, import tag, or Google category alone.
 */
export function normalizeAnalysisEvidence(analysis: CustomerAnalysis, records: ChannelRecord[]): CustomerAnalysis {
  const expandedEvidence = analysis.evidence_summaries.flatMap((summary) => {
    const channelRecords = records.filter((record) => record.channel === summary.channel && record.status === "COLLECTED");
    // A source may be collected through a broad Maps/search URL and later be
    // canonicalized to the concrete place URL returned by Google. Do not lose
    // the business description merely because those two audit URLs differ.
    const source = channelRecords.find((record) => !record.source_url || !summary.source_url || record.source_url === summary.source_url)
      || channelRecords[0];
    const originalExcerpt = [...new Set([summary.original_excerpt, recordBusinessText(source)].map((item) => String(item || "").trim()).filter(Boolean))]
      .join("；").slice(0, 4000);
    const labels = [...new Set(verifiedFactLabels(originalExcerpt))];
    // One source page is one auditable evidence record. Its distinct business
    // facts are compacted into that record instead of repeating the same page,
    // excerpt and generic wording as many separate rows.
    if (labels.length) return [{
      ...summary,
      title_zh: `${summary.channel === "google_maps" ? "Google商家页" : summary.channel === "website" ? "企业官网" : AI_CHANNEL_LABELS[summary.channel as AiChannel] || "公开渠道"}已核验经营事实`,
      fact_zh: `已核验经营内容：${labels.slice(0, 10).join("、")}。`,
      evidence_type: labels.every((label) => NON_TARGET_FACT_LABEL.test(label)) ? "矛盾" as const : "支持" as const,
      confidence: Math.max(70, summary.confidence),
      original_excerpt: originalExcerpt,
    }];
    return { ...summary, original_excerpt: originalExcerpt || summary.original_excerpt };
  });
  const seen = new Set<string>();
  const evidenceSummaries = expandedEvidence.filter((item) => {
    const key = `${item.channel}|${item.source_url}|${item.fact_zh}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...analysis,
    evidence_sufficiency: analysis.evidence_sufficiency === "不足" ? "一般" : analysis.evidence_sufficiency,
    evidence_summaries: evidenceSummaries,
  };
}

function canonicalSourceUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.hash = "";
    url.search = "";
    return `${url.origin}${url.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function recordSourceUrls(record: ChannelRecord) {
  const urls: Array<string | null | undefined> = [record.source_url];
  if (record.evidence && "url" in record.evidence) {
    urls.push(record.evidence.url);
    urls.push(...(record.evidence.pages || []).map((page) => page.url));
  }
  if (record.evidence && "verified_google_maps_url" in record.evidence) {
    // The website value returned by Places is only a locator until that site
    // has been fetched and admitted as a separate website record. Do not let a
    // model cite that URL as if website content had already been inspected.
    urls.push(record.evidence.verified_google_maps_url);
  }
  return urls.filter((value): value is string => Boolean(value && /^https?:\/\//i.test(value)));
}

function sourceUrlMatchesRecord(sourceUrl: string, record: ChannelRecord) {
  const normalizedSource = canonicalSourceUrl(sourceUrl);
  if (!normalizedSource) return false;
  const sourceHost = websiteHost(sourceUrl);
  return recordSourceUrls(record).some((candidate) => {
    if (canonicalSourceUrl(candidate) === normalizedSource) return true;
    // Deep official pages legitimately have a different path from the fetched
    // root. A host-only match is safe for the per-customer website record, but
    // not for Google or social hosts that contain unrelated places/profiles.
    return record.channel === "website" && sourceHost && sourceHost === websiteHost(candidate);
  });
}

/**
 * Recover evidence provenance from collected records rather than trusting a
 * free-form model label. This runs before normalization and the policy gate,
 * preventing direct official-site facts from being treated as weak hints.
 */
export function canonicalizeAnalysisEvidenceChannels(
  customer: CustomerRow,
  records: ChannelRecord[],
  analysis: CustomerAnalysis,
): CustomerAnalysis {
  const collected = records.filter((record) => record.status === "COLLECTED" && record.evidence);
  const officialHost = websiteHost(effectiveWebsite(customer));
  return {
    ...analysis,
    evidence_summaries: analysis.evidence_summaries.map((summary) => {
      const matchingRecord = collected.find((record) => sourceUrlMatchesRecord(summary.source_url, record));
      if (matchingRecord) return { ...summary, channel: matchingRecord.channel };

      const summaryHost = websiteHost(summary.source_url);
      const admittedWebsite = collected.find((record) => record.channel === "website"
        && websiteRecordMatchesEntity(customer, records, record));
      if (officialHost && summaryHost === officialHost && admittedWebsite) {
        return { ...summary, channel: "website" as const };
      }

      // A syntactically valid model label is still not provenance. If the URL
      // cannot be tied back to a collected record, retain it only as an "other"
      // hint; the downstream URL allowlist may remove it altogether.
      return { ...summary, channel: "other" as const };
    }),
  };
}

/**
 * Evidence normalization can recover concrete business facts that the first
 * model/rule pass described too generically. Re-ground the complete conclusion
 * before the policy gate so industry, score, grade and target status cannot
 * contradict those recovered facts.
 */
export function finalizeAnalysisAgainstEvidence(customer: CustomerRow, records: ChannelRecord[], analysis: CustomerAnalysis): CustomerAnalysis {
  const canonical = canonicalizeAnalysisEvidenceChannels(customer, records, analysis);
  const normalized = normalizeAnalysisEvidence(canonical, records);
  const { usage, ...withoutUsage } = normalized;
  const grounded = groundCustomerAnalysis({
    customer_name: customer.company_name,
    country: customer.country,
    phone: customer.phone,
    email: customer.email,
    whatsapp: customer.whatsapp,
    website: effectiveWebsite(customer),
    google_url: customer.google_url,
    address: customer.address,
    industry_keywords: null,
    evidence: evidenceForModel(records, "escalation"),
  }, withoutUsage, records.flatMap((record) => {
    const urls = [record.source_url];
    if (record.evidence && "url" in record.evidence) urls.push(record.evidence.url);
    if (record.evidence && "verified_google_maps_url" in record.evidence) urls.push(record.evidence.verified_google_maps_url);
    return urls.filter((value): value is string => Boolean(value && /^https?:\/\//i.test(value)));
  }));
  return { ...grounded, usage };
}

const VERIFIED_TARGET_INDUSTRY = /^(?:手机维修店|Apple或MacBook维修店|电脑维修店|手机外配件零售|维修内配件零售|维修内配件批发|进口商或分销商|维修连锁|电商卖家|其他维修行业|混合经营)$/;

function rejectedConclusionScore(
  analysis: CustomerAnalysis,
  identityConfidence: number,
  permanentlyClosed = false,
) {
  const metric = (key: keyof CustomerAnalysis["score_breakdown"]) => Math.max(0, Math.min(100, Number(analysis.score_breakdown?.[key]) || 0));
  const directTargetFacts = analysis.evidence_summaries.filter((item) => item.evidence_type === "支持"
    && item.confidence >= 60 && hasDirectTargetBusinessEvidence(item.fact_zh)).length;
  const directRejectFacts = analysis.evidence_summaries.filter((item) => item.evidence_type === "矛盾"
    && item.confidence >= 60 && isDirectNonTargetBusinessEvidence(item.fact_zh)).length;
  const targetFit = Math.max(metric("mobile_parts_match"), metric("macbook_parts_match"), metric("repair_business_match"), metric("wholesale_import_distribution"));
  const observedValue = 6
    + targetFit * (directTargetFacts ? 0.18 : 0.04)
    + metric("business_activity") * 0.07
    + metric("company_authenticity") * 0.06
    + metric("contactability") * 0.04
    + metric("evidence_completeness") * 0.05
    + Math.max(0, Math.min(100, identityConfidence)) * 0.08
    - metric("contradiction_risk") * 0.08
    - directRejectFacts * 4
    - (permanentlyClosed ? 12 : 0);
  // INVALID must remain below the 60-point business threshold, but unlike the
  // previous 20/39/52/59 assignments this value is derived from the observed
  // evidence dimensions and therefore does not manufacture a boundary pile.
  return Math.max(0, Math.min(59, Math.round(observedValue)));
}

/**
 * A page belonging to an unresolved Google/search candidate may describe a
 * real repair business, but those facts cannot be published as this
 * customer's verified industry until the entity is attributable. Keep the
 * candidate evidence for audit while making the displayed industry, score and
 * target decision one consistent conclusion.
 */
export function reconcileRejectedTargetIndustry(
  analysis: CustomerAnalysis,
  reason: string,
  permanentlyClosed = false,
): CustomerAnalysis {
  if (!VERIFIED_TARGET_INDUSTRY.test(analysis.industry_type)) return analysis;
  // 营业状态不是所属行业；永久关闭只记录在结论与冲突中。
  const industryType: CustomerAnalysis["industry_type"] = "其他";
  const score = rejectedConclusionScore(analysis, Number(analysis.score_breakdown?.entity_consistency || analysis.confidence_score || 0), permanentlyClosed);
  const verificationNote = permanentlyClosed
    ? "已匹配主体的Google商家页显示永久关闭，且没有已确认的当前官网经营事实能够证明仍在营业。"
    : `候选公开页面虽包含目标业务事实，但${reason}；该事实不能归属于当前客户。`;
  return {
    ...analysis,
    industry_type: industryType,
    ai_score: score,
    ai_level: scoreToLevel(score),
    is_target_customer: false,
    ai_reason: `${verificationNote} 系统保留候选来源供核对，但不将其发布为当前客户的AI核验行业。`,
    business_relevance: verificationNote,
    customer_value: "当前没有可安全归属于该客户的目标业务证据，不进入有效目标客户名单。",
    evidence_conflicts: [...new Set([...analysis.evidence_conflicts, `重点核对：${verificationNote}`])],
  };
}

export function reconcileFinalDecision(
  analysis: CustomerAnalysis,
  automationStatus: AutomationStatus,
  reason: string,
  permanentlyClosed = false,
) {
  return automationStatus === "AUTO_REJECT"
    ? reconcileRejectedTargetIndustry(analysis, reason, permanentlyClosed)
    : analysis;
}

function contactTypeForUrl(value?: string | null): ContactType {
  const url = String(value || "").toLowerCase();
  if (/google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(url)) return "GOOGLE_MAPS";
  if (/facebook\.com/.test(url)) return "FACEBOOK";
  if (/instagram\.com/.test(url)) return "INSTAGRAM";
  if (/linkedin\.com/.test(url)) return "LINKEDIN";
  if (/tiktok\.com/.test(url)) return "TIKTOK";
  if (/youtube\.com|youtu\.be/.test(url)) return "YOUTUBE";
  if (/wa\.me|whatsapp\.com/.test(url)) return "WHATSAPP";
  return "WEBSITE";
}

function aiChannelForPublicUrl(value?: string | null): AiChannel | null {
  const url = String(value || "").toLowerCase();
  if (/linkedin\.com/.test(url)) return "linkedin";
  if (/facebook\.com/.test(url)) return "facebook";
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  return null;
}

/**
 * Public profiles discovered by a verified Google entity or verified official
 * website belong in the current task's evidence queue. They remain social
 * sources (never official websites), and are ignored when the parent entity is
 * ambiguous or conflicted.
 */
export function discoveredPublicChannelUrls(customer: CustomerRow, records: ChannelRecord[]) {
  const discovered: Partial<Record<AiChannel, string>> = {};
  const add = (value?: string | null) => {
    const channel = aiChannelForPublicUrl(value);
    if (channel && value && !discovered[channel]) discovered[channel] = value;
  };

  const googleRecord = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED");
  const google = googleRecord?.evidence as GooglePlaceEvidence | undefined;
  const googleStrongSignals = (google?.match_signals || []).filter((signal) => /名称|电话|官网|域名|地址|具体Google商家入口|Place ID/.test(signal));
  const googleSignalText = googleStrongSignals.join("；");
  const googleExactNameAndAddress = /名称/.test(googleSignalText) && /地址/.test(googleSignalText);
  const googleEntityVerified = Boolean(
    google
    && ["MATCHED", "LIKELY_MATCHED"].includes(String(google.identity_status || ""))
    && Number(google.identity_confidence || 0) >= (googleExactNameAndAddress ? 80 : 85)
    && googleStrongSignals.length >= 2
    && !hasCriticalIdentityMismatch(google.mismatch_signals),
  );
  if (googleEntityVerified) add(google?.website);

  for (const record of records) {
    if (record.channel !== "website" || record.status !== "COLLECTED" || !record.evidence) continue;
    if (!websiteRecordMatchesEntity(customer, records, record)) continue;
    const website = record.evidence as WebsiteEvidence;
    for (const value of website.social_urls || []) add(value);
    for (const page of website.pages || []) for (const value of page.social_urls || []) add(value);
  }
  return discovered;
}

function customerWithDiscoveredPublicChannels(customer: CustomerRow, records: ChannelRecord[]): CustomerRow {
  const urls = discoveredPublicChannelUrls(customer, records);
  return {
    ...customer,
    linkedin_url: customer.linkedin_url || urls.linkedin || null,
    facebook_url: customer.facebook_url || urls.facebook || null,
    instagram_url: customer.instagram_url || urls.instagram || null,
    tiktok_url: customer.tiktok_url || urls.tiktok || null,
  };
}

function originalValuesForType(customer: CustomerRow, type: ContactType) {
  if (type === "EMAIL") return splitContacts(customer.email);
  // Phone and WhatsApp are the same numbering namespace. A number already
  // present in either original field is a match, not an AI-discovered contact.
  if (type === "PHONE" || type === "WHATSAPP") return [
    ...splitContacts(customer.phone),
    ...splitContacts(customer.whatsapp),
  ];
  if (type === "FACEBOOK") return splitContacts(customer.facebook_url);
  if (type === "INSTAGRAM") return splitContacts(customer.instagram_url);
  if (type === "LINKEDIN") return splitContacts(customer.linkedin_url);
  if (type === "TIKTOK") return splitContacts(customer.tiktok_url);
  if (type === "WEBSITE") return splitContacts(customer.website);
  if (type === "GOOGLE_MAPS") return splitContacts(customer.google_url);
  if (type === "YOUTUBE") return [];
  return [
    ...(customer.other_public_urls || []),
  ];
}

export function contactCandidatesFromRecords(customer: CustomerRow, records: ChannelRecord[], identityStatus: IdentityStatus) {
  const candidates: ContactCandidate[] = [];
  const add = (type: ContactType, value: string, channel: string, url: string, title?: string | null, candidateIdentity = identityStatus, contactConflict = false, contactStatus?: string) => {
    if (type === "EMAIL") {
      const domain = normalizeEmailStrict(value).split("@").at(-1) || "";
      const host = websiteHost(url);
      const sameBusinessDomain = Boolean(domain && host && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)));
      if (domain && !PERSONAL_EMAIL_DOMAINS.has(domain) && !sameBusinessDomain) return;
    }
    const candidate = buildContactCandidate({ type, value, country: customer.country, sourceChannel: channel, sourceUrl: url, sourcePageTitle: title, identityStatus: candidateIdentity, originalValues: originalValuesForType(customer, type), contactConflict, contactStatus });
    if (candidate) candidates.push(candidate);
  };
  for (const record of records) {
    if (record.status !== "COLLECTED" || !record.evidence) continue;
    if (record.channel === "google_maps") {
      const item = record.evidence as GooglePlaceEvidence;
      const url = item.verified_google_maps_url || record.source_url || customer.google_url || "";
      const strongSignals = (item.match_signals || []).filter((signal) => /名称|电话|官网|域名|地址|具体Google商家入口|Place ID/.test(signal));
      const signalText = strongSignals.join("；");
      const exactNameAndAddress = /名称/.test(signalText) && /地址/.test(signalText);
      const googleIdentity: IdentityStatus = item.identity_status === "MATCHED"
        && Number(item.identity_confidence || 0) >= (exactNameAndAddress ? 80 : 90)
        && strongSignals.length >= 2
        && !hasCriticalIdentityMismatch(item.mismatch_signals)
        ? "MATCHED"
        : "AMBIGUOUS";
      const phoneConflict = Boolean(item.mismatch_signals?.some((signal) => /电话.*不一致/.test(signal)));
      if (item.phone) add("PHONE", item.phone, "google_maps", url, item.name, googleIdentity, phoneConflict);
      for (const email of item.emails || []) add("EMAIL", email, "google_maps", url, item.name, googleIdentity);
      if (url) add("GOOGLE_MAPS", url, "google_maps", url, item.name, googleIdentity);
      if (item.website) add(contactTypeForUrl(item.website), item.website, "google_maps", url, item.name, googleIdentity);
      continue;
    }
    const item = record.evidence as WebsiteEvidence;
    const recordIdentity: IdentityStatus = websiteRecordMatchesEntity(customer, records, record)
      || recoveryRecordMatchesEntity(customer, records, record)
      ? "MATCHED"
      : "AMBIGUOUS";
    const childPages = (item.pages || []).map((page) => ({ ...page, whatsapps: page.whatsapps || [], social_urls: page.social_urls || [] }));
    const childValues = {
      emails: new Set(childPages.flatMap((page) => page.emails || []).map((value) => normalizeEmailStrict(value))),
      phones: new Set(childPages.flatMap((page) => page.phones || []).map((value) => normalizePhoneInternational(value, customer.country))),
      whatsapps: new Set(childPages.flatMap((page) => page.whatsapps || []).map((value) => normalizePhoneInternational(value, customer.country))),
      socials: new Set(childPages.flatMap((page) => page.social_urls || [])),
    };
    // Deep collection keeps aggregate values on the root evidence for analysis.
    // Contact writeback must instead retain the exact child page where a value
    // was observed; otherwise a branch/contact-page value is falsely attributed
    // to the home page and cannot be audited.
    const pages = [
      ...childPages.sort((a, b) => Number(/contact|kontakt|contatt|contacto|contato|impressum|联系/i.test(`${b.url} ${b.title || ""}`)) - Number(/contact|kontakt|contatt|contacto|contato|impressum|联系/i.test(`${a.url} ${a.title || ""}`))),
      {
        url: item.url, title: item.title,
        emails: (item.emails || []).filter((value) => !childValues.emails.has(normalizeEmailStrict(value))),
        phones: (item.phones || []).filter((value) => !childValues.phones.has(normalizePhoneInternational(value, customer.country))),
        whatsapps: (item.whatsapps || []).filter((value) => !childValues.whatsapps.has(normalizePhoneInternational(value, customer.country))),
        social_urls: (item.social_urls || []).filter((value) => !childValues.socials.has(value)),
      },
    ];
    if (record.channel === "website" && item.url) add("WEBSITE", item.url, "website", item.url, item.title, recordIdentity);
    for (const page of pages) {
      for (const email of page.emails || []) add("EMAIL", email, record.channel, page.url, page.title, recordIdentity);
      for (const phone of page.phones || []) add("PHONE", phone, record.channel, page.url, page.title, recordIdentity);
      for (const whatsapp of page.whatsapps || []) add("WHATSAPP", whatsapp, record.channel, page.url, page.title, recordIdentity);
      for (const socialUrl of page.social_urls || []) add(contactTypeForUrl(socialUrl), socialUrl, record.channel, page.url, page.title, recordIdentity);
    }
    if (["facebook", "instagram", "linkedin", "tiktok"].includes(record.channel) && record.source_url) {
      add(contactTypeForUrl(record.source_url), record.source_url, record.channel, record.source_url, item.title, recordIdentity);
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
  const originals = new Set(originalValuesForType(customer, type).map(normalized).filter(Boolean));
  for (const raw of existing) {
    const key = normalized(raw);
    if (key && !originals.has(key) && !unique.has(key)) unique.set(key, raw);
  }
  for (const contact of contacts) {
    if (contact.type !== type || !["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(contact.verificationStatus)
      || ["SHARED_CORPORATE", "SHARED_ACROSS_CUSTOMERS"].includes(contact.contactStatus)) continue;
    // When the entity is confirmed by a highly similar name plus the exact
    // address, a different public phone is a verified replacement candidate,
    // not a reason to discard the contact. Keep the imported number in its
    // original field and append the public number to discovered contacts so
    // sales can see both values and the source instead of silently overwriting.
    if (!originals.has(contact.valueNormalized) && !unique.has(contact.valueNormalized)) unique.set(contact.valueNormalized, contact.valueRaw);
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
  const pageRelevance = (page: NonNullable<WebsiteEvidence["pages"]>[number]) => {
    const value = [page.url, page.title, page.description, ...(page.headings || [])].join(" ");
    return /(?:repair|service|product|parts?|wholesale|about|contact|location|branch|repar|serwis|napraw|维修|配件|产品|服务|关于|联系|分店)/i.test(value) ? 1 : 0;
  };
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
    pages: [...(item.pages || [])]
      .sort((left, right) => pageRelevance(right) - pageRelevance(left))
      .slice(0, deep ? 3 : 2)
      .map((page) => withoutEmpty({
      url: page.url,
      title: page.title,
      description: page.description?.slice(0, 240),
      headings: (page.headings || []).slice(0, 3),
      text_excerpt: page.text_excerpt?.slice(0, deep ? 360 : 180),
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
    const publicEvidence = item.evidence as WebsiteEvidence;
    publicChannels[item.channel] = compactWebsite(item.channel === "other" ? {
      ...publicEvidence,
      // Keep model synthesis on listing-scoped metadata. Directory body/pages
      // may describe nearby businesses or generic SEO articles and must not be
      // attributed to this customer merely because the listing itself matched.
      structured_descriptions: [],
      headings: [],
      text_excerpt: "",
      pages: [],
    } : publicEvidence);
  }
  const googleCandidate = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  const google = googleCandidate && (!googleCandidate.identity_status
    || ["MATCHED", "LIKELY_MATCHED"].includes(String(googleCandidate.identity_status)))
    ? googleCandidate
    : undefined;
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
      // Places returns at most five reviews. Keep all five, rank concrete
      // repair/component comments first and cap each excerpt so review analysis
      // is complete without materially inflating model tokens.
      reviews: prioritizeGoogleReviews(google.reviews || []).slice(0, 5).map((review) => review.slice(0, deep ? 220 : 180)),
      description: google.description?.slice(0, deep ? 800 : 520),
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

export function hasUsableCollectedEvidence(records: ChannelRecord[]) {
  return records.some((record) => {
    if (record.status !== "COLLECTED" || !record.evidence) return false;
    if (record.channel === "google_maps") {
      const item = record.evidence as GooglePlaceEvidence;
      return Boolean(hasVerifiedGoogleBusinessCategory(item)
        || (item.identity_status && ["MATCHED", "LIKELY_MATCHED"].includes(String(item.identity_status))
          && (item.description?.trim() || item.reviews?.some((review) => review.trim()) || item.image_urls?.length)));
    }
    const item = record.evidence as WebsiteEvidence;
    return Boolean(item.reachable && (item.description?.trim() || item.structured_descriptions?.some((value) => value.trim()) || item.headings?.some((value) => value.trim()) || item.text_excerpt?.trim()));
  });
}

const SPECIFIC_GOOGLE_BUSINESS_CATEGORY = /(?:mobile phone repair|cell phone repair|phone repair service|computer repair|laptop repair|electronics repair|screen repair|mobile phone accessory|cell phone accessory|repair parts? wholesal|维修店|维修服务|电脑维修|手机配件)/i;

function googleCategoryText(item: GooglePlaceEvidence) {
  return (item.types || []).map((value) => String(value).replace(/_/g, " ")).join("；");
}

export function hasVerifiedGoogleBusinessCategory(item: GooglePlaceEvidence) {
  if (item.identity_status !== "MATCHED") return false;
  const signals = (item.match_signals || []).join("；");
  const corroboratedIdentity = /(?:地址|电话|官网|place.?id|address|phone|website|domain)/i.test(signals);
  const exactNameAndAddress = /名称/.test(signals) && /地址/.test(signals);
  const minimumConfidence = exactNameAndAddress ? 80 : 90;
  return Number(item.identity_confidence || 0) >= minimumConfidence
    && corroboratedIdentity
    && !hasCriticalIdentityMismatch(item.mismatch_signals)
    && SPECIFIC_GOOGLE_BUSINESS_CATEGORY.test(googleCategoryText(item));
}

const RULE_INDUSTRIES: Array<{ pattern: RegExp; industry: CustomerAnalysis["industry_type"]; baseScore: number; target: boolean }> = [
  { pattern: /(?:apple device repair|iphone repair|macbook repair|apple repair|pogwarancyjny serwis apple|serwis(?:u|em)? (?:sprz[eę]tu |urz[aą]dze[nń] )?(?:apple|iphone|ipad|macbook)|napraw(?:a|y|ie) (?:urz[aą]dze[nń] )?(?:apple|iphone|ipad|macbook)|reparaci[oó]n (?:de )?(?:iphone|ipad|macbook|dispositivos apple)|r[eé]paration (?:d['’])?(?:iphone|ipad|macbook|appareils apple)|riparazione (?:iphone|ipad|macbook|dispositivi apple)|repara[cç][aã]o (?:de )?(?:iphone|ipad|macbook|dispositivos apple))/i, industry: "Apple或MacBook维修店", baseScore: 56, target: true },
  { pattern: /(?:mobile[_ ]phone[_ ]repair|cell[_ ]phone[_ ]repair|phone[_ ]repair|smartphone[_ ]repair|mobil(?:e|telefon)?\s*reparasjon|reparasjon(?:er)?\s+(?:av\s+)?(?:mobil|telefon|smarttelefon)|(?:reparerer?|fikser)\s+(?:vi\s+)?(?:mobil|telefon|smarttelefon)|(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)[\s\S]{0,80}(?:phones?|mobile|smartphones?|iphones?|ipads?|tablets?)|(?:phones?|mobile|smartphones?|iphones?|ipads?|tablets?)[\s\S]{0,80}(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)|reparaci[oó]n (?:de )?(?:tel[eé]fonos m[oó]viles|m[oó]viles|celulares)|repara[cç][aã]o (?:de )?(?:telem[oó]veis|celulares|smartphones)|r[eé]paration de t[eé]l[eé]phones|handyreparatur|serwis(?:u|em)? (?:telefon[oó]w|gsm|smartfon[oó]w)|napraw(?:a|y|ie) (?:telefon[oó]w|smartfon[oó]w)|手机维修店|手机维修服务|维修手机|手机维修)/i, industry: "手机维修店", baseScore: 52, target: true },
  { pattern: /(?:computer repair|pc repair|pc mechanic|laptop repair|(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)[\s\S]{0,80}(?:computers?|laptops?|notebooks?|macbooks?|PCs?)|(?:computers?|laptops?|notebooks?|macbooks?|PCs?)[\s\S]{0,80}(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)|(?:laptop|notebook)[\s\S]{0,60}(?:hinge|screen|keyboard|battery)[\s\S]{0,40}(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)|reparaci[oó]n (?:de )?(?:ordenadores|computadoras)|r[eé]paration (?:d['’]ordinateur|informatique)|computerreparatur|serwis (?:komputer[oó]w|laptop[oó]w)|naprawa (?:komputer[oó]w|laptop[oó]w)|电脑维修|计算机维修|电脑硬件维修)/i, industry: "电脑维修店", baseScore: 50, target: true },
  { pattern: /(?:electronics? repairs?|repair(?:ed|s|ing)?[\s\S]{0,50}electronic devices?|electrical repairs?|electronic device repairs?|tv repairs?|television repairs?|turntable repairs?|audio equipment repairs?|game(?:s)? console repairs?|console repairs?|xbox[\s\S]{0,40}repair|playstation[\s\S]{0,40}repair|ps[345][\s\S]{0,40}repair|电子设备维修|电子产品维修|电视维修|音响维修|游戏机维修)/i, industry: "其他维修行业", baseScore: 48, target: true },
  { pattern: /(?:wholesale|wholesaler|distributor|distribution|importer|b2b|bulk order|trade account|hurtownia|sprzedaż hurtowa|dystrybutor|批发|分销|进口商)/i, industry: "进口商或分销商", baseScore: 70, target: true },
  { pattern: /(?:mobile phone accessories|cell phone accessories|phone accessories|akcesoria (?:do )?(?:telefon[oó]w|gsm)|phone covers?|screen protectors?|protective films?|privacy films?|power ?banks?|phone car holders?|chargers?|earbuds?|headphones?|tablets?|手机配件商店|手机配件|手机壳|保护膜|移动电源|车载手机支架|充电器|耳机|平板电脑)/i, industry: "手机外配件零售", baseScore: 45, target: true },
  { pattern: /(?:cell[_ ]phone[_ ]store|mobile[_ ]phone[_ ]store|mobile[_ ]phone[_ ]shop|phone shop|smartphone shop|handyshop|手机店|手机成品零售)/i, industry: "手机成品零售", baseScore: 26, target: false },
  { pattern: /(?:software development|software company|it consult(?:ing|ancy)|web hosting|data protection|cyber ?security|cloud services|computer services?|computer technical support|IT support|technical support|managed IT|managed services|network (?:setup|configuration|maintenance|management|support)|NAS (?:setup|configuration|maintenance|support)|server (?:setup|configuration|maintenance|support)|system (?:setup|configuration|maintenance|troubleshooting)|IT[- ]service|Netzwerk(?:service|betreuung)|Systembetreuung|wsparcie IT|konfiguracja sieci|软件开发|软件公司|IT咨询|计算机服务|计算机技术支持|电脑技术支持|IT系统|网络(?:设置|配置|维护|管理|支持)|NAS(?:设置|配置|维护|支持)|服务器(?:设置|配置|维护|支持)|系统(?:设置|配置|维护|故障排除)|网络托管|数据保护|信息安全)/i, industry: "软件或IT服务", baseScore: 18, target: false },
  { pattern: /(?:mobile network operator|telecommunications service provider|sim card|mobile plan|mobile contract|phone contract|telekom partner|telekommunikationspartner|mobilfunk(?:vertrag|tarif)|handyvertr[aä]g|festnetz|magenta\s*tv|internet(?:vertrag|tarif)|运营商营业厅|手机套餐|电信运营商|通信合约|宽带套餐)/i, industry: "运营商营业厅", baseScore: 22, target: false },
  { pattern: /(?:railway engineering|rail safety|railway safety|electrical installation|electrical safety|industrial electrical|铁路工程|铁路安全|电气安装|电气安全|工业电气)/i, industry: "铁路或电气工程", baseScore: 15, target: false },
  { pattern: /(?:food wholesale|food distributor|vegetable wholesale|fruit wholesale|食品批发|蔬菜批发|水果批发|餐饮供应)/i, industry: "食品批发或餐饮供应", baseScore: 10, target: false },
  { pattern: /(?:tobacco shop|tobacconist|vape shop|vaping store|e[- ]?cigarette|smoke shop|shisha shop|电子烟|烟草店|水烟店)/i, industry: "电子烟或烟草零售", baseScore: 8, target: false },
  { pattern: /(?:insolvency auction|liquidation auction|auction house|auction calendar|versteigerungskalender|insolvenzverfahren|拍卖行|破产拍卖|清算拍卖)/i, industry: "拍卖或资产处置", baseScore: 8, target: false },
  { pattern: /(?:pharmacy|pharmacist|drugstore|apotheke|apteka|farmacia|药房|药店|药剂师|疫苗接种)/i, industry: "药房或医疗零售", baseScore: 9, target: false },
];

const PRODUCT_RELEVANCE_PATTERN = /(?:mobile|phone|cellular|smartphone|iphone|ipad|macbook|computer|laptop|gsm|lcd|oled|screen|battery|repair parts?|spare parts?|accessor(?:y|ies)|telefon|komputer|smartfon|手机|电脑|屏幕|电池|配件|维修件)/i;
const TELECOM_SERVICE_PATTERN = /(?:mobile contract|phone contract|telekom partner|telekommunikationspartner|mobilfunk(?:vertrag|tarif)|handyvertr[aä]g|festnetz|magenta\s*tv|internet(?:vertrag|tarif)|sim card|mobile plan|通信合约|宽带套餐|手机套餐|运营商)/i;
const EXPLICIT_DEVICE_REPAIR_PATTERN = /(?:phone repair|mobile repair|smartphone repair|iphone repair|computer repair|laptop repair|(?:phone|mobile|computer|laptop|notebook|macbook|pc)[\s\S]{0,80}(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)|mobil(?:telefon)?\s*reparasjon|reparasjon(?:er)?\s+(?:av\s+)?(?:mobil|telefon|smarttelefon)|handyreparatur|computerreparatur|napraw\w* (?:telefon|smartfon|komputer|laptop)|serwis\w* (?:telefon|gsm|smartfon|komputer|laptop)|reparaci[oó]n (?:de )?(?:tel[eé]fonos|m[oó]viles|celulares|ordenadores|computadoras)|repara[cç][aã]o (?:de )?(?:telem[oó]veis|celulares|smartphones|computadores)|手机维修|电脑维修|换屏|电池更换|充电口|主板维修)/i;

function googleContextualReviewEvidence(item: GooglePlaceEvidence) {
  const reviews = (item.reviews || []).join("；");
  const verifiedContext: string[] = [];
  if (["MATCHED", "LIKELY_MATCHED"].includes(String(item.identity_status))
      && Number(item.identity_confidence || 0) >= 70
      && !hasCriticalIdentityMismatch(item.mismatch_signals)) {
    const businessName = String(item.name || "");
    const mobileName = /(?:phone|mobile|smartphone|smartfon|telefon|gsm|iphone|手机)/i.test(businessName);
    const repairReview = /(?:repair|repaired|fix|fixed|(?:screen|display|glass|battery)(?:\s+was)?\s+(?:replacement|replaced|changed|fixed)|napraw|serwis|repar|维修|修理|更换)/i.test(reviews);
    const independentlyAnchored = /(?:地址|电话|官网|具体Google|place.?id|address|phone|website|domain)/i.test((item.match_signals || []).join("；"));
    const explicitNamedTargetBusiness = independentlyAnchored
      && String(item.business_status || "OPERATIONAL") === "OPERATIONAL"
      && RULE_INDUSTRIES.some((rule) => rule.target && rule.industry !== "进口商或分销商" && ruleIsSupported(rule, businessName));
    // The raw customer name remains a routing hint only. The public Google
    // business name may become a business fact only after phone/address/domain
    // independently anchors the merchant, there is no critical conflict, the
    // business is operating, and the name explicitly describes a target
    // service (for example "Serwis telefonów" or "Laptop repairs").
    if (explicitNamedTargetBusiness) verifiedContext.push(businessName);
    if (mobileName && repairReview) verifiedContext.push("mobile phone repair");
    if (/(?:cell_phone_store|mobile_phone_shop|electronics_store)/i.test((item.types || []).join(" "))
        && /(?:accessor|cover|screen protector|protective film|privacy film|power ?bank|car holder|charger|earbud|headphone|tablet|配件|手机壳|保护膜|移动电源|手机支架|充电器|耳机|平板)/i.test(reviews)) {
      verifiedContext.push("mobile phone accessories");
    }
  }
  return verifiedContext.join("；");
}

function googleBusinessEvidenceText(item: GooglePlaceEvidence) {
  return [googleCategoryText(item), item.description, googleContextualReviewEvidence(item), ...(item.reviews || [])].filter(Boolean).join("；");
}

export function hasTargetValueSignal(customer: CustomerRow, records: ChannelRecord[]) {
  const evidenceText = records.filter((record) => record.status === "COLLECTED" && record.evidence).map((record) => {
    if (record.channel === "google_maps") return googleBusinessEvidenceText(record.evidence as GooglePlaceEvidence);
    const item = record.evidence as WebsiteEvidence;
    if (record.channel === "other") return identityAnchoredRecoveryText(customer, item);
    return [item.title, item.description, ...(item.structured_descriptions || []), ...(item.headings || []), item.text_excerpt].filter(Boolean).join(" ");
  }).join(" ");
  // Imported fields are routing hints only. They may authorize deeper
  // collection, but never become evidence or add to the score.
  return PRODUCT_RELEVANCE_PATTERN.test(`${customer.company_name || ""} ${customer.category || ""} ${customer.industry || ""} ${evidenceText}`);
}

export function isConclusiveChannelAnalysis(analysis: CustomerAnalysis | null) {
  if (!analysis || !analysis.evidence_summaries.length) return false;
  if (analysis.confidence_score >= 82 && analysis.evidence_sufficiency === "充分") return true;
  // A verified official website is authoritative for declared business scope.
  // A conflicting Google category is retained in the evidence, but does not
  // justify more social/model calls after the website already proves the result.
  if (analysis.usage.model !== "RULE_ENGINE") return false;
  return analysis.evidence_summaries.some((item) => {
    if (item.confidence < 80 || item.evidence_type === "中性") return false;
    if (!/^(?:website|google_maps|facebook|instagram|linkedin|tiktok|other)$/.test(item.channel)) return false;
    return item.evidence_type === "支持"
      ? hasDirectTargetBusinessEvidence(item.fact_zh)
      : isDirectNonTargetBusinessEvidence(item.fact_zh);
  });
}

export function shouldUseModelSupplement(customer: CustomerRow, records: ChannelRecord[], analysis: CustomerAnalysis | null) {
  if (isConclusiveChannelAnalysis(analysis)) return false;
  // Social collection and model synthesis are reserved for target-adjacent
  // customers that primary sources could not settle. No target-value signal
  // means no token-consuming speculative search.
  return hasTargetValueSignal(customer, records);
}

function ruleIsSupported(rule: (typeof RULE_INDUSTRIES)[number], text: string) {
  if (!rule.pattern.test(text)) return false;
  if (/维修店/.test(rule.industry) && TELECOM_SERVICE_PATTERN.test(text) && !EXPLICIT_DEVICE_REPAIR_PATTERN.test(text)) return false;
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
  const recordTargetText = (record: ChannelRecord) => {
    if (!record.evidence) return "";
    if (record.channel === "google_maps") return googleBusinessEvidenceText(record.evidence as GooglePlaceEvidence);
    const evidence = record.evidence as WebsiteEvidence;
    if (record.channel === "other") return identityAnchoredRecoveryText(input.customer, evidence);
    return [evidence.title, evidence.description, ...(evidence.structured_descriptions || []), ...(evidence.headings || []), evidence.text_excerpt].filter(Boolean).join("；");
  };
  const matchingRecords = input.records.filter((record) => {
    if (record.status !== "COLLECTED" || !record.evidence) return false;
    if (record.channel === "google_maps") {
      const evidence = record.evidence as GooglePlaceEvidence;
      return input.rule.pattern.test(googleBusinessEvidenceText(evidence));
    }
    if (record.channel !== "website" && !recoveryRecordMatchesEntity(input.customer, input.records, record)) return false;
    return input.rule.pattern.test(recordTargetText(record));
  });
  const matchingSources = new Set(matchingRecords.map((record) => {
    try { return new URL(record.source_url || "").origin; } catch { return record.channel; }
  }).filter(Boolean)).size;
  const combinedText = matchingRecords.map(recordTargetText).join("；");
  const specificServices = [
    /(?:(?:screen|display|glass) (?:replacement|repair|replaced|replacing|changed|changing|fixed)|sprukne? skjerm(?:er)?|skjerm(?:bytte|reparasjon)|lcd|oled|touch ?screen|wymian\w* (?:szyb|wyświetlacz)|napraw\w* (?:szyb|wyświetlacz)|(?:troca|substitui[cç][aã]o) (?:de )?tela|换屏|更换屏幕|玻璃更换|触摸屏)/i,
    /(?:battery (?:replacement|repair|replaced|replacing|changed|changing|fixed)|dårlig batterilevetid|batteri(?:bytte|reparasjon)|bytte batteri|wymian\w* bater|napraw\w* bater|(?:troca|substitui[cç][aã]o) (?:de )?bater|换电池|电池更换)/i,
    /(?:component[- ]level repair|board[- ]level repair|microsoldering|charging port|dock connector|motherboard|mainboard|keyboard replacement|camera replacement|ladeport|høyttaler(?:e)?|bøyd chassis|vanninngangsskade|尾插|充电口|主板维修|板级维修|键盘更换|摄像头|排线)/i,
    /(?:repair bench|device disassembly|repair work|repair workshop|speciali[sz]ed workshop|eigene\w* (?:und )?(?:speziell\w* )?(?:eingerichtet\w* )?werkstatt|fachwerkstatt|reparaturwerkstatt|维修工作台|拆机维修|维修作业|专业维修车间|内配件|维修配件)/i,
    /(?:spare parts?|replacement parts?|repair parts?|ersatzteil\w*|cz[eę][sś]ci zamienne|repuestos|pi[eè]ces d[eé]tach[eé]es|ricambi|pe[cç]as de reposi[cç][aã]o|优质备件|维修配件|内配件)/i,
    /(?:wholesale|distributor|importer|b2b|moq|trade account|配件批发|配件分销|配件进口|批量供货)/i,
  ].filter((pattern) => pattern.test(combinedText || input.candidate.text)).length;
  const directTargetPattern = /(?:component[- ]level repair|board[- ]level repair|(?:screen|display|glass) (?:replacement|repair|replaced|replacing|changed|changing|fixed)|battery (?:replacement|repair|replaced|replacing|changed|changing|fixed)|sprukne? skjerm(?:er)?|skjerm(?:bytte|reparasjon)|dårlig batterilevetid|batteri(?:bytte|reparasjon)|bytte batteri|vanninngangsskade|bøyd chassis|ødelagte? høyttaler(?:e)?|ladeport|(?:troca|substitui[cç][aã]o) (?:de )?(?:tela|bater)|charging port|dock connector|motherboard|mainboard|keyboard replacement|camera replacement|repair bench|repair workshop|speciali[sz]ed workshop|eigene\w* (?:und )?(?:speziell\w* )?(?:eingerichtet\w* )?werkstatt|fachwerkstatt|reparaturwerkstatt|device disassembly|spare parts?|replacement parts?|repair parts?|ersatzteil\w*|phone covers?|screen protectors?|protective films?|privacy films?|power ?banks?|phone car holders?|chargers?|earbuds?|headphones?|lcd|oled|touch ?screen|wymian\w* (?:szyb|wyświetlacz|bater)|换屏|屏幕更换|玻璃更换|电池更换|换电池|尾插|充电口|主板维修|板级维修|键盘更换|摄像头|排线|维修工作台|专业维修车间|拆机维修|维修作业|内配件|维修配件|手机壳|保护膜|移动电源|手机支架|充电器|耳机|wholesale|distributor|importer|b2b|moq|trade account|配件批发|配件分销|配件进口|批量供货)/i;
  const googleDirectTargetEvidence = matchingRecords.some((record) => record.channel === "google_maps"
    && (directTargetPattern.test(recordTargetText(record))
      || Boolean(input.google && input.rule.target && hasVerifiedGoogleBusinessCategory(input.google))));
  const websiteDirectTargetEvidence = matchingRecords.some((record) => record.channel === "website" && directTargetPattern.test(recordTargetText(record)));
  const googleDirectBusinessEvidence = matchingRecords.some((record) => record.channel === "google_maps"
    && verifiedFactLabels(recordTargetText(record)).some((label) => !NON_TARGET_FACT_LABEL.test(label)));
  const verifiedContacts = input.records.some((record) => {
    if (record.status !== "COLLECTED" || !record.evidence) return false;
    const evidence = record.evidence as WebsiteEvidence & GooglePlaceEvidence;
    return Boolean(evidence.phone || evidence.phones?.length || evidence.emails?.length);
  });
  const reviewCount = Number(input.google?.user_ratings_total || 0);
  const repairOnly = /维修店/.test(input.rule.industry);
  const wholesale = input.rule.industry === "进口商或分销商";
  const accessoryRetail = input.rule.industry === "手机外配件零售";
  const verifiedChain = matchingRecords.some((record) => record.channel === "website"
    && /(?:连锁|多家门店|多门店|分店|multiple locations|chain of repair|sie[cć] serwis)/i.test(recordTargetText(record)));
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
  let rawScore = businessFit + scaleValue + procurementValue + evidenceValue + activityValue + contactValue
    + multiSourceOperatingBonus + (completeDirectTargetChain ? 12 : 0);
  // Concrete component-level services on the verified official website prove
  // a real repair-parts usage scenario. They must not collapse into D merely
  // because a second platform omitted the same wording.
  if (input.rule.target && websiteDirectTargetEvidence && specificServices >= 2) rawScore = Math.max(rawScore, 72);
  // A subject-matched Google business description that explicitly says it
  // repairs phones/laptops or sells their accessories is direct operating
  // evidence. It is weaker than component-level or multi-source proof, but it
  // must clear the target threshold instead of being mislabeled as D.
  if (input.rule.target && googleDirectBusinessEvidence) {
    const reviewSignal = Math.min(6, Math.round(Math.log10(reviewCount + 1) * 2.5));
    const serviceSignal = Math.min(4, specificServices);
    rawScore = Math.max(rawScore, 60 + reviewSignal + serviceSignal + (verifiedContacts ? 1 : 0));
  }
  if (completeDirectTargetChain) rawScore = Math.max(rawScore, 85);
  const qualifiesForA = completeDirectTargetChain || (input.rule.target && matchingSources >= 2
    && (verifiedProcurementEvidence || highVolumeRepair || (wholesale && scaleValue >= 15)));
  const targetMaximum = repairOnly
    ? highVolumeRepair ? 94 : completeDirectTargetChain ? 89 : 84
    : accessoryRetail ? 69
      : qualifiesForA ? (verifiedProcurementEvidence ? 100 : 89) : 84;
  const score = Math.max(0, Math.min(input.rule.target ? targetMaximum : 39, input.rule.target ? Math.max(60, rawScore) : rawScore));
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

const VERIFIED_FACT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Apple设备维修", pattern: /(?:Apple|iPhone|iPad|MacBook|Apple Watch|iMac)[\s\S]{0,80}(?:repair|fix|napraw|serwis|repar|reparatur|维修|更换)|(?:repair|fix|napraw|serwis|repar|reparatur|维修|更换)[\s\S]{0,80}(?:Apple|iPhone|iPad|MacBook|Apple Watch|iMac)/i },
  { label: "手机维修", pattern: /(?:phone|mobile|cell ?phone|smartphone|iphone|gsm|telefon|smartfon|m[oó]vil|celular|t[eé]l[eé]phone|handy|telefono|mobil)[\s\S]{0,60}(?:repair|fix|napraw|serwis|repar|reparasjon|r[eé]paration|riparazione|repara[cç][aã]o|reparatur)|(?:repair|fix|napraw|serwis|repar|reparasjon|r[eé]paration|riparazione|repara[cç][aã]o|reparatur)[\s\S]{0,60}(?:phone|mobile|cell ?phone|smartphone|iphone|gsm|telefon|smartfon|m[oó]vil|celular|t[eé]l[eé]phone|handy|telefono|mobil)|手机维修/i },
  { label: "电脑或笔记本维修", pattern: /(?:computer|laptop|notebook|macbook|pc|komputer|ordenador|ordinateur|computador)[\s\S]{0,80}(?:repair(?:ed|s|ing)?|service|fix(?:ed|es|ing)?|care|napraw|serwis|repar|r[eé]paration|riparazione|repara[cç][aã]o|reparatur)|(?:repair(?:ed|s|ing)?|service|fix(?:ed|es|ing)?|care|napraw|serwis|repar|r[eé]paration|riparazione|repara[cç][aã]o|reparatur)[\s\S]{0,80}(?:computer|laptop|notebook|macbook|pc|komputer|ordenador|ordinateur|computador)|(?:laptop|notebook)[\s\S]{0,60}(?:hinge|screen|keyboard|battery)[\s\S]{0,40}(?:repair(?:ed|s|ing)?|fix(?:ed|es|ing)?)|电脑维修|笔记本维修/i },
  { label: "电子设备维修", pattern: /(?:electronics? repairs?|electrical repairs?|electronic device repairs?|game(?:s)? console repairs?|console repairs?|xbox[\s\S]{0,40}repair|playstation[\s\S]{0,40}repair|ps[345][\s\S]{0,40}repair|电子设备维修|电子产品维修|游戏机维修)/i },
  { label: "屏幕或玻璃更换", pattern: /(?:sprukne? skjerm(?:er)?|skjerm(?:bytte|reparasjon)|screen|display|glass|lcd|oled|digitizer|szyb|wyświetlacz|pantalla|[eé]cran|schermo|tela).{0,24}(?:replacement|repair|replaced|replacing|change|changed|changing|fixed|wymian|napraw|repar|r[eé]paration|sostituzione|substitui[cç][aã]o|troca)|(?:replacement|repair|replaced|replacing|change|changed|changing|fixed|wymian|napraw|repar|r[eé]paration|sostituzione|substitui[cç][aã]o|troca).{0,24}(?:screen|display|glass|lcd|oled|digitizer|szyb|wyświetlacz|pantalla|[eé]cran|schermo|tela)|换屏|屏幕更换|玻璃更换/i },
  { label: "电池更换", pattern: /(?:dårlig batterilevetid|batteri(?:bytte|reparasjon)|bytte batteri|battery|bater|batterie|akku).{0,22}(?:replacement|change|wymian|napraw|repar|r[eé]paration|sostituzione|substitui[cç][aã]o|troca)?|(?:replacement|change|wymian|napraw|repar|r[eé]paration|sostituzione|substitui[cç][aã]o|troca).{0,22}(?:battery|bater|batterie|akku)|换电池|电池更换/i },
  { label: "充电口或接口维修", pattern: /(?:charging port|charge port|dock connector|usb port|ladebuchse|puerto de carga|port de charge|connettore di ricarica|充电口|尾插)/i },
  { label: "主板或逻辑板维修", pattern: /(?:motherboard|mainboard|logic board|logicboard|płyta gł[oó]wna|placa madre|carte m[eè]re|scheda madre|主板|逻辑板).{0,20}(?:repair|service|napraw|repar|r[eé]paration|riparazione|维修)/i },
  { label: "板级或元器件级维修", pattern: /(?:component[- ]level repair|board[- ]level repair|microsoldering|micro soldering|板级维修|元器件级维修)/i },
  { label: "键盘或触控板维修", pattern: /(?:keyboard|trackpad|touchpad|klawiatur|teclado|clavier|tastiera|键盘|触控板).{0,20}(?:replacement|repair|wymian|napraw|repar|r[eé]paration|sostituzione|更换|维修)/i },
  { label: "专业维修车间", pattern: /(?:repair workshop|speciali[sz]ed workshop|eigene\w* (?:und )?(?:speziell\w* )?(?:eingerichtet\w* )?werkstatt|fachwerkstatt|reparaturwerkstatt|专业维修车间|专用维修车间)/i },
  { label: "使用手机或电脑维修备件", pattern: /(?:repair parts?|spare parts?|replacement parts?|ersatzteil\w*|cz[eę][sś]ci zamienne|repuestos|pi[eè]ces d[eé]tach[eé]es|ricambi|pe[cç]as de reposi[cç][aã]o|维修配件|优质备件|内配件)/i },
  { label: "手机、平板配件销售", pattern: /(?:accessor(?:y|ies).{0,60}(?:phone|ipad|tablet)|(?:phone|ipad|tablet).{0,60}accessor(?:y|ies)|phone covers?|screen protectors?|protective films?|privacy films?|power ?banks?|phone car holders?|adapters?|chargers?|earbuds?|earphones?|headphones?|tablets?|smart ?watch|手机壳|保护膜|移动电源|车载手机支架|充电器|耳机|手机配件|平板配件)/i },
  { label: "配件批发、分销或进口", pattern: /(?:wholesale|wholesaler|distributor|distribution|importer|b2b|bulk order|trade account|hurtownia|sprzedaż hurtowa|dystrybutor|mayorista|grossiste|ingrosso|批发|分销|进口商)/i },
  { label: "多门店或连锁经营", pattern: /(?:(?:at least|over|more than|拥有|设有|共有)\s*\d{1,3}\s*(?:locations?|stores?|shops?|branches?|service centers?|门店|分店|直营网点|维修中心)|\d{1,3}\s*(?:locations?|stores?|shops?|branches?|service centers?|filialen|standorte|oddzia(?:ł|ły|łów)|punkt(?:y|ów)|sklep(?:y|ów)|门店|分店|直营网点|维修中心)|multiple locations|chain of (?:repair )?(?:stores?|shops?)|多家门店|多门店|连锁门店|旗下分店)/i },
  { label: "IT系统、网络或服务器技术支持", pattern: /(?:IT support|technical support|managed IT|managed services|network (?:setup|configuration|maintenance|management|support)|NAS (?:setup|configuration|maintenance|support)|server (?:setup|configuration|maintenance|support)|IT系统|网络(?:设置|配置|维护|管理|支持)|NAS(?:设置|配置|维护|支持)|服务器(?:设置|配置|维护|支持))/i },
  { label: "软件开发、云服务或网络托管", pattern: /(?:software development|software company|cloud services|web hosting|cyber ?security|软件开发|软件公司|云服务|网络托管|信息安全)/i },
  { label: "手机合约或移动通信套餐", pattern: /(?:sim card|mobile plan|mobile contract|phone contract|mobilfunk(?:vertrag|tarif)|handyvertr[aä]g|手机套餐|手机合约|通信合约|移动通信套餐)/i },
  { label: "固定电话服务", pattern: /(?:festnetz|fixed[- ]line|landline|固定电话)/i },
  { label: "互联网或宽带服务", pattern: /(?:\binternet\b|internet(?:vertrag|tarif)|broadband|dsl|fiber internet|互联网|宽带套餐|宽带服务)/i },
  { label: "MagentaTV或电视服务", pattern: /(?:magenta\s*tv|iptv|television package|电视服务)/i },
  { label: "电信合作伙伴或运营商服务", pattern: /(?:mobile network operator|telecommunications service provider|telekom partner|telekommunikationspartner|运营商营业厅|电信运营商|电信合作伙伴)/i },
  { label: "铁路工程、电气安装或电气安全服务", pattern: /(?:railway engineering|rail safety|railway safety|electrical installation|electrical safety|industrial electrical|铁路工程|铁路安全|电气安装|电气安全|工业电气)/i },
  { label: "食品批发或餐饮供应", pattern: /(?:food wholesale|food distributor|vegetable wholesale|fruit wholesale|食品批发|蔬菜批发|水果批发|餐饮供应)/i },
  { label: "电子烟、烟草或水烟零售", pattern: /(?:tobacco shop|tobacconist|vape shop|vaping store|e[- ]?cigarette|smoke shop|shisha shop|电子烟|烟草店|水烟店)/i },
  { label: "拍卖、破产清算或资产处置", pattern: /(?:insolvency auction|liquidation auction|auction house|auction calendar|versteigerungskalender|insolvenzverfahren|拍卖行|破产拍卖|清算拍卖)/i },
];

function verifiedFactLabels(text: string) {
  const positiveText = positiveTargetEvidenceText(text);
  return VERIFIED_FACT_PATTERNS.filter((item) => item.pattern.test(positiveText)).map((item) => item.label);
}

type DeterministicCandidate = {
  channel: string;
  url: string;
  title: string;
  text: string;
  confidence: number;
  originalExcerpt: string;
};

function verifiedFactLabelsForCandidate(candidate: Pick<DeterministicCandidate, "channel" | "text">) {
  const labels = verifiedFactLabels(candidate.text);
  // Scale and chain claims are accepted only from the verified official
  // website. Directory boilerplate and nearby-business widgets frequently use
  // phrases such as "multiple locations" that do not describe this customer.
  return candidate.channel === "website" ? labels : labels.filter((label) => label !== "多门店或连锁经营");
}

function compactBusinessExcerpt(value: string) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const chunks = normalized
    .split(/(?<=[.!?。！？])\s+|[；|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12)
    .map((item) => ({
      text: item,
      score: verifiedFactLabels(item).length * 10
        + (/repair|fix|replacement|parts?|accessor|wholesale|distribut|napraw|serwis|repar|维修|更换|配件|批发|分销/i.test(item) ? 4 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.text.length - right.text.length);
  const selected: string[] = [];
  for (const item of chunks) {
    if (item.score <= 0 || selected.some((existing) => existing.includes(item.text) || item.text.includes(existing))) continue;
    selected.push(item.text.slice(0, 220));
    if (selected.length >= 2 || selected.join("；").length >= 360) break;
  }
  return (selected.length ? selected.join("；") : normalized.slice(0, 320)).slice(0, 420);
}

function candidateSourceName(candidate: Pick<DeterministicCandidate, "channel" | "title">) {
  const title = String(candidate.title || "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (candidate.channel === "google_maps") return `Google商家“${title || "商家主页"}”`;
  if (candidate.channel === "website") return `企业官网“${title || "官网页面"}”`;
  return `${AI_CHANNEL_LABELS[candidate.channel as AiChannel] || "公开来源"}${title ? `“${title}”` : ""}`;
}

function labelsForIndustry(candidate: Pick<DeterministicCandidate, "channel" | "text">, industry: CustomerAnalysis["industry_type"]) {
  let labels = [...new Set(verifiedFactLabelsForCandidate(candidate))];
  if (industry === "软件或IT服务") labels = labels.filter((item) => /IT|软件|云服务|网络托管/.test(item));
  if (industry === "运营商营业厅") labels = labels.filter((item) => /手机合约|通信套餐|固定电话|互联网|宽带|MagentaTV|电视服务|电信合作伙伴|运营商/.test(item));
  if (industry === "其他" && labels.some((item) => /食品/.test(item))) labels = labels.filter((item) => /食品/.test(item));
  if (industry === "其他" && labels.some((item) => /铁路|电气/.test(item))) labels = labels.filter((item) => /铁路|电气/.test(item));
  return labels.slice(0, 6);
}

function conciseDeterministicFact(candidate: DeterministicCandidate, industry: CustomerAnalysis["industry_type"]) {
  const labels = labelsForIndustry(candidate, industry);
  const source = candidateSourceName(candidate);
  if (labels.length) return `${source}已核验经营内容：${labels.join("、")}。`;
  // This branch is used only for a matched non-target rule whose concrete
  // source words are already preserved as original_excerpt. It deliberately
  // avoids claiming a service that was not extracted.
  return `${source}显示其经营内容属于“${industry}”；关键原文已随本条证据保存，可通过来源链接核验。`;
}

function salesSummaryFields(params: {
  industry: CustomerAnalysis["industry_type"];
  target: boolean;
  candidates: DeterministicCandidate[];
  contactChannels: string[];
}) {
  const sourceFacts = params.candidates.map((candidate) => ({
    channel: candidate.channel,
    source: candidateSourceName(candidate),
    labels: [...new Set(verifiedFactLabelsForCandidate(candidate))].slice(0, 8),
  })).filter((item) => item.labels.length);
  const allLabels = [...new Set(sourceFacts.flatMap((item) => item.labels))];
  // Sales-facing conclusions contain Chinese verified facts only. The exact
  // foreign-language excerpt remains attached to the evidence record together
  // with its source URL, where users can expand and verify it on demand.
  const sourceConclusions = sourceFacts.map((item) => `• ${item.source}：${item.labels.join("、")}。`);
  const sourceNames = sourceFacts.map((item) => item.source).join("、") || "本次已保存的可核验公开页面";
  const serviceText = allLabels.length ? allLabels.join("、") : params.industry;
  const repairParts = allLabels.filter((label) => /屏幕|玻璃|电池|充电口|接口|主板|板级|键盘|触控板|维修配件|配件销售/.test(label));
  const wholesaleFacts = allLabels.filter((label) => /批发|分销|进口/.test(label));
  const conclusion = `${sourceConclusions.join("\n")}\n• 综合行业归类：${params.industry}。`;
  const scope = `• 主营行业：${params.industry}。\n${sourceConclusions.join("\n")}`;

  if (!params.target) {
    return {
      scope,
      reason: conclusion,
      relevance: `${sourceConclusions.join("\n")}\n• 与我方业务交集：当前已核验内容未出现手机或电脑维修配件、相关配件批发分销或真实采购事实。`,
      value: `• 已核验来源：${sourceNames}。\n• 已核验经营内容：${serviceText}。\n• 销售优先级：当前证据不支持进入手机、电脑配件常规开发名单。`,
      followup: "• 建议：暂不安排常规销售跟进。\n• 后续条件：若官网、Google商家页或其他官方渠道出现维修配件、批发分销或采购事实，再重新筛选。",
    };
  }

  const directFit = wholesaleFacts.length
    ? `已核验${wholesaleFacts.join("、")}业务，存在直接的渠道合作场景。`
    : repairParts.length
      ? `已核验${repairParts.join("、")}服务，与我方对应维修配件存在直接产品交集。`
      : `已核验${serviceText}，属于手机或电脑配件的潜在使用场景；具体配件需求尚需销售确认。`;
  const value = wholesaleFacts.length
    ? "公开证据支持其具备批发、分销或进口业务场景；尚未取得真实采购量、采购周期或订单金额，不把采购规模作为既定事实。"
    : repairParts.length
      ? `公开证据直接显示${repairParts.join("、")}，可围绕对应配件开展销售沟通；门店规模、月用量和采购渠道尚未核验。`
      : "公开证据支持其属于目标经营场景，但尚无具体配件采购、采购频次或规模证据，销售优先确认实际需求。";
  return {
    scope,
    reason: conclusion,
    relevance: `${sourceConclusions.join("\n")}\n• 与我方业务交集：${directFit}`,
    value: `• 已核验来源：${sourceNames}。\n• 已核验经营内容：${serviceText}。\n• 可开发依据：${value}`,
    followup: `• 联系入口：${params.contactChannels.length ? `优先通过${params.contactChannels.join("或")}` : "使用已核验公开联系方式"}。\n• 沟通内容：引用已核验的“${serviceText}”业务，确认常用配件、月度用量、采购渠道和报价需求。`,
  };
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

function identityAnchoredRecoveryText(customer: CustomerRow, website: WebsiteEvidence) {
  // A third-party listing's free body can contain related-business widgets,
  // reviews for nearby merchants and generic SEO articles. The caller has
  // already admitted this page through name + address/phone/domain matching,
  // so retain only the bounded listing section anchored at the customer name.
  // This captures the merchant's own profile paragraph without allowing a
  // distant generic article or another listing in the page footer to score.
  const normalizedBody = String(website.text_excerpt || "").replace(/\s+/g, " ").trim();
  const normalizedName = String(customer.company_name || "").replace(/\s+/g, " ").trim();
  const nameIndex = normalizedName ? normalizedBody.toLocaleLowerCase().indexOf(normalizedName.toLocaleLowerCase()) : -1;
  const anchoredStart = nameIndex >= 0 ? Math.max(0, nameIndex - 120) : 0;
  const listingSection = normalizedBody.slice(anchoredStart, anchoredStart + 1800)
    .split(/\b(?:similar businesses|related businesses|nearby businesses|people also viewed|you may also like|latest articles|popular articles)\b/i)[0]
    .trim();
  return [website.title, website.description, ...(website.structured_types || []), listingSection]
    .filter(Boolean).join("；").slice(0, 3000);
}

export function deterministicAnalysis(customer: CustomerRow, records: ChannelRecord[]): CustomerAnalysis | null {
  const googleRecord = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED");
  const google = googleRecord?.evidence as GooglePlaceEvidence | undefined;
  const googleUrl = google?.verified_google_maps_url || googleRecord?.source_url || customer.google_url || "";
  const websiteRecord = records.find((item) => item.channel === "website" && item.status === "COLLECTED");
  const website = websiteRecord?.evidence as WebsiteEvidence | undefined;
  const candidates: DeterministicCandidate[] = [];
  if (google?.name && /^https?:\/\//i.test(googleUrl) && ["MATCHED", "LIKELY_MATCHED"].includes(String(google.identity_status))) {
    candidates.push({
      channel: "google_maps",
      url: googleUrl,
      title: google.name,
      // 名称不得单独推断行业；只有同一已匹配主体的公开说明/评论同时
      // 明确维修或配件活动时，名称中的设备类型才可作为组合证据。
      text: googleBusinessEvidenceText(google),
      confidence: Math.max(70, Number(google.identity_confidence || 0)),
      originalExcerpt: compactBusinessExcerpt([googleCategoryText(google), google.description, ...(google.reviews || [])].filter(Boolean).join("；")),
    });
  }
  if (website?.reachable && /^https?:\/\//i.test(website.url)) {
    candidates.push({
      channel: "website",
      url: website.url,
      title: website.title || customer.company_name || new URL(website.url).hostname,
      // 结构化企业名称也是定位线索，不是行业证据。只使用官网业务描述、类型和标题。
      text: [website.title, website.description, ...(website.structured_types || []), ...(website.structured_descriptions || []), ...(website.headings || []), website.text_excerpt?.slice(0, 1600)].filter(Boolean).join("；").slice(0, 4000),
      confidence: 92,
      originalExcerpt: compactBusinessExcerpt([website.title, website.description, ...(website.structured_descriptions || []), website.text_excerpt].filter(Boolean).join("；")),
    });
  }
  for (const record of records) {
    if (!["facebook", "instagram", "linkedin", "tiktok", "other"].includes(record.channel)
        || record.status !== "COLLECTED" || !record.evidence
        || !record.source_url || !recoveryRecordMatchesEntity(customer, records, record)) continue;
    const social = record.evidence as WebsiteEvidence;
    const text = record.channel === "other"
      ? identityAnchoredRecoveryText(customer, social)
      : [social.title, social.description, ...(social.structured_types || []),
        ...(social.structured_descriptions || []), ...(social.headings || []), social.text_excerpt?.slice(0, 1600)]
        .filter(Boolean).join("；").slice(0, 4000);
    if (!text) continue;
    candidates.push({
      channel: record.channel,
      url: record.source_url,
      title: social.title || customer.company_name || record.channel,
      text,
      // `other` reaches this branch only after recoveryRecordMatchesEntity has
      // verified the page by name plus address/phone/domain. It is weaker than
      // an official site, but strong enough to stop repeated paid searches when
      // the page contains a direct business fact.
      confidence: record.channel === "other" ? 84 : 88,
      originalExcerpt: compactBusinessExcerpt(text),
    });
  }
  const matches = candidates.flatMap((candidate) => RULE_INDUSTRIES
    .filter((rule) => {
      const exactGoogleCategory = candidate.channel === "google_maps" && google && hasVerifiedGoogleBusinessCategory(google);
      const googleComputerRepairCategory = exactGoogleCategory && rule.industry === "电脑维修店" && /computer repair/i.test(googleCategoryText(google));
      if (!ruleIsSupported(rule, candidate.text) && !googleComputerRepairCategory) return false;
      if (candidate.channel !== "google_maps" || !rule.target) return true;
      // 精确匹配主体的具体 Google 商家类别属于公开经营事实；泛类别、
      // 同名或仅可能匹配的候选仍必须由描述、评论或官网继续佐证。
      const corroborationText = google
        ? [google.description, googleContextualReviewEvidence(google), ...(google.reviews || [])].filter(Boolean).join("；")
        : "";
      return Boolean(google && hasVerifiedGoogleBusinessCategory(google))
        || ruleIsSupported(rule, corroborationText)
        || /(?:换屏|屏幕更换|玻璃更换|换电池|电池更换|尾插|充电口|主板|拆机|维修作业|screen replacement|battery replacement|charging port|motherboard|wymian\w* (?:szyb|wyświetlacz|bater))/i.test(corroborationText);
    })
    .map((rule) => ({ candidate, rule, scored: deterministicScore({ rule, candidate, customer, records, google }) })))
    .sort((left, right) => right.scored.score - left.scored.score || right.candidate.confidence - left.candidate.confidence);
  // A verified official website is authoritative for the company's declared
  // products and services. Google remains authoritative for operating status,
  // address and recent public activity. Prefer an explicit website business
  // fact over a conflicting platform category, while preserving any direct
  // cross-source conflict for the user instead of silently blending it.
  const websiteMatches = matches.filter((item) => item.candidate.channel === "website" && verifiedFactLabelsForCandidate(item.candidate).length);
  const googleMatches = matches.filter((item) => item.candidate.channel === "google_maps" && verifiedFactLabelsForCandidate(item.candidate).length);
  const bestWebsite = websiteMatches[0];
  const bestGoogle = googleMatches[0];
  const crossSourceConflict = Boolean(bestWebsite && bestGoogle && bestWebsite.rule.target !== bestGoogle.rule.target);
  const selected = bestWebsite || matches[0];
  if (!selected) return null;
  const evidenceSummaries = [...candidates.flatMap((candidate) => {
    const match = matches.find((item) => item.candidate === candidate);
    if (!match) return [];
    return [{
      channel: candidate.channel,
      // The grounding layer intentionally rejects non-Chinese sales-facing
      // labels. Always retain a Chinese source label here; the original
      // merchant name remains embedded verbatim after that label.
      title_zh: candidateSourceName(candidate),
      fact_zh: conciseDeterministicFact(candidate, match.rule.industry),
      source_url: candidate.url,
      evidence_type: deterministicEvidenceType(match.rule.target),
      confidence: candidate.confidence,
      original_excerpt: candidate.originalExcerpt,
    }];
  }).filter((item, index, all) => all.findIndex((other) => other.channel === item.channel && other.source_url === item.source_url) === index),
  ...(google?.business_status === "CLOSED_PERMANENTLY" && /^https?:\/\//i.test(googleUrl)
    ? [{ channel: "google_maps", title_zh: "Google商家营业状态", fact_zh: "Google商家页显示该营业地点已经永久停业。", source_url: googleUrl, evidence_type: "矛盾" as const, confidence: Math.max(85, Number(google.identity_confidence || 0)), original_excerpt: "" }]
    : []),
  ].slice(0, 5);
  // 到达这里的 website 已经过主体交叉验证，或来自已匹配 Google 商家
  // 绑定的官网。因此经营范围冲突时以官网为准，同时保留 Google 事实
  // 和冲突说明；不能把任一目标标签简单合并成“混合经营”。
  const effectiveTarget = selected.rule.target;
  const effectiveIndustry = selected.rule.industry;
  const score = selected.scored.score;
  const contactChannels = [customer.phone ? "原始电话" : "", customer.email ? "原始邮箱" : ""].filter(Boolean);
  const salesFields = salesSummaryFields({ industry: effectiveIndustry, target: effectiveTarget, candidates, contactChannels });
  const evidenceConflicts = [
    ...(crossSourceConflict
      ? [`已确认的企业官网与Google商家公开信息显示不同经营方向：官网显示“${bestWebsite?.rule.industry}”，Google商家显示“${bestGoogle?.rule.industry}”。系统保留两方事实，经营范围与目标判断优先采用已确认官网。`]
      : []),
    ...(google?.business_status === "CLOSED_PERMANENTLY" && website?.reachable
      ? ["Google商家页显示该营业地点永久停业，但当前企业官网仍可访问并公开维修服务；可能是旧门店关闭或经营方式变更，联系前应先确认当前营业状态。"]
      : []),
  ];
  return {
    industry_type: effectiveIndustry,
    is_target_customer: effectiveTarget,
    ai_score: score,
    ai_level: scoreToLevel(score),
    ai_reason: salesFields.reason,
    business_relevance: salesFields.relevance,
    customer_value: salesFields.value,
    followup_suggestion: salesFields.followup,
    confidence_score: crossSourceConflict ? Math.min(79, Math.max(...evidenceSummaries.map((item) => item.confidence))) : Math.max(...evidenceSummaries.map((item) => item.confidence)),
    evidence_sufficiency: "充分",
    evidence_conflicts: evidenceConflicts,
    score_breakdown: selected.scored.breakdown,
    suggested_contact_order: ["电话", "邮箱", "WhatsApp"],
    evidence_summaries: evidenceSummaries,
    usage: { ...ZERO_USAGE, model: "RULE_ENGINE" },
  };
}

export function insufficientDataAnalysis(customer: CustomerRow, records: ChannelRecord[]): CustomerAnalysis {
  const collected = records.filter((item) => item.status === "COLLECTED");
  const failed = records.filter((item) => item.status === "FAILED");
  const collectedText = collected.length
    ? `已读取${collected.map((item) => AI_CHANNEL_LABELS[item.channel]).join("、")}，但未提取到能够确认经营行业的直接事实`
    : "未找到能够与该客户主体可靠匹配并可读取的公开企业页面";
  const limitation = failed.length
    ? `；${failed.map((item) => AI_CHANNEL_LABELS[item.channel]).join("、")}未能取得有效公开内容`
    : "";
  const sourceCount = new Set(collected.map((item) => item.channel)).size;
  const google = collected.find((item) => item.channel === "google_maps")?.evidence as GooglePlaceEvidence | undefined;
  const identityConfidence = Math.max(0, Math.min(100, Number(google?.identity_confidence || 0)));
  const reviewCount = Number(google?.user_ratings_total || google?.reviews?.length || 0);
  const activityPoints = google?.business_status === "OPERATIONAL" ? 3 : 0;
  const reviewPoints = Math.min(5, Math.round(Math.log10(reviewCount + 1) * 2));
  const locatorPoints = [customer.address, customer.phone, customer.email, effectiveWebsite(customer)]
    .filter(Boolean).length * 2;
  const score = Math.max(5, Math.min(39, Math.round(7 + sourceCount * 4
    + identityConfidence * 0.1 + activityPoints + reviewPoints + locatorPoints - failed.length * 2)));
  const verificationNote = "重点核对：公开渠道未显示目标维修、维修配件或批发分销事实；若销售沟通取得相反凭证，应补充到客户资料后重新分析。";
  const reason = `${collectedText}${limitation}。系统已完成本轮全部可用渠道核验，现有真实证据显示目标业务相关性较低，综合评为D级${score}分；未把无法读取的页面或客户名称关键词当作经营事实。`;
  const attemptEvidence = records.flatMap((record) => {
    const url = record.source_url || channelUrl(customer, record.channel);
    if (!url || !/^https?:\/\//i.test(url)) return [];
    const label = AI_CHANNEL_LABELS[record.channel];
    const fact = record.status === "COLLECTED"
      ? `已读取${label}；本次可解析公开内容中未发现手机或电脑维修配件、批发分销、进口采购等目标经营事实。`
      : `已尝试读取${label}；本次未取得可解析的公开页面内容，该来源仅作为已执行检索记录。`;
    return [{ channel: record.channel, title_zh: `${label}采集记录`, fact_zh: fact, source_url: url, evidence_type: "中性" as const, confidence: record.status === "COLLECTED" ? 45 : 25, original_excerpt: "" }];
  }).slice(0, 5);
  return {
    industry_type: "其他",
    is_target_customer: false,
    ai_score: score,
    ai_level: "D",
    ai_reason: reason,
    business_relevance: "已检查现有公开入口，未发现可追溯的手机或电脑维修、维修配件、相关批发分销经营事实，当前按低相关客户处理。",
    customer_value: `当前公开证据未证明目标业务价值。${verificationNote}`,
    followup_suggestion: "无需继续自动消耗模型费用；仅在销售取得新的官网、Google商家或官方社媒经营凭证后重新分析。",
    confidence_score: Math.max(20, Math.min(59, Math.round(22 + sourceCount * 7 + identityConfidence * 0.18
      + activityPoints * 2 + reviewPoints - failed.length * 3))),
    evidence_sufficiency: "一般",
    evidence_conflicts: [verificationNote],
    score_breakdown: {
      ...emptyBreakdown(0),
      entity_consistency: identityConfidence,
      company_authenticity: Math.min(70, 25 + identityConfidence * 0.4 + activityPoints * 4),
      business_activity: Math.min(60, activityPoints * 10 + reviewPoints * 6),
      contactability: Math.min(70, locatorPoints * 8),
      evidence_completeness: Math.min(49, 15 + sourceCount * 9 + reviewPoints * 2),
      contradiction_risk: google?.identity_status === "CONFLICTED" ? 85 : google?.identity_status === "AMBIGUOUS" ? 70 : 45,
    },
    suggested_contact_order: [],
    evidence_summaries: attemptEvidence,
    usage: { ...ZERO_USAGE, model: "NO_MODEL" },
  };
}

export function verifiedBusinessScope(analysis: CustomerAnalysis) {
  const facts = analysis.evidence_summaries
    // “矛盾” means contradictory to our target-customer profile, not that the
    // source fact is false. Non-target operating facts are still the customer's
    // verified business scope and must be shown to sales users.
    .filter((item) => item.evidence_type !== "中性" && item.confidence >= 60)
    .map((item) => item.fact_zh.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!facts.length) return null;
  const labels = [...new Set(facts.flatMap((fact) => verifiedFactLabels(fact)))];
  const directFacts = labels.length ? labels.slice(0, 8).join("、") : [...new Set(facts)].slice(0, 2).join("；");
  return `主营业务：${analysis.industry_type}。已核验经营内容：${directFacts}。`.slice(0, 600);
}

export function verifiedCompanyScale(records: ChannelRecord[]) {
  type TradeFact = { product?: unknown; quantity?: unknown; amount?: unknown; currency?: unknown; date?: unknown; supplier?: unknown; source_url?: unknown };
  const verified: Array<{ text: string; sourceUrl: string }> = [];
  const branchFacts: Array<{ text: string; sourceUrl: string; count: number | null }> = [];
  const countPattern = /(?:(?:at least|over|more than|拥有|设有|共有)\s*)?(\d{1,3})\s*(?:locations?|stores?|shops?|branches?|service centers?|filialen|standorte|oddzia(?:ł|ły|łów)|punkt(?:y|ów)|punkty serwisowe|salon(?:y|ów)|plac[oó]w(?:ki|ek)|sklep(?:y|ów)|门店|分店|直营网点|维修中心)/i;
  const chainPattern = /(?:multiple locations|chain of (?:repair )?(?:stores?|shops?)|sie[cć]\s+(?:serwis|salon|punkt)|nasze (?:salony|punkty|oddziały)|多家门店|多门店|连锁门店|旗下分店)/i;
  for (const record of records) {
    if (record.status !== "COLLECTED" || !record.evidence || typeof record.evidence !== "object") continue;
    const evidence = record.evidence as Record<string, unknown>;
    if (record.channel === "website") {
      const website = record.evidence as WebsiteEvidence;
      const pages = [{ url: website.url || record.source_url || "", text: [website.description, ...(website.structured_descriptions || []), ...(website.headings || []), website.text_excerpt].filter(Boolean).join("；") },
        ...(website.pages || []).map((page) => ({ url: page.url, text: [page.description, ...(page.headings || []), page.text_excerpt].filter(Boolean).join("；") }))];
      for (const page of pages) {
        if (!page.url || !page.text) continue;
        const match = page.text.match(countPattern);
        const pluralClaim = chainPattern.test(page.text);
        const count = match ? Number(match[1]) : null;
        if ((count != null && count >= 2) || pluralClaim) {
          // Sales-facing scale conclusions stay in Chinese. The exact foreign
          // excerpt is already persisted with this source page and is available
          // in the collapsible evidence panel; duplicating it here makes the
          // conclusion unreadable and can concatenate contradictory page counts.
          branchFacts.push({ text: count ? `官网明确列出${count}家门店或直营网点` : "官网明确说明为多门店或连锁经营", sourceUrl: page.url, count });
        }
      }
    }
    if (record.channel === "google_maps") {
      const google = record.evidence as GooglePlaceEvidence;
      const text = String(google.description || "").trim();
      if (google.identity_status === "MATCHED" && text) {
        const match = text.match(countPattern);
        const pluralClaim = chainPattern.test(text);
        const count = match ? Number(match[1]) : null;
        if ((count != null && count >= 2) || pluralClaim) {
          branchFacts.push({
            text: count ? `Google商家说明明确列出${count}家门店或直营网点` : "Google商家说明明确为多门店或连锁经营",
            sourceUrl: google.verified_google_maps_url || record.source_url || "",
            count,
          });
        }
      }
    }
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
  const uniqueBranches = [...new Map(branchFacts.map((item) => [`${item.sourceUrl}|${item.text}`, item])).values()];
  const branchCount = Math.max(0, ...uniqueBranches.map((item) => item.count || 0)) || null;
  const scaleParts = [uniqueBranches.length ? (branchCount ? `确认至少${branchCount}家门店` : "确认多门店或连锁经营") : "", verified.length ? "存在可核验采购记录" : ""].filter(Boolean);
  const strongestBranch = branchCount
    ? uniqueBranches.find((item) => item.count === branchCount) || null
    : uniqueBranches[0] || null;
  const facts = [
    ...(strongestBranch ? [`${strongestBranch.text}（核验：${strongestBranch.sourceUrl}）`] : []),
    ...verified.slice(0, 3).map((item) => `${item.text}（核验：${item.sourceUrl}）`),
  ].join("；");
  return { companyScale: scaleParts.join("；") || null, companyScaleEvidence: facts.slice(0, 1200) || null, locationCount: branchCount };
}

export function applyVerifiedScaleToSalesConclusion(analysis: CustomerAnalysis, scale: ReturnType<typeof verifiedCompanyScale>) {
  if (!scale.companyScale) return analysis;
  const scaleSentence = `经营规模核验：${scale.companyScale}。`;
  const append = (value: string, fallback: string) => {
    const base = String(value || fallback).replace(/\s+/g, " ").trim();
    if (base.includes(scale.companyScale!)) return base.slice(0, 220);
    const available = Math.max(0, 220 - scaleSentence.length - 1);
    return `${base.slice(0, available).replace(/[。；,，\s]+$/, "")}。${scaleSentence}`.slice(0, 220);
  };
  return {
    ...analysis,
    ai_reason: append(analysis.ai_reason, "已完成客户主体与经营范围核验"),
    customer_value: append(analysis.customer_value, "已核验客户经营价值"),
  };
}

export function channelUrl(customer: CustomerRow, channel: AiChannel): string | null {
  if (channel === "website") return effectiveWebsite(customer);
  if (channel === "google_maps") return customer.google_url;
  if (channel === "linkedin") return customer.linkedin_url || (aiChannelForPublicUrl(customer.website) === "linkedin" ? customer.website : null);
  if (channel === "facebook") return customer.facebook_url || (aiChannelForPublicUrl(customer.website) === "facebook" ? customer.website : null);
  if (channel === "instagram") return customer.instagram_url || (aiChannelForPublicUrl(customer.website) === "instagram" ? customer.website : null);
  if (channel === "tiktok") return customer.tiktok_url || (aiChannelForPublicUrl(customer.website) === "tiktok" ? customer.website : null);
  return customer.other_public_urls?.[0] || null;
}

type ExecutionLease = { executorId: string; leaseToken: string };

async function assertExecutionLease(taskItemId: string, lease?: ExecutionLease) {
  if (!lease) return;
  const admin = createAdminClient();
  const current = await admin.from("ai_screening_task_items")
    .select("lease_owner,lease_token,lease_expires_at,status,task:ai_screening_tasks!inner(status,cancel_requested)")
    .eq("id", taskItemId)
    .maybeSingle();
  if (current.error) throw current.error;
  const expiresAt = current.data?.lease_expires_at ? new Date(current.data.lease_expires_at).getTime() : 0;
  const task = Array.isArray(current.data?.task) ? current.data.task[0] : current.data?.task;
  if (!current.data || current.data.status !== "RUNNING" || !task || !["QUEUED", "RUNNING"].includes(String(task.status)) || Boolean(task.cancel_requested) || current.data.lease_owner !== lease.executorId
    || current.data.lease_token !== lease.leaseToken || expiresAt <= Date.now()) {
    throw new Error("AI_EXECUTION_LEASE_LOST");
  }
}

async function collectChannel(customer: CustomerRow, channel: AiChannel, signal: AbortSignal, costContext?:{taskId:string;taskItemId:string;customerId:string;userId:string|null;executionLease?:ExecutionLease}): Promise<ChannelRecord> {
  const url = channelUrl(customer, channel);
  if (channel !== "google_maps" && !url) return { channel, status: "SKIPPED", source_url: null, error: "客户档案没有该渠道网址" };
  if (channel === "google_maps" && !customer.google_url && !customer.company_name) return { channel, status: "SKIPPED", error: "客户档案没有Google商家信息" };
  try {
    const evidence = channel === "website"
      ? await collectDeepWebsiteEvidence(url, { signal, timeoutMs: 5000 })
      : channel === "google_maps"
        ? await collectGooglePlaceEvidence({ company_name: customer.company_name, country: customer.country, address: customer.address, google_url: customer.google_url, phone: customer.phone, website: effectiveWebsite(customer), place_id: customer.google_place_id, category_hint: customer.category, industry_hint: customer.industry }, { signal, timeoutMs: 12_000,
          onBeforeApiCall: async(call)=>{if(costContext)await assertExecutionLease(costContext.taskItemId,costContext.executionLease);const reservation=await reserveApiCostBudget("GOOGLE_PLACES",call.unitPriceUsd,{userId:costContext?.userId,customerId:costContext?.customerId||customer.id,taskId:costContext?.taskId,operation:call.operation});return {allowed:reservation.allowed,reservationId:reservation.reservationId}},
          onApiCall: async(call)=>{const admin=createAdminClient();const likelyBillable=call.status>=200&&call.status<300;const amount=likelyBillable?call.unitPriceUsd:0;const written=await admin.from("api_cost_ledger").insert({user_id:costContext?.userId||null,customer_id:costContext?.customerId||customer.id,task_id:costContext?.taskId||null,provider:call.provider,service:"AI筛选",operation:call.operation,model_or_sku:call.sku,request_id:call.requestId||randomUUID(),quantity:1,unit:"REQUEST",amount_usd:amount,amount_type:call.unitPriceUsd===0&&likelyBillable?"FREE":"ESTIMATED",pricing_snapshot:{unit_price_usd:call.unitPriceUsd,pricing_source:call.priceSource,billable_assumption:likelyBillable,pricing_configured:call.priceSource==="ENV"},metadata:{http_status:call.status},occurred_at:new Date().toISOString()});if(written.error)throw written.error;await releaseApiCostBudget(call.reservationId)} })
        : await collectPublicPageEvidence(url, { signal, timeoutMs: 3500 });
    if (!evidence) return { channel, status: "SKIPPED", source_url: url, error: "没有可读取的公开入口" };
    const failed = "reachable" in evidence ? !evidence.reachable : Boolean(evidence.error && !evidence.name);
    const resolvedSourceUrl = channel === "website" && "url" in evidence && evidence.url
      ? evidence.url
      : url;
    return { channel, status: failed ? "FAILED" : "COLLECTED", source_url: resolvedSourceUrl, evidence, error: evidence.error || null };
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

async function saveCheckpoint(taskItemId: string, records: ChannelRecord[], channel: AiChannel, metadata: Record<string, unknown> = {}) {
  const admin = createAdminClient();
  const previous = await admin.from("ai_screening_task_items").select("channel_checkpoint").eq("id", taskItemId).maybeSingle();
  if (previous.error) throw previous.error;
  const previousCheckpoint = previous.data?.channel_checkpoint && typeof previous.data.channel_checkpoint === "object"
    ? previous.data.channel_checkpoint as Record<string, unknown> : {};
  const write = await admin.from("ai_screening_task_items").update({
    channel_checkpoint: jsonSafe({ ...previousCheckpoint, ...metadata, records }), checkpoint_version: "1.0", last_completed_channel: channel,
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

async function analyzeWithRecovery(input: {
  taskId: string;
  taskItemId: string;
  customerId: string;
  userId?: string | null;
  attemptNumber: number;
  customer: CustomerRow;
  records: ChannelRecord[];
  signal: AbortSignal;
  tier: "fast" | "deep" | "escalation";
  executionLease?: ExecutionLease;
}) {
  const modelInput = {
    customer_name: input.customer.company_name,
    country: input.customer.country,
    phone: input.customer.phone,
    email: input.customer.email,
    whatsapp: input.customer.whatsapp,
    website: input.customer.website,
    google_url: input.customer.google_url,
    address: input.customer.address,
    industry_keywords: null,
    evidence: evidenceForModel(input.records, input.tier),
  };
  const primaryTimeout = input.tier === "escalation" ? 60_000 : input.tier === "deep" ? 60_000 : 40_000;
  await assertExecutionLease(input.taskItemId, input.executionLease);
  const reserved = await reserveApiCostBudget("OPENAI", openAiBudgetReservationUsd(), {
    userId: input.userId, customerId: input.customerId, taskId: input.taskId, operation: `客户分析-${input.tier}`,
  });
  if (!reserved.allowed) return { analysis: null, requestCount: 0, budgetExceeded: budgetExceededMessage("OPENAI", reserved) };
  let costRecorded = false;
  const run = async (channel: string, timeoutMs: number) => {
    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof analyzeCustomer>>;
    try {
      result = await analyzeCustomer(modelInput, { signal: input.signal, timeoutMs, tier: input.tier });
    } catch (error) {
      await saveModelCall({ ...input, channel, startedAt, status: "FAILED", error });
      costRecorded = true;
      throw error;
    }
    await saveModelCall({ ...input, channel, startedAt, usage: result.usage, status: "COMPLETED" });
    costRecorded = true;
    return result;
  };
  try {
    return { analysis: await run("all_available_sources", primaryTimeout), requestCount: 1, budgetExceeded: null };
  } finally {
    // If audit persistence fails, keep the short-lived reservation active so
    // concurrent workers cannot spend against a call missing from the ledger.
    if (costRecorded) await releaseApiCostBudget(reserved.reservationId);
  }
}

function allCollectedSourcesFailedTechnically(records: ChannelRecord[]) {
  if (records.some((record) => record.status === "COLLECTED")) return false;
  return records.some((record) => record.status === "FAILED"
    && /(?:aborted|fetch failed|network|timeout|timed out|ECONN|EAI_AGAIN|ENOTFOUND|socket|TLS|certificate)/i.test(String(record.error || "")));
}

async function saveVerifiedContacts(input: { taskId: string; resultId: string; customer: CustomerRow; contacts: ContactCandidate[]; preferred?: ContactCandidate | null }) {
  const admin = createAdminClient();
  const existing = await admin.from("customer_contacts")
    .select("id,type,value_normalized,source,verification_status")
    .eq("customer_id", input.customer.id);
  if (existing.error) throw existing.error;
  const existingByKey = new Map((existing.data || []).map((item) => [
    `${String(item.type)}|${String(item.value_normalized)}`,
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
      && item.value_normalized === row.value_normalized);
    const write = match
      ? await admin.from("customer_contacts").update(row).eq("id", match.id)
      : await admin.from("customer_contacts").insert(row);
    if (write.error) throw write.error;
  }
  const audits = input.contacts
    .filter((item) => {
      if (!["MATCHED_ORIGINAL", "NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(item.verificationStatus)) return false;
      const previous = existingByKey.get(`${item.type}|${item.valueNormalized}`);
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

async function completeFromReusableCache(input: { taskId: string; taskItemId: string; customerId: string; strategy: AiStrategy; executionLease?: ExecutionLease }, customer: CustomerRow, cache: Record<string, unknown>, started: number) {
  await assertExecutionLease(input.taskItemId, input.executionLease);
  const admin = createAdminClient();
  const cachedResult = (cache.analysis_result && typeof cache.analysis_result === "object" ? cache.analysis_result : {}) as Record<string, unknown>;
  const cachedScoreValue = Number(cachedResult.score ?? cachedResult.ai_score);
  const cachedScore = Number.isFinite(cachedScoreValue)
    ? Math.max(0, Math.min(100, Math.round(cachedScoreValue)))
    : 20;
  const cachedTargetDecision = cachedResult.target_decision === "VALID" || cachedResult.target_decision === "INVALID"
    ? cachedResult.target_decision
    : "REVIEW";
  const cachedAutomationStatus = cachedResult.automation_status === "AUTO_DEVELOP" || cachedResult.automation_status === "AUTO_REJECT"
    ? cachedResult.automation_status
    : "AUTO_HOLD";
  const normalizedCachedResult = {
    ...cachedResult,
    score: cachedScore,
    grade: scoreToLevel(cachedScore),
    customer_type: cachedResult.customer_type || cachedResult.industry_type || "其他",
    industry_type: cachedResult.industry_type || cachedResult.customer_type || "其他",
    evidence_sufficiency: cachedResult.evidence_sufficiency === "不足" || !cachedResult.evidence_sufficiency
      ? "一般"
      : cachedResult.evidence_sufficiency,
    target_decision: cachedTargetDecision,
    automation_status: cachedAutomationStatus,
    target_fit: cachedTargetDecision === "VALID" ? "TARGET" : "NOT_TARGET",
    lead_priority: cachedResult.lead_priority || "LOW",
    decision_status: cachedResult.decision_status || "AUTO_HOLD",
    manual_review_status: cachedResult.manual_review_status || "NEEDS_REVIEW",
  };
  const now = new Date().toISOString();
  const resultPayload = {
    ...normalizedCachedResult,
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
    industry: normalizedCachedResult.industry_type,
    ai_score: normalizedCachedResult.score,
    ai_level: normalizedCachedResult.grade,
      ai_reason: cachedResult.ai_reason || cachedResult.summary,
      is_target_customer: cachedTargetDecision === "VALID",
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
      ...(customer.google_place_id ? {} : { google_maps_place_id: cachedResult.place_id || null }),
      ...(customer.google_url ? {} : { google_url: cachedResult.verified_google_maps_url || null }),
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

export async function runCustomerAnalysis(input: { taskId: string; taskItemId: string; customerId: string; strategy: AiStrategy; attemptNumber?: number; executionLease?: ExecutionLease }) {
  await assertExecutionLease(input.taskItemId, input.executionLease);
  const started = Date.now();
  // Do not impose one hard timeout on the whole customer. Each public source and
  // model call owns a bounded timeout, while completed source checkpoints remain
  // reusable if a later source is slow or the model call needs retrying.
  const analysisController = new AbortController();
  const customer = await readCustomer(input.customerId);
  const admin = createAdminClient();
  const taskOwnerResult = await admin.from("ai_screening_tasks").select("user_id,filters").eq("id", input.taskId).maybeSingle();
  if (taskOwnerResult.error) throw taskOwnerResult.error;
  const costContext = { taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, userId: taskOwnerResult.data?.user_id || null, executionLease: input.executionLease };
  await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "CUSTOMER_LOADED", startedAt: started });
  // Invalid-result rechecks always execute the current collectors and scoring
  // rules. A full recheck may reuse only a current-rule, strongly evidenced
  // valid result; ambiguous or previously invalid conclusions must run again.
  const reusableCandidate = shouldReuseAnalysisForTask(taskOwnerResult.data?.filters)
    ? await findReusableAnalysis(customer, input.strategy)
    : null;
  // Full rechecks reuse only a current-rule, strongly evidenced valid result.
  // Historical invalid conclusions are the reason users request a recheck and
  // must always execute the current collectors and scoring rules again.
  const reusable = reusableResultAllowedForTask(taskOwnerResult.data?.filters, reusableCandidate)
    ? reusableCandidate : null;
  if (reusable) {
    return completeFromReusableCache(input, customer, reusable as Record<string, unknown>, started);
  }
  const checkpoint = await admin.from("ai_screening_task_items").select("channel_checkpoint").eq("id", input.taskItemId).maybeSingle();
  if (checkpoint.error) throw checkpoint.error;
  const checkpointPayload = checkpoint.data?.channel_checkpoint && typeof checkpoint.data.channel_checkpoint === "object"
    ? checkpoint.data.channel_checkpoint as { records?: ChannelRecord[]; completed_recovery_focuses?: string[]; model_call_baseline?: number } : {};
  const savedRecords = checkpointPayload.records;
  const records: ChannelRecord[] = Array.isArray(savedRecords) ? savedRecords.filter((item) => item && AI_CHANNEL_ORDER.includes(item.channel)) : [];
  const existingModelCalls = await admin.from("ai_screening_model_calls").select("id", { count: "exact", head: true }).eq("task_item_id", input.taskItemId);
  if (existingModelCalls.error) throw existingModelCalls.error;
  let modelRequestCount = Math.max(0, Number(existingModelCalls.count || 0) - Number(checkpointPayload.model_call_baseline || 0));
  let analysis: CustomerAnalysis | null = null;
  let usage = { ...ZERO_USAGE };
  let earlyStopReason: string | null = null;
  let discoveredOfficialWebsite: string | null = null;
  try {
    // Cost-aware staged collection. Read the supplied official website first:
    // it is the most authoritative source for business scope and has no
    // per-request provider fee. If it already proves the entity and industry,
    // do not start Google Places, social collection, or a model call.
    if (!records.some((item) => item.channel === "website" && ["COLLECTED", "SKIPPED"].includes(item.status))) {
      const websiteRecord = await collectChannel(customer, "website", analysisController.signal, costContext);
      records.push(websiteRecord);
      await saveCheckpoint(input.taskItemId, records, "website");
    }
    const websiteIndex = records.findIndex((item) => item.channel === "website");
    let currentWebsite = websiteIndex >= 0 ? records[websiteIndex] : undefined;
    let currentWebsiteVerified = Boolean(currentWebsite && websiteRecordMatchesEntity(customer, records, currentWebsite));
    if (currentWebsite?.status === "COLLECTED" && !currentWebsiteVerified) {
      // 保留页面和失败原因供任务审计，但FAILED记录不会进入模型证据、评分或联系方式写回。
      currentWebsite = { ...currentWebsite, status: "FAILED", error: "官网页面与当前客户主体交叉校验未通过" };
      records[websiteIndex] = currentWebsite;
      await saveCheckpoint(input.taskItemId, records, "website");
    }

    let stagedAnalysis = deterministicAnalysis(customer, records);
    if (!isConclusiveChannelAnalysis(stagedAnalysis)) {
      // A bounded ordinary web-index lookup costs no LLM tokens and often finds
      // the exact official/directory/social page for service-area businesses.
      // Candidate snippets are never evidence; fetched pages still need strict
      // entity matching. This phase runs before paid Places.
      await collectIndexedPublicEvidence({ taskItemId: input.taskItemId, customer, records, signal: analysisController.signal });
      stagedAnalysis = deterministicAnalysis(customer, records);
    }

    if (!isConclusiveChannelAnalysis(stagedAnalysis)
        && hasTargetValueSignal(customer, records)
        && !records.some((item) => item.channel === "google_maps" && ["COLLECTED", "SKIPPED"].includes(item.status))) {
      const googleRecord = await collectChannel(customer, "google_maps", analysisController.signal, costContext);
      records.push(googleRecord);
      await saveCheckpoint(input.taskItemId, records, "google_maps");
    }

    const googleWebsite = verifiedOfficialWebsiteFromGoogle(records);
    if (googleWebsite && !currentWebsiteVerified) {
      const candidate = await collectChannel({ ...customer, website: googleWebsite }, "website", analysisController.signal, costContext);
      if (websiteRecordMatchesEntity(customer, records, candidate)) {
        discoveredOfficialWebsite = googleWebsite;
        // 原网址无法证明主体时，使用Google具体商家绑定且经页面二次核验的官网。
        const index = records.findIndex((item) => item.channel === "website");
        if (index >= 0) records[index] = candidate; else records.push(candidate);
        currentWebsite = candidate;
        currentWebsiteVerified = true;
        await saveCheckpoint(input.taskItemId, records, "website");
      }
    }
    stagedAnalysis = deterministicAnalysis(customer, records);
    // Never spend an LLM + Web Search call merely to locate URLs. The supplied
    // website, zero-token public indexes and Places ID-only search already form
    // the locator layer. The single model allowance is reserved for reasoning
    // over evidence that was fetched and passed entity verification.
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
    // A transport outage is a technical execution failure, not evidence that
    // the company is unrelated. Never turn an executor/network problem into a
    // low-score business conclusion.
    if (allCollectedSourcesFailedTechnically(records)) throw new Error("PUBLIC_SOURCE_NETWORK_UNAVAILABLE");
    analysis = deterministicAnalysis(customer, records);
    if (!isConclusiveChannelAnalysis(analysis) && hasTargetValueSignal(customer, records)) {
      // Google Places and the verified official website can reveal public
      // profiles that were absent from the imported customer row. Include
      // those profiles in this same run instead of merely writing their URL
      // back after the analysis has already finished.
      const expandedCustomer = customerWithDiscoveredPublicChannels(customer, records);
      const secondaryPriority: AiChannel[] = ["facebook", "instagram", "linkedin", "tiktok", "other"];
      const secondaryChannels = secondaryPriority.filter((channel) => Boolean(channelUrl(expandedCustomer, channel)) && !records.some((item) => item.channel === channel));
      for (const channel of secondaryChannels) {
        // Collect one corroborating channel at a time. Once it supplies enough
        // verified evidence, later social channels and the model are skipped.
        const secondary = await collectChannel(expandedCustomer, channel, analysisController.signal, costContext);
        records.push(secondary);
        await saveCheckpoint(input.taskItemId, records, channel);
        const supplemented = deterministicAnalysis(customer, records);
        if (supplemented) analysis = supplemented;
        if (isConclusiveChannelAnalysis(analysis)) {
          earlyStopReason = "补充已确认的官方公开渠道后取得足够直接证据，停止继续采集。";
          break;
        }
      }
    }
    // Hard cost and latency boundary: at most one model-assisted pass per
    // customer. A second call must never be scheduled automatically; any
    // remaining uncertainty is scored from the saved evidence and highlighted.
    const maxModelCalls = 1;
    if (!isConclusiveChannelAnalysis(analysis) && shouldUseModelSupplement(customer, records, analysis)) {
      // Ordinary public indexes and Places have already completed at this
      // point. Never spend a model call merely to search for URLs: web-search
      // context is large, slow and can hit account TPM limits without yielding
      // attributable evidence. The one model allowance is reserved for
      // synthesizing real, already-collected target-adjacent evidence.
      if (!analysis || analysis.evidence_conflicts.length > 0 || analysis.confidence_score < 82) {
        if (!hasUsableCollectedEvidence(records)) {
          analysis = insufficientDataAnalysis(customer, records);
          earlyStopReason = "已完成全部可用公开入口核验，未发现目标业务事实，直接形成低相关结论，不再重复检索或消耗模型费用。";
        } else {
          const remainingModelCalls = maxModelCalls - modelRequestCount;
          if (remainingModelCalls > 0) {
            const outcome = await analyzeWithRecovery({ ...input, userId: costContext.userId, attemptNumber: input.attemptNumber || 1, customer, records, signal: analysisController.signal, tier: "escalation", executionLease: input.executionLease });
            if (outcome.analysis) {
              analysis = outcome.analysis;
              modelRequestCount += outcome.requestCount;
              usage = addUsage(usage, analysis.usage);
              earlyStopReason = "规则无法直接判断时，由高精度模型综合一次全部已采集且通过主体校验的证据。";
            } else {
              analysis = deterministicAnalysis(customer, records) || insufficientDataAnalysis(customer, records);
              earlyStopReason = "OpenAI付费调用未获授权（免费模式、渠道开关或费用上限限制），本客户未调用付费模型，继续依据已采集公开证据和规则完成判断。";
            }
          } else if (!analysis) {
            analysis = insufficientDataAnalysis(customer, records);
            earlyStopReason = "已达到本客户模型调用上限，依据已取得的真实证据形成低相关结论，不进入等待或重复重试。";
          }
        }
      } else {
        earlyStopReason = "系统扩展公开来源后取得可核验直接证据，由规则引擎完成判断。";
      }
    } else {
      earlyStopReason = "已取得可核验的直接行业证据，规则引擎完成判断，未调用大模型。";
    }
    if (!analysis) {
      analysis = insufficientDataAnalysis(customer, records);
      earlyStopReason = "Google商家与已确认官网未显示目标行业事实，直接形成低相关结论；未调用社媒或大模型。";
    }
    const needsEscalation = hasUsableCollectedEvidence(records)
      && analysis.usage.model !== "RULE_ENGINE"
      && modelRequestCount < maxModelCalls
      && (analysis.evidence_conflicts.length > 0
        || analysis.confidence_score < 82
        || analysis.evidence_sufficiency !== "充分"
        || (primaryIndustryFor(analysis.industry_type) !== "UNKNOWN" && (analysis.ai_score ?? 0) < 60));
    if (needsEscalation) {
      const callStarted = Date.now();
      const reserved = await reserveApiCostBudget("OPENAI", openAiBudgetReservationUsd(), {
        userId: costContext.userId, customerId: input.customerId, taskId: input.taskId, operation: "客户分析-final_escalation",
      });
      if (!reserved.allowed) {
        earlyStopReason = "OpenAI付费调用未获授权（免费模式、渠道开关或费用上限限制），未调用最终付费复核；按已取得的真实证据完成判断。";
      } else {
      let escalationCostRecorded = false;
      try {
        const escalated = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: effectiveWebsite(customer),
          google_url: customer.google_url, address: customer.address, phone: customer.phone,
          email: customer.email, whatsapp: customer.whatsapp,
          industry_keywords: null,
          evidence: evidenceForModel(records, "escalation"),
        }, { signal: analysisController.signal, timeoutMs: 45_000, tier: "escalation" });
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, usage: escalated.usage, status: "COMPLETED" });
        escalationCostRecorded = true;
        modelRequestCount += 1;
        usage = addUsage(usage, escalated.usage);
        analysis = escalated;
      } catch (error) {
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, status: "FAILED", error });
        escalationCostRecorded = true;
        if (input.strategy === "DEEP" && analysis.confidence_score < 60) throw error;
      } finally {
        if (escalationCostRecorded) await releaseApiCostBudget(reserved.reservationId);
      }
      }
    }
    await recordStage({ taskId: input.taskId, taskItemId: input.taskItemId, customerId: input.customerId, stage: "MODEL_COMPLETED", startedAt: started, details: { model_calls: usage.model_calls, total_tokens: usage.total_tokens } });

    analysis = finalizeAnalysisAgainstEvidence(customer, records, analysis);
    const identity = resolveIdentity(customer, records, analysis);
    const policyEvidence = policyEvidenceFromAnalysis(analysis);
    let primaryIndustry = primaryIndustryFor(analysis.industry_type);
    const explicitRejectEvidence = policyEvidence.some((item) => item.kind === "矛盾" && isDirectNonTargetBusinessEvidence(item.fact));
    const gate = evaluateEvidenceGate({
      strategy: input.strategy, identityStatus: identity.status, identityConfidence: identity.confidence,
      industryConfidence: analysis.confidence_score, decisionConfidence: analysis.confidence_score,
      score: analysis.ai_score ?? 0, industry: primaryIndustry, evidence: policyEvidence,
      // Verified target and non-target activities may describe a legitimate
      // mixed business. Only unresolved identity conflicts block automation.
      hasCriticalConflict: ["AMBIGUOUS", "CONFLICTED"].includes(identity.status),
      explicitRejectEvidence,
    });
    const hasVerifiedDirectTarget = policyEvidence.some((item) => item.kind === "支持"
      && item.confidence >= 60 && item.strength === "STRONG_DIRECT"
      && hasDirectTargetBusinessEvidence(item.fact));
    const hasPermanentClosureEvidence = policyEvidence.some((item) => item.kind === "矛盾"
      && /永久关闭|永久停业|已永久关闭/.test(item.fact));
    const hasCurrentOfficialWebsiteTarget = policyEvidence.some((item) => item.kind === "支持"
      && item.channel === "website" && item.confidence >= 60
      && item.strength === "STRONG_DIRECT" && hasDirectTargetBusinessEvidence(item.fact));
    const acceptedIdentity = ["MATCHED", "LIKELY_MATCHED"].includes(identity.status);
    if (acceptedIdentity && identity.confidence >= 70 && hasVerifiedDirectTarget
        && (!hasPermanentClosureEvidence || hasCurrentOfficialWebsiteTarget)
        && primaryIndustry !== "UNKNOWN" && Number(analysis.ai_score || 0) >= 60
        && analysis.confidence_score >= 60 && gate.automationStatus !== "AUTO_DEVELOP") {
      // This is an internal consistency failure, not a business conclusion.
      // Never publish a low-score invalid customer when the same payload has
      // already proved an attributable target business; fail visibly so the
      // task can be retried after the rule defect is corrected.
      throw new Error("AI_EVIDENCE_GATE_CONTRADICTION: 已匹配主体和直接目标证据与最终无效结论冲突");
    }
    let finalAutomationStatus = gate.automationStatus;
    let finalGateReason = gate.reason;
    if (gate.automationStatus === "AUTO_HOLD" || !analysis.evidence_summaries.length) {
      const boundedScore = rejectedConclusionScore(analysis, identity.confidence);
      const conciseGateReason = gate.reason.replace(/^重点核对：/, "").replace(/[。；\s]+$/, "");
      const verificationNote = `重点核对：${conciseGateReason}。系统已完成本轮自动分析；因该风险无法把候选经营事实安全归属于当前客户，当前按低相关无效目标处理。`;
      analysis = {
        ...analysis,
        ai_score: boundedScore,
        ai_level: scoreToLevel(boundedScore),
        is_target_customer: false,
        confidence_score: Math.min(79, analysis.confidence_score),
        evidence_conflicts: [...new Set([...analysis.evidence_conflicts, verificationNote])],
      };
      finalAutomationStatus = "AUTO_REJECT";
      finalGateReason = verificationNote;
    }
    analysis = reconcileFinalDecision(
      analysis,
      finalAutomationStatus,
      finalGateReason,
      policyEvidence.some((item) => item.kind === "矛盾" && /永久关闭|永久停业|已永久关闭/.test(item.fact)),
    );
    primaryIndustry = primaryIndustryFor(analysis.industry_type);
    if (finalAutomationStatus === "AUTO_REJECT" && Number(analysis.ai_score || 0) >= 60) {
      const rejectedScore = rejectedConclusionScore(analysis, identity.confidence,
        policyEvidence.some((item) => item.kind === "矛盾" && /永久关闭|永久停业|已永久关闭/.test(item.fact)));
      analysis = { ...analysis, ai_score: rejectedScore, ai_level: "D", is_target_customer: false };
    }
    // Every persisted final result has
    // a real score and grade backed by a valid/invalid evidence-gate decision.
    const publishedScore = analysis.ai_score;
    const publishedLevel = analysis.ai_level;
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
    const businessScope = verifiedBusinessScope(analysis);
    const verifiedScale = verifiedCompanyScale(records);
    analysis = applyVerifiedScaleToSalesConclusion(analysis, verifiedScale);
    const scaleSignals = verifiedScale.companyScaleEvidence ? [verifiedScale.companyScaleEvidence] : [];
    const resultPayload = {
      customer_id: customer.id, task_id: input.taskId, task_item_id: input.taskItemId,
      score: publishedScore, grade: publishedLevel,
      target_decision: compatibilityTargetDecision(finalAutomationStatus), automation_status: finalAutomationStatus,
      customer_type: analysis.industry_type, industry_type: analysis.industry_type,
      primary_industry: primaryIndustry, secondary_industries: [], business_activities: businessScope ? [businessScope] : [],
      business_scope: businessScope,
      company_scale: verifiedScale.companyScale,
      company_scale_evidence: verifiedScale.companyScaleEvidence,
      industry_confidence: analysis.confidence_score, identity_confidence: identity.confidence,
      decision_confidence: analysis.confidence_score, contact_confidence: reconciled.preferred ? (reconciled.preferred.identityStatus === "MATCHED" ? 90 : 55) : 0,
      scale_confidence: scaleSignals.length ? 90 : 0, evidence_sufficiency_score: Math.min(100, policyEvidence.filter((item) => item.kind !== "中性").length * 20),
      identity_status: identity.status, identity_details: identity,
      verified_business_name: identity.verifiedBusinessName, verified_address: identity.verifiedAddress,
      verified_website: identity.verifiedWebsite, verified_google_maps_url: identity.verifiedGoogleMapsUrl,
      place_id: identity.placeId, candidate_count: identity.candidateCount,
      match_signals: identity.matchSignals, mismatch_signals: identity.mismatchSignals,
      industry_evidence_ids: gate.evidenceIds, industry_conflicts: analysis.evidence_conflicts,
      scale_analysis: { scale_level: verifiedScale.companyScale || "UNKNOWN", scale_confidence: scaleSignals.length ? 90 : 0, scale_signals: scaleSignals, location_count: verifiedScale.locationCount ?? (google?.place_id ? 1 : null), review_activity: google?.user_ratings_total || null, procurement_signals: scaleSignals, trade_records: [] },
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
      manual_review_status: "NOT_REVIEWED",
      suggested_contact_order: analysis.suggested_contact_order,
      discovered_contacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps, contacts: reconciled.contacts },
      model_version: usage.model, rule_version: AI_RULE_VERSION, field_mapping_version: AI_FIELD_MAPPING_VERSION,
      verified_industry: primaryIndustry,
      target_fit: finalAutomationStatus === "AUTO_DEVELOP" ? "TARGET" : "NOT_TARGET",
      lead_priority: resultLeadPriority(false, publishedLevel),
      purchase_scale: verifiedScale.companyScale || "UNKNOWN",
      decision_status: finalAutomationStatus,
      short_reason: finalGateReason,
      attempt_number: input.attemptNumber || 1,
      is_latest_valid: false,
      writeback_status: "PENDING",
      writeback_warnings: [],
    };
    await assertExecutionLease(input.taskItemId, input.executionLease);
    const invalidatePrevious = await admin.from("ai_screening_results").update({ is_latest_valid: false }).eq("task_item_id", input.taskItemId).eq("is_latest_valid", true);
    if (invalidatePrevious.error) throw durableError(invalidatePrevious.error, "INVALIDATE_PREVIOUS_RESULT");
    const resultWrite = await admin.from("ai_screening_results").insert(jsonSafe(resultPayload)).select("id").single();
    if (resultWrite.error || !resultWrite.data) throw durableError(resultWrite.error || new Error("RESULT_WRITE_FAILED"), "RESULT_WRITE");

    // A saved model conclusion is only a checkpoint. It is not a completed AI
    // screening until evidence and the customer writeback are both durable.
    const analysisComplete = await admin.from("ai_screening_task_items").update({
      status: "RUNNING",
      analysis_status: "RUNNING",
      writeback_status: "PENDING",
      result_id: resultWrite.data.id,
      automation_status: finalAutomationStatus,
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
      const sourceOriginalExcerpt = (() => {
        if (summary.original_excerpt?.trim()) return summary.original_excerpt.trim().slice(0, 4000);
        if (!source?.evidence) return "";
        if (channel === "google_maps") {
          const item = source.evidence as GooglePlaceEvidence;
          return [item.description, ...(item.reviews || [])].filter(Boolean).join("；").slice(0, 4000);
        }
        const item = source.evidence as WebsiteEvidence;
        return [item.title, item.description, ...(item.structured_descriptions || []), item.text_excerpt].filter(Boolean).join("；").slice(0, 4000);
      })();
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
        original_excerpt: sourceOriginalExcerpt || null,
        original_fact: sourceOriginalExcerpt || normalizedFact,
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
        const evidenceWrite = await admin.from("ai_screening_evidence").insert(jsonSafe(pendingEvidence)).select("id");
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
      industry: analysis.industry_type,
      ai_score: publishedScore, ai_level: publishedLevel,
      ai_reason: analysis.ai_reason,
      // Review is a third state. A score alone must never turn uncertain
      // evidence into a definitive customer classification.
      is_target_customer: finalAutomationStatus === "AUTO_DEVELOP",
      ai_screening_done: true, ai_status: "COMPLETED",
      business_relevance: analysis.business_relevance, customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion, website_email: websiteEmail || null,
      website_phone: websitePhone || null,
      business_scope: businessScope,
      company_scale: verifiedScale.companyScale || customer.company_scale || null,
      company_scale_evidence: verifiedScale.companyScaleEvidence || customer.company_scale_evidence || null,
      ...(!customer.website && discoveredOfficialWebsite && identity.status === "MATCHED"
        ? { website: discoveredOfficialWebsite }
        : {}),
      // AI发现的补充号码保留在customer_contacts并展示来源。主体已由
      // 同名/高度相似名称和完整地址确认、仅号码变化时，也写入带冲突
      // 标记的补充联系方式；始终保留原号码，不静默覆盖客户原始资料。
      // 客户主档。跨客户共用号码可能是集团总机或重复主体，写入主档会
      // 触发全局身份唯一约束，也不应覆盖人工确认的客户身份字段。
      ...(customer.facebook_url ? {} : { facebook_url: firstVerifiedContact(reconciled.contacts, "FACEBOOK") }),
      ...(customer.instagram_url ? {} : { instagram_url: firstVerifiedContact(reconciled.contacts, "INSTAGRAM") }),
      ...(customer.linkedin_url ? {} : { linkedin_url: firstVerifiedContact(reconciled.contacts, "LINKEDIN") }),
      ...(customer.tiktok_url ? {} : { tiktok_url: firstVerifiedContact(reconciled.contacts, "TIKTOK") }),
      ...(customer.google_place_id ? {} : { google_maps_place_id: google?.place_id || null }),
      ...(customer.google_url ? {} : { google_url: google?.verified_google_maps_url || null }),
      ai_last_result_id: resultWrite.data.id,
      ai_last_screened_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    {
      await assertExecutionLease(input.taskItemId, input.executionLease);
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

    await assertExecutionLease(input.taskItemId, input.executionLease);
    let finalItemQuery = admin.from("ai_screening_task_items").update({
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
      analysis_version: ANALYSIS_VERSION,
      duration_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskItemId);
    if (input.executionLease) finalItemQuery = finalItemQuery.eq("lease_owner", input.executionLease.executorId).eq("lease_token", input.executionLease.leaseToken);
    const finalItem = await finalItemQuery;
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
  if (raw.includes("PUBLIC_SOURCE_NETWORK_UNAVAILABLE")) {
    return { code: "PUBLIC_SOURCE_NETWORK_UNAVAILABLE", message: "本次执行节点未能连接任何已尝试的公开来源；未生成客户评分或有效性结论，请在网络链路恢复后重试" };
  }
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

function recoveryChannel(url: string): AiChannel {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/google\.[^/]+$/.test(host) && /\/maps\//i.test(new URL(url).pathname)) return "google_maps";
    if (/linkedin\.com$/.test(host)) return "linkedin";
    if (/(^|\.)facebook\.com$/.test(host)) return "facebook";
    if (/instagram\.com$/.test(host)) return "instagram";
    if (/tiktok\.com$/.test(host)) return "tiktok";
  } catch { /* invalid URL is rejected by the collector */ }
  return "other";
}

function recoveryChannelForCustomer(url: string, customer: CustomerRow): AiChannel {
  const channel = recoveryChannel(url);
  if (channel !== "other") return channel;
  const knownWebsite = effectiveWebsite(customer);
  return knownWebsite && websiteHost(knownWebsite) === websiteHost(url) ? "website" : "other";
}

export function recoveryRecordMatchesEntity(customer: CustomerRow, records: ChannelRecord[], record: ChannelRecord) {
  if (record.status !== "COLLECTED" || !record.evidence) return false;
  const website = record.evidence as WebsiteEvidence;
  const pageText = [website.title, website.description, ...(website.headings || []), website.text_excerpt]
    .filter(Boolean).join(" ");
  const channel = record.channel;
  if (channel === "other") {
    // Directory pages often contain long city indexes and "nearby business"
    // widgets. A customer name appearing somewhere in that flattened body is
    // not an entity match. Require the listing header/structured identity (or
    // its URL slug) to identify this business, then corroborate it with a
    // phone, full address or business-domain signal.
    const identityText = [website.title, website.description, ...(website.structured_names || []), ...(website.headings || []).slice(0, 3)]
      .filter(Boolean).join(" ");
    let sourcePath = "";
    try { sourcePath = decodeURIComponent(new URL(record.source_url || website.url).pathname).replace(/[\/_-]+/g, " "); } catch { /* invalid URL already rejected */ }
    const nameMatch = Math.max(
      identityNameSimilarity(customer.company_name, identityText),
      identityNameSimilarity(customer.company_name, sourcePath),
    ) >= 0.75;
    const originalPhone = normalizePhoneInternational(customer.phone, customer.country);
    const phoneMatch = Boolean(originalPhone && website.phones.some((value) => normalizePhoneInternational(value, customer.country) === originalPhone));
    const addressMatch = addressAppearsOnPage(customer.address, pageText);
    const customerDomain = emailBusinessDomain(customer.email);
    const sourceHost = websiteHost(record.source_url || website.url);
    const emailDomainMatch = Boolean(customerDomain && sourceHost && (sourceHost === customerDomain || sourceHost.endsWith(`.${customerDomain}`)));
    const verifiedGoogleWebsite = verifiedOfficialWebsiteFromGoogle(records);
    const googleOfficialLinkMatch = Boolean(verifiedGoogleWebsite && sourceHost === websiteHost(verifiedGoogleWebsite));
    return googleOfficialLinkMatch || (nameMatch && (phoneMatch || addressMatch || emailDomainMatch));
  }
  // A social profile is not an official website. It may only supplement a
  // result after its name is corroborated by a phone/address signal or a
  // previously verified official link. This prevents same-name profiles from
  // being scored as the imported customer.
  const nameScore = identityNameSimilarity(customer.company_name, pageText);
  const originalPhone = normalizePhoneInternational(customer.phone, customer.country);
  const phoneMatch = Boolean(originalPhone && website.phones.some((value) => normalizePhoneInternational(value, customer.country) === originalPhone));
  const addressTokens = compactIdentity(customer.address).split(/\s+/).filter(Boolean);
  const pageTokens = new Set(compactIdentity(pageText).split(/\s+/));
  const specificAddressTokens = addressTokens.filter((value) => /\d/.test(value));
  const addressMatch = addressTokens.length >= 4 && specificAddressTokens.length > 0
    && specificAddressTokens.every((value) => pageTokens.has(value))
    && addressTokens.filter((value) => pageTokens.has(value)).length / addressTokens.length >= 0.8;
  const verifiedLink = discoveredPublicChannelUrls(customer, records)[channel];
  const canonical = (value?: string | null) => String(value || "").replace(/\/$/, "").toLowerCase();
  const officialLinkMatch = Boolean(verifiedLink && canonical(verifiedLink) === canonical(record.source_url));
  return officialLinkMatch || (nameScore >= 0.75 && (phoneMatch || addressMatch));
}

async function collectIndexedPublicEvidence(input: {
  taskItemId: string;
  customer: CustomerRow;
  records: ChannelRecord[];
  signal: AbortSignal;
}) {
  const indexedUrls = await discoverPublicBusinessUrls({
    company_name: input.customer.company_name,
    address: input.customer.address,
    phone: input.customer.phone,
    country: input.customer.country,
  }, { signal: input.signal, timeoutMs: 8_000 });
  return collectLocatedPublicEvidence({ ...input, urls: indexedUrls });
}

async function collectLocatedPublicEvidence(input: {
  taskItemId: string;
  customer: CustomerRow;
  records: ChannelRecord[];
  signal: AbortSignal;
  urls: string[];
  costContext?: { taskId: string; customerId: string; userId: string | null };
}) {
  // The index only discovers candidates. Fetch a small bounded set, and never
  // score snippets. Every accepted page must independently pass the normal
  // name plus address/phone/domain identity gate.
  const rankedUrls = [...new Set(input.urls)].map((url, index) => ({
    url,
    index,
    score: /google\.[^/]+\/maps\/place|maps\.app\.goo\.gl/i.test(url) ? 6
      : /(?:repair|repar|serwis|napraw|维修)/i.test(url) ? 4
      : /(?:phone|mobile|handy|computer|laptop|gsm)/i.test(url) ? 1 : 0,
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const existingGoogle = input.records.find((record) => record.channel === "google_maps" && record.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  const hasMatchedGoogle = Boolean(existingGoogle
    && ["MATCHED", "LIKELY_MATCHED"].includes(String(existingGoogle.identity_status))
    && Number(existingGoogle.identity_confidence || 0) >= 70);
  const googleUrls = rankedUrls.filter(({ url }) => /google\.[^/]+\/maps\/place|maps\.app\.goo\.gl/i.test(url)).slice(0, 2);
  const ordinaryUrls = rankedUrls.filter(({ url }) => !/google\.[^/]+\/maps\/place|maps\.app\.goo\.gl/i.test(url)).slice(0, 6);
  const acceptedGoogle: ChannelRecord[] = [];
  if (!hasMatchedGoogle) {
    // Google candidates are expensive full evidence collectors. Evaluate them
    // sequentially and stop at the first verified merchant instead of running
    // several complete Places chains in parallel for one customer.
    for (const { url } of googleUrls) {
      try {
        const google = await collectPublicGooglePlaceEvidence({
          company_name: input.customer.company_name,
          country: input.customer.country,
          address: input.customer.address,
          phone: input.customer.phone,
          website: effectiveWebsite(input.customer),
          google_url: url,
        }, { signal: input.signal, timeoutMs: 4_500 });
        const record: ChannelRecord = { channel: "google_maps", status: google ? "COLLECTED" : "FAILED", source_url: url, evidence: google, error: google?.error || null };
        if (record.status === "COLLECTED" && google?.identity_status === "MATCHED"
            && Number(google.identity_confidence || 0) >= 70) {
          acceptedGoogle.push(record);
          break;
        }
      } catch { /* keep evaluating bounded ordinary candidates */ }
    }
  }
  const indexedRecords = await mapWithConcurrency(ordinaryUrls, 2, async ({ url }): Promise<ChannelRecord | null> => {
    const channel = recoveryChannelForCustomer(url, input.customer);
    try {
      const evidence = await collectPublicPageEvidence(url, { signal: input.signal, timeoutMs: 4_000 });
      if (!evidence?.reachable) return null;
      const record: ChannelRecord = { channel, status: "COLLECTED", source_url: evidence.url || url, evidence };
      return recoveryRecordMatchesEntity(input.customer, input.records, record) ? record : null;
    } catch { return null; }
  });
  const accepted = [...acceptedGoogle, ...indexedRecords.filter((item): item is ChannelRecord => Boolean(item))];
  for (const record of accepted) {
    const canonicalUrl = String(record.source_url || "").replace(/\/$/, "").toLowerCase();
    if (input.records.some((saved) => String(saved.source_url || "").replace(/\/$/, "").toLowerCase() === canonicalUrl)) continue;
    const sameChannel = record.channel === "google_maps"
      ? input.records.findIndex((saved) => saved.channel === "google_maps")
      : record.channel === "website"
      ? input.records.findIndex((saved) => saved.channel === "website" && saved.status !== "COLLECTED")
      : -1;
    if (sameChannel >= 0) {
      if (record.channel === "google_maps") {
        const current = input.records[sameChannel]?.evidence as GooglePlaceEvidence | undefined;
        const candidate = record.evidence as GooglePlaceEvidence | undefined;
        if (Number(candidate?.identity_confidence || 0) > Number(current?.identity_confidence || 0)) input.records[sameChannel] = record;
      } else input.records[sameChannel] = record;
    }
    else input.records.push(record);
  }
  if (accepted.length) await saveCheckpoint(input.taskItemId, input.records, "other");
  return accepted.length;
}
