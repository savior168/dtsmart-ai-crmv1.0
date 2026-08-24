import { createHash } from "node:crypto";
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

type CustomerRow = AiMappedCustomer;

export type ChannelRecord = {
  channel: AiChannel;
  status: "COLLECTED" | "SKIPPED" | "FAILED";
  source_url?: string | null;
  evidence?: WebsiteEvidence | GooglePlaceEvidence;
  error?: string | null;
};

const ANALYSIS_VERSION = "2026.08.24.2";

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
  const nameScore = Math.round(identitySimilarity(customer.company_name, pageText) * 50);
  const originalPhone = normalizePhone(customer.phone);
  const phoneMatch = Boolean(originalPhone && website.phones.some((item) => normalizePhone(item) === originalPhone));
  const emailDomain = normalizeEmail(customer.email).split("@")[1] || "";
  let websiteDomain = ""; try { websiteDomain = new URL(website.url).hostname.replace(/^www\./, ""); } catch { /* invalid source */ }
  const emailMatch = Boolean(emailDomain && websiteDomain && (emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`)));
  const addressMatch = Boolean(customer.address && compactIdentity(pageText).includes(compactIdentity(customer.address).slice(0, 24)));
  const score = Math.min(100, nameScore + (phoneMatch ? 25 : 0) + (emailMatch ? 20 : 0) + (addressMatch ? 20 : 0));
  const signals = [nameScore >= 35 ? "官网名称与客户名称一致" : "", phoneMatch ? "官网电话与原始电话一致" : "", emailMatch ? "原始邮箱域名与官网一致" : "", addressMatch ? "官网地址与原始地址一致" : ""].filter(Boolean);
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

function evidenceForModel(records: ChannelRecord[]): CustomerEvidence {
  const publicChannels: Record<string, WebsiteEvidence> = {};
  const compactWebsite = (item: WebsiteEvidence): WebsiteEvidence => ({
    ...item,
    headings: (item.headings || []).slice(0, 16),
    text_excerpt: item.text_excerpt?.slice(0, 5000),
    image_alts: (item.image_alts || []).slice(0, 16),
    image_urls: (item.image_urls || []).slice(0, 10),
    video_urls: (item.video_urls || []).slice(0, 6),
    emails: (item.emails || []).slice(0, 12),
    phones: (item.phones || []).slice(0, 12),
    whatsapps: (item.whatsapps || []).slice(0, 8),
    pages: (item.pages || []).slice(0, 6).map((page) => ({ ...page, headings: page.headings.slice(0, 8), text_excerpt: page.text_excerpt?.slice(0, 1800), image_alts: page.image_alts.slice(0, 8), image_urls: page.image_urls.slice(0, 6), emails: page.emails.slice(0, 8), phones: page.phones.slice(0, 8) })),
  });
  for (const item of records) {
    if (item.status !== "COLLECTED" || !item.evidence) continue;
    if (item.channel === "website") continue;
    if (item.channel === "google_maps") continue;
    publicChannels[item.channel] = compactWebsite(item.evidence as WebsiteEvidence);
  }
  const google = records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined;
  return {
    website: (() => { const value = records.find((item) => item.channel === "website" && item.status === "COLLECTED")?.evidence as WebsiteEvidence | undefined; return value ? compactWebsite(value) : undefined; })(),
    google_place: google ? { ...google, reviews: (google.reviews || []).slice(0, 5).map((review) => review.slice(0, 700)), types: (google.types || []).slice(0, 12) } : undefined,
    public_channels: publicChannels,
  };
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
  const write = await admin.from("ai_screening_model_calls").upsert({
    task_id: input.taskId, task_item_id: input.taskItemId, customer_id: input.customerId,
    channel: input.channel, attempt_number: input.attemptNumber, model: usage.model || null,
    model_version: usage.model || null, input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cached_input_tokens, output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens, pricing_snapshot: usage.pricing_snapshot,
    cost_usd: usage.cost_usd, status: input.status, cache_hit: usage.cached_input_tokens > 0,
    started_at: new Date(input.startedAt).toISOString(), completed_at: new Date().toISOString(),
    duration_ms: Date.now() - input.startedAt,
    error_code: input.status === "FAILED" ? publicAiError(input.error).code : null,
    error_message: input.status === "FAILED" ? publicAiError(input.error).message : null,
  }, { onConflict: "task_item_id,channel,attempt_number" });
  if (write.error) throw write.error;
}

function canRecoverModelCall(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /OPENAI_TIMEOUT|OPENAI_NETWORK_ERROR|OPENAI_API_ERROR:(?:HTTP_)?(?:429|500|502|503|504)/i.test(message);
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
}) {
  const modelInput = {
    customer_name: input.customer.company_name,
    country: input.customer.country,
    website: input.customer.website,
    google_url: input.customer.google_url,
    address: input.customer.address,
    industry_keywords: null,
    evidence: evidenceForModel(input.records),
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
    return await run("all_available_sources", primaryTimeout);
  } catch (error) {
    if (!canRecoverModelCall(error)) throw error;
    // The evidence checkpoint is already stored. Retry only the model synthesis,
    // never re-crawl the customer or discard facts collected by the first pass.
    return run("all_available_sources_retry", retryTimeout);
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
  };
  const resultWrite = await admin.from("ai_screening_results").insert(resultPayload).select("id").single();
  if (resultWrite.error || !resultWrite.data) throw resultWrite.error || new Error("REUSED_RESULT_WRITE_FAILED");
  const snapshots = Array.isArray(cache.evidence_snapshot) ? cache.evidence_snapshot : [];
  if (snapshots.length) {
    const rows = snapshots.map((row, index) => {
      const source = row as Record<string, unknown>;
      return { ...source, id: undefined, result_id: resultWrite.data.id, task_id: input.taskId, customer_id: customer.id, source_id: `${String(source.source_id || "SRC")}-R${resultWrite.data.id.slice(0, 8)}-${index}`, captured_at: source.captured_at || source.fetched_at || cache.original_captured_at || cache.captured_at, fetched_at: source.fetched_at || source.captured_at || cache.original_captured_at || cache.captured_at, metadata: { ...((source.metadata as Record<string, unknown>) || {}), cache_reused: true, reused_at: now, source_result_id: cache.source_result_id } };
    });
    const evidenceWrite = await admin.from("ai_screening_evidence").insert(rows);
    if (evidenceWrite.error) throw evidenceWrite.error;
  }
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
    await saveVerifiedContacts({ taskId: input.taskId, resultId: resultWrite.data.id, customer, contacts: discovered.contacts, preferred });
  }
  const itemWrite = await admin.from("ai_screening_task_items").update({ status: "COMPLETED", automation_status: String(cachedResult.automation_status || "AUTO_HOLD"), retry_at: cachedResult.retry_at || null, progress: 100, current_step: "REUSED_RESULT", cache_reused: true, reuse_source_result_id: cache.source_result_id || null, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, completed_at: now, updated_at: now }).eq("id", input.taskItemId);
  if (itemWrite.error) throw itemWrite.error;
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
    const strategyChannels = input.strategy === "DEEP" ? AI_CHANNEL_ORDER : (["website", "google_maps"] as AiChannel[]);
    const pendingChannels = strategyChannels.filter((channel) => !records.some((item) => item.channel === channel && ["COLLECTED", "SKIPPED"].includes(item.status)));
    if (pendingChannels.length) {
      const collected = await Promise.all(pendingChannels.map((channel) => collectChannel(customer, channel, analysisController.signal)));
      for (const current of collected) {
        const index = records.findIndex((item) => item.channel === current.channel);
        if (index >= 0) records[index] = current; else records.push(current);
      }
      await saveCheckpoint(input.taskItemId, records, pendingChannels[pendingChannels.length - 1]);
    }
    if (input.strategy === "DEEP") {
      analysis = await analyzeWithRecovery({ ...input, attemptNumber: input.attemptNumber || 1, customer, records, signal: analysisController.signal, tier: "deep" });
      usage = addUsage(usage, analysis.usage);
    } else {
      analysis = await analyzeWithRecovery({ ...input, attemptNumber: input.attemptNumber || 1, customer, records, signal: analysisController.signal, tier: "fast" });
      usage = addUsage(usage, analysis.usage);
      earlyStopReason = "已并行读取全部可用公开来源，并用一次模型调用完成综合判断";
    }
    const needsEscalation = analysis.evidence_conflicts.length > 0;
    if (needsEscalation) {
      const callStarted = Date.now();
      try {
        const escalated = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: null,
          evidence: evidenceForModel(records),
        }, { signal: analysisController.signal, timeoutMs: 45_000, tier: "escalation" });
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, usage: escalated.usage, status: "COMPLETED" });
        usage = addUsage(usage, escalated.usage);
        analysis = escalated;
      } catch (error) {
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, status: "FAILED", error });
        if (input.strategy === "DEEP" && analysis.confidence_score < 60) throw error;
      }
    }

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
    };
    const previousResult = await admin.from("ai_screening_results").select("id").eq("task_item_id", input.taskItemId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previousResult.error) throw previousResult.error;
    const resultWrite = previousResult.data
      ? await admin.from("ai_screening_results").update(resultPayload).eq("id", previousResult.data.id).select("id").single()
      : await admin.from("ai_screening_results").insert(resultPayload).select("id").single();
    if (resultWrite.error || !resultWrite.data) throw resultWrite.error || new Error("RESULT_WRITE_FAILED");

    // Failed/skipped channels are audit limitations, never business evidence.
    const readableEvidence = analysis.evidence_summaries;
    const evidenceRows = readableEvidence.map((summary) => {
      const channel = AI_CHANNEL_ORDER.includes(summary.channel as AiChannel) ? summary.channel as AiChannel : "other";
      const source = records.find((item) => item.channel === channel);
      const normalizedFact = summary.fact_zh.trim().slice(0, 1600);
      const acquiredByPublicSearch = source?.status !== "COLLECTED";
      const policy = policyEvidence.find((item) => item.channel === summary.channel && item.sourceUrl === summary.source_url && item.fact === summary.fact_zh);
      return {
        result_id: resultWrite.data.id, task_id: input.taskId, customer_id: customer.id,
        source_id: policy?.sourceId || sourceId(channel, summary.source_url || source?.source_url || "", normalizedFact),
        evidence_type: summary.evidence_type, channel,
        source_url: summary.source_url || source?.source_url || null,
        title: summary.title_zh.trim().slice(0, 180) || `${AI_CHANNEL_LABELS[channel]}关键依据`,
        page_title: summary.title_zh.trim().slice(0, 180) || null,
        content: normalizedFact,
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
    if (evidenceRows.length) {
      const existingEvidence = await admin.from("ai_screening_evidence").select("content_hash").eq("result_id", resultWrite.data.id);
      if (existingEvidence.error) throw existingEvidence.error;
      const completedEvidence = new Set((existingEvidence.data || []).map((row) => row.content_hash).filter(Boolean));
      const pendingEvidence = evidenceRows.filter((row) => !completedEvidence.has(row.content_hash));
      if (pendingEvidence.length) {
        const evidenceWrite = await admin.from("ai_screening_evidence").insert(pendingEvidence);
        if (evidenceWrite.error) throw evidenceWrite.error;
      }
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
    let customerWrite = await admin.from("customers").update(customerUpdate).eq("id", customer.id);
    if (customerWrite.error) {
      customerWrite = await admin.from("customers").update({
        industry: analysis.industry_type, ai_score: analysis.ai_score, ai_level: analysis.ai_level, ai_reason: analysis.ai_reason,
      }).eq("id", customer.id);
    }
    if (customerWrite.error) throw customerWrite.error;
    await saveVerifiedContacts({ taskId: input.taskId, resultId: resultWrite.data.id, customer, contacts: reconciled.contacts, preferred: reconciled.preferred });

    const itemWrite = await admin.from("ai_screening_task_items").update({
      status: "COMPLETED", automation_status: gate.automationStatus, retry_at: retryAt,
      progress: 100, current_step: "WRITTEN_BACK", error_message: null, error_code: null,
      analyzed_channels: analyzedChannels, skipped_channels: skippedChannels, early_stop_reason: earlyStopReason,
      input_tokens: usage.input_tokens, cached_input_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, cost_usd: usage.cost_usd,
      duration_ms: Date.now() - started, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", input.taskItemId);
    if (itemWrite.error) throw itemWrite.error;
    await saveReusableAnalysis({
      customer,
      strategy: input.strategy,
      resultId: resultWrite.data.id,
      analysisResult: resultPayload as unknown as Record<string, unknown>,
      evidenceSnapshot: evidenceRows as unknown as Array<Record<string, unknown>>,
      discoveredContacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps, contacts: reconciled.contacts },
      modelSnapshot: { primary_model: usage.model, rule_version: AI_RULE_VERSION },
    });
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
    return { status: "COMPLETED" as const, resultId: resultWrite.data.id };
  } finally {
    analysisController.abort();
  }
}

export function publicAiError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
  if (raw.includes("OPENAI_TIMEOUT")) return { code: "OPENAI_TIMEOUT", message: "AI综合判断本次响应超时；已保存公开来源抓取进度，可直接重试而无需重复抓取" };
  if (raw.includes("OPENAI_NOT_CONFIGURED")) return { code: "OPENAI_NOT_CONFIGURED", message: "生产环境未配置OpenAI API密钥" };
  if (raw.includes("OPENAI_API_ERROR")) return { code: "OPENAI_API_ERROR", message: raw.replace(/^.*OPENAI_API_ERROR:/, "OpenAI接口错误：") };
  if (raw.includes("GOOGLE_MAPS_API_KEY_NOT_CONFIGURED")) return { code: "GOOGLE_MAPS_NOT_CONFIGURED", message: "未配置Google Maps API，已保留其他公开渠道证据" };
  return { code: "AI_ANALYSIS_FAILED", message: raw || "AI分析失败" };
}

