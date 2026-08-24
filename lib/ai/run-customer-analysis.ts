import { createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { analyzeCustomer, type CustomerAnalysis } from "./customer-analysis";
import {
  collectDeepWebsiteEvidence,
  collectGooglePlaceEvidence,
  collectPublicPageEvidence,
  isPlausiblePhone,
  type CustomerEvidence,
  type GooglePlaceEvidence,
  type WebsiteEvidence,
} from "@/lib/ai/web-enrichment";
import { AI_CHANNEL_LABELS, AI_CHANNEL_ORDER, type AiChannel, type AiStrategy } from "./task-types";
import { AI_FIELD_MAPPING_VERSION, mapCustomerForAi, type AiMappedCustomer } from "./semantic-fields";
import { AI_RULE_VERSION, findReusableAnalysis, saveReusableAnalysis } from "./reuse-cache";

type CustomerRow = AiMappedCustomer;

type ChannelRecord = {
  channel: AiChannel;
  status: "COLLECTED" | "SKIPPED" | "FAILED";
  source_url?: string | null;
  evidence?: WebsiteEvidence | GooglePlaceEvidence;
  error?: string | null;
};

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

function newEmails(original: string | null, values: string[]) {
  const originalSet = new Set(String(original || "").split(",").map(normalizeEmail).filter(Boolean));
  return [...new Set(values.map(normalizeEmail).filter(Boolean).filter((value) => !originalSet.has(value)))].join(", ");
}

function newPhones(original: string | null, values: string[]) {
  const originalSet = new Set(String(original || "").split(",").map(normalizePhone).filter(Boolean));
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    if (!isPlausiblePhone(value)) return false;
    const key = normalizePhone(value);
    if (!key || originalSet.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
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
        ? await collectGooglePlaceEvidence({ company_name: customer.company_name, country: customer.country, address: customer.address, google_url: customer.google_url }, { signal, timeoutMs: 4500 })
        : await collectPublicPageEvidence(url, { signal, timeoutMs: 3500 });
    if (!evidence) return { channel, status: "SKIPPED", source_url: url, error: "没有可读取的公开入口" };
    const failed = "reachable" in evidence ? !evidence.reachable : Boolean(evidence.error && !evidence.name);
    return { channel, status: failed ? "FAILED" : "COLLECTED", source_url: url, evidence, error: evidence.error || null };
  } catch (error) {
    if (signal.aborted) throw new Error("CUSTOMER_ANALYSIS_TIMEOUT");
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

async function saveSupplementalContacts(customer: CustomerRow, contacts: { websiteEmail: string; websitePhone: string; whatsapps: string[] }, records: ChannelRecord[]) {
  const admin = createAdminClient();
  const rows: Array<Record<string, unknown>> = [];
  const sourceUrl = records.find((item) => item.status === "COLLECTED" && item.source_url)?.source_url || null;
  for (const value of contacts.websiteEmail.split(",").map((item) => item.trim()).filter(Boolean)) rows.push({ customer_id: customer.id, type: "EMAIL", value_raw: value, value_normalized: normalizeEmail(value), source: "AI_PUBLIC_SOURCE", source_url: sourceUrl, identity_match_status: "likely_matched", verification_status: "SOURCE_CONFIRMED" });
  for (const value of contacts.websitePhone.split(",").map((item) => item.trim()).filter(Boolean)) rows.push({ customer_id: customer.id, type: "PHONE", value_raw: value, value_normalized: normalizePhone(value), source: "AI_PUBLIC_SOURCE", source_url: sourceUrl, identity_match_status: "likely_matched", verification_status: "SOURCE_CONFIRMED" });
  for (const value of contacts.whatsapps) rows.push({ customer_id: customer.id, type: "WHATSAPP", value_raw: value, value_normalized: normalizePhone(value), source: "AI_PUBLIC_SOURCE", source_url: sourceUrl, identity_match_status: "likely_matched", verification_status: "SOURCE_CONFIRMED" });
  if (!rows.length) return;
  const write = await admin.from("customer_contacts").upsert(rows, { onConflict: "customer_id,type,value_normalized,source", ignoreDuplicates: true });
  if (write.error && !/source_url|identity_match_status|verification_status|constraint|schema cache/i.test(write.error.message)) throw write.error;
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
    const rows = snapshots.map((row) => ({ ...(row as Record<string, unknown>), id: undefined, result_id: resultWrite.data.id, task_id: input.taskId, customer_id: customer.id, fetched_at: now, captured_at: now }));
    const evidenceWrite = await admin.from("ai_screening_evidence").insert(rows);
    if (evidenceWrite.error) throw evidenceWrite.error;
  }
  const discovered = (cache.discovered_contacts && typeof cache.discovered_contacts === "object" ? cache.discovered_contacts : {}) as { website_email?: string; website_phone?: string; whatsapp?: string[] };
  const customerWrite = await admin.from("customers").update({
    industry: cachedResult.industry_type || cachedResult.customer_type,
    ai_score: cachedResult.score,
    ai_level: cachedResult.grade,
    ai_reason: cachedResult.ai_reason || cachedResult.summary,
    is_target_customer: cachedResult.target_decision === "VALID",
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
  await saveSupplementalContacts(customer, { websiteEmail: discovered.website_email || "", websitePhone: discovered.website_phone || "", whatsapps: discovered.whatsapp || [] }, []);
  const itemWrite = await admin.from("ai_screening_task_items").update({ status: "COMPLETED", progress: 100, current_step: "REUSED_RESULT", cache_reused: true, reuse_source_result_id: cache.source_result_id || null, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, completed_at: now, updated_at: now }).eq("id", input.taskItemId);
  if (itemWrite.error) throw itemWrite.error;
  await admin.from("ai_screening_model_calls").upsert({ task_id: input.taskId, task_item_id: input.taskItemId, customer_id: customer.id, channel: "cross_user_result_reuse", attempt_number: 1, model: "REUSED_RESULT", model_version: String((cachedResult.model_snapshot as Record<string, unknown> | undefined)?.primary_model || "REUSED_RESULT"), input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, pricing_snapshot: { reused: true }, cost_usd: 0, status: "COMPLETED", cache_hit: true, completed_at: now, duration_ms: Date.now() - started }, { onConflict: "task_item_id,channel,attempt_number" });
  await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
  return { status: "COMPLETED" as const, resultId: resultWrite.data.id, reused: true };
}

export async function runCustomerAnalysis(input: { taskId: string; taskItemId: string; customerId: string; strategy: AiStrategy; attemptNumber?: number }) {
  const started = Date.now();
  const timeoutController = new AbortController();
  const hardTimeout = setTimeout(() => timeoutController.abort(), 30_000);
  const customer = await readCustomer(input.customerId);
  const admin = createAdminClient();
  const reusable = await findReusableAnalysis(customer, input.strategy);
  if (reusable) {
    clearTimeout(hardTimeout);
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
    const pendingChannels = AI_CHANNEL_ORDER.filter((channel) => !records.some((item) => item.channel === channel && ["COLLECTED", "SKIPPED"].includes(item.status)));
    if (pendingChannels.length) {
      const collected = await Promise.all(pendingChannels.map((channel) => collectChannel(customer, channel, timeoutController.signal)));
      for (const current of collected) {
        const index = records.findIndex((item) => item.channel === current.channel);
        if (index >= 0) records[index] = current; else records.push(current);
      }
      await saveCheckpoint(input.taskItemId, records, pendingChannels[pendingChannels.length - 1]);
    }
    if (input.strategy === "DEEP") {
      const callStarted = Date.now();
      try {
        analysis = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: [customer.industry, customer.category, ...customer.tags].filter(Boolean).join(" / "),
          evidence: evidenceForModel(records),
        }, { signal: timeoutController.signal, timeoutMs: 14_000, tier: "deep" });
        await saveModelCall({ ...input, channel: "all_available_sources", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, usage: analysis.usage, status: "COMPLETED" });
      } catch (error) {
        await saveModelCall({ ...input, channel: "all_available_sources", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, status: "FAILED", error });
        throw error;
      }
      usage = addUsage(usage, analysis.usage);
    } else {
      const callStarted = Date.now();
      try {
        analysis = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: [customer.industry, customer.category, ...customer.tags].filter(Boolean).join(" / "),
          evidence: evidenceForModel(records),
        }, { signal: timeoutController.signal, timeoutMs: 12_000, tier: "fast" });
        await saveModelCall({ ...input, channel: "all_available_sources", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, usage: analysis.usage, status: "COMPLETED" });
      } catch (error) {
        await saveModelCall({ ...input, channel: "all_available_sources", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, status: "FAILED", error });
        throw error;
      }
      usage = addUsage(usage, analysis.usage);
      earlyStopReason = "已并行读取全部可用公开来源，并用一次模型调用完成综合判断";
    }
    if (timeoutController.signal.aborted) throw new Error("CUSTOMER_ANALYSIS_TIMEOUT");
    const needsEscalation = analysis.evidence_conflicts.length > 0
      || (analysis.ai_score >= 70 && analysis.confidence_score < (input.strategy === "DEEP" ? 95 : 90))
      || (analysis.evidence_sufficiency !== "不足" && analysis.confidence_score < 55);
    if (needsEscalation && !timeoutController.signal.aborted) {
      const callStarted = Date.now();
      try {
        const escalated = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: [customer.industry, customer.category, ...customer.tags].filter(Boolean).join(" / "),
          evidence: evidenceForModel(records),
        }, { signal: timeoutController.signal, timeoutMs: 10_000, tier: "escalation" });
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, usage: escalated.usage, status: "COMPLETED" });
        usage = addUsage(usage, escalated.usage);
        analysis = escalated;
      } catch (error) {
        await saveModelCall({ ...input, channel: "final_escalation", attemptNumber: input.attemptNumber || 1, startedAt: callStarted, status: "FAILED", error });
        if (input.strategy === "DEEP" && analysis.confidence_score < 60) throw error;
      }
    }

    const websiteRecords = records
      .filter((item) => item.status === "COLLECTED" && item.channel !== "google_maps")
      .map((item) => item.evidence as WebsiteEvidence);
    const google = records.find((item) => item.channel === "google_maps")?.evidence as GooglePlaceEvidence | undefined;
    const discoveredEmails = [...websiteRecords.flatMap((item) => item?.emails || []), ...(google?.emails || [])];
    const discoveredPhones = [...websiteRecords.flatMap((item) => [...(item?.phones || []), ...(item?.whatsapps || [])]), google?.phone || ""];
    const discoveredWhatsapps = [...new Set(websiteRecords.flatMap((item) => item?.whatsapps || []).map((item) => item.trim()).filter(Boolean))];
    const websiteEmail = newEmails(customer.email, discoveredEmails);
    const websitePhone = newPhones(customer.phone, discoveredPhones);
    const analyzedChannels = records.filter((item) => item.status === "COLLECTED").map((item) => item.channel);
    const skippedChannels = records.filter((item) => item.status !== "COLLECTED").map((item) => ({ channel: item.channel, status: item.status, reason: item.error }));
    const resultPayload = {
      customer_id: customer.id, task_id: input.taskId, task_item_id: input.taskItemId,
      score: analysis.ai_score, grade: analysis.ai_level,
      target_decision: analysis.is_target_customer ? "VALID" : "INVALID",
      customer_type: analysis.industry_type, industry_type: analysis.industry_type,
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
      entity_match: { score: analysis.score_breakdown.entity_consistency, status: analysis.score_breakdown.entity_consistency >= 70 ? "MATCHED" : "NEEDS_REVIEW" },
      manual_review_status: analysis.confidence_score < 60 || analysis.evidence_sufficiency === "不足" ? "NEEDS_REVIEW" : "NOT_REVIEWED",
      suggested_contact_order: analysis.suggested_contact_order,
      discovered_contacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps },
      model_version: usage.model, rule_version: AI_RULE_VERSION, field_mapping_version: AI_FIELD_MAPPING_VERSION,
    };
    const previousResult = await admin.from("ai_screening_results").select("id").eq("task_item_id", input.taskItemId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previousResult.error) throw previousResult.error;
    const resultWrite = previousResult.data
      ? await admin.from("ai_screening_results").update(resultPayload).eq("id", previousResult.data.id).select("id").single()
      : await admin.from("ai_screening_results").insert(resultPayload).select("id").single();
    if (resultWrite.error || !resultWrite.data) throw resultWrite.error || new Error("RESULT_WRITE_FAILED");

    const entityConsistency = analysis.score_breakdown.entity_consistency;
    // Failed/skipped channels are audit limitations, never business evidence.
    const readableEvidence = analysis.evidence_summaries;
    const evidenceRows = readableEvidence.map((summary) => {
      const channel = AI_CHANNEL_ORDER.includes(summary.channel as AiChannel) ? summary.channel as AiChannel : "other";
      const source = records.find((item) => item.channel === channel);
      const normalizedFact = summary.fact_zh.trim().slice(0, 1600);
      const acquiredByPublicSearch = source?.status !== "COLLECTED";
      return {
        result_id: resultWrite.data.id, task_id: input.taskId, customer_id: customer.id,
        evidence_type: summary.evidence_type, channel,
        source_url: summary.source_url || source?.source_url || null,
        title: summary.title_zh.trim().slice(0, 180) || `${AI_CHANNEL_LABELS[channel]}关键依据`,
        content: normalizedFact,
        raw_excerpt: normalizedFact,
        normalized_fact: normalizedFact,
        identity_match_status: entityConsistency >= 75 ? "matched" : entityConsistency >= 55 ? "likely_matched" : "unverified",
        supports: summary.evidence_type === "支持" ? "目标客户判断" : null,
        contradicts: summary.evidence_type === "矛盾" ? "目标客户判断" : null,
        evidence_confidence: Math.max(0, Math.min(100, Math.round(summary.confidence || 0))),
        metadata: {
          channel,
          status: "COLLECTED",
          acquisition: acquiredByPublicSearch ? "OPENAI_WEB_SEARCH" : "DIRECT_SOURCE_READ",
          media_urls: source?.evidence && "image_urls" in source.evidence
            ? [...source.evidence.image_urls, ...("video_urls" in source.evidence ? source.evidence.video_urls || [] : [])].slice(0, 16)
            : [],
        },
        status: "COLLECTED",
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
      industry: analysis.industry_type, ai_score: analysis.ai_score, ai_level: analysis.ai_level,
      ai_reason: analysis.ai_reason, is_target_customer: analysis.is_target_customer,
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
    await saveSupplementalContacts(customer, { websiteEmail, websitePhone, whatsapps: discoveredWhatsapps }, records);

    const itemWrite = await admin.from("ai_screening_task_items").update({
      status: "COMPLETED", progress: 100, current_step: "WRITTEN_BACK", error_message: null, error_code: null,
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
      discoveredContacts: { website_email: websiteEmail || null, website_phone: websitePhone || null, whatsapp: discoveredWhatsapps },
      modelSnapshot: { primary_model: usage.model, rule_version: AI_RULE_VERSION },
    });
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
    return { status: "COMPLETED" as const, resultId: resultWrite.data.id };
  } finally {
    clearTimeout(hardTimeout);
  }
}

export function publicAiError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
  if (raw.includes("CUSTOMER_ANALYSIS_TIMEOUT") || raw.includes("OPENAI_TIMEOUT")) return { code: "CUSTOMER_ANALYSIS_TIMEOUT", message: "单个客户分析超过30秒，已自动跳过并继续下一个客户" };
  if (raw.includes("OPENAI_NOT_CONFIGURED")) return { code: "OPENAI_NOT_CONFIGURED", message: "生产环境未配置OpenAI API密钥" };
  if (raw.includes("OPENAI_API_ERROR")) return { code: "OPENAI_API_ERROR", message: raw.replace(/^.*OPENAI_API_ERROR:/, "OpenAI接口错误：") };
  if (raw.includes("GOOGLE_MAPS_API_KEY_NOT_CONFIGURED")) return { code: "GOOGLE_MAPS_NOT_CONFIGURED", message: "未配置Google Maps API，已保留其他公开渠道证据" };
  return { code: "AI_ANALYSIS_FAILED", message: raw || "AI分析失败" };
}
