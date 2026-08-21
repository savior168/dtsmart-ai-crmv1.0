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

type CustomerRow = {
  id: string;
  company_name: string;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  google_url: string | null;
  address: string | null;
  industry: string | null;
  category: string | null;
  source: string | null;
  tags: string[] | null;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  other_public_urls?: string[] | null;
};

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
    const key = normalizePhone(value);
    if (!key || originalSet.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
}

function evidenceForModel(records: ChannelRecord[]): CustomerEvidence {
  const publicChannels: Record<string, WebsiteEvidence> = {};
  for (const item of records) {
    if (item.status !== "COLLECTED" || !item.evidence) continue;
    if (item.channel === "website") continue;
    if (item.channel === "google_maps") continue;
    publicChannels[item.channel] = item.evidence as WebsiteEvidence;
  }
  return {
    website: records.find((item) => item.channel === "website" && item.status === "COLLECTED")?.evidence as WebsiteEvidence | undefined,
    google_place: records.find((item) => item.channel === "google_maps" && item.status === "COLLECTED")?.evidence as GooglePlaceEvidence | undefined,
    public_channels: publicChannels,
  };
}

function evidenceContent(item: ChannelRecord) {
  if (!item.evidence) return null;
  const raw = JSON.stringify(item.evidence);
  return raw.length > 45_000 ? `${raw.slice(0, 45_000)}…` : raw;
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
  const extended = "id,company_name,country,phone,email,website,google_url,address,industry,category,source,tags,linkedin_url,facebook_url,instagram_url,tiktok_url,other_public_urls";
  const { data, error } = await admin.from("customers").select(extended).eq("id", customerId).is("deleted_at", null).maybeSingle();
  if (!error && data) return data as unknown as CustomerRow;
  const fallback = await admin.from("customers").select("id,company_name,country,phone,email,website,google_url,address,industry,category,source,tags").eq("id", customerId).is("deleted_at", null).single();
  if (fallback.error || !fallback.data) throw fallback.error || new Error("CUSTOMER_NOT_FOUND");
  return fallback.data as CustomerRow;
}

export async function runCustomerAnalysis(input: { taskId: string; taskItemId: string; customerId: string; strategy: AiStrategy }) {
  const started = Date.now();
  const timeoutController = new AbortController();
  const hardTimeout = setTimeout(() => timeoutController.abort(), 30_000);
  const customer = await readCustomer(input.customerId);
  const records: ChannelRecord[] = [];
  let analysis: CustomerAnalysis | null = null;
  let usage = { ...ZERO_USAGE };
  let earlyStopReason: string | null = null;
  try {
    if (input.strategy === "DEEP") {
      for (const channel of AI_CHANNEL_ORDER) {
        if (timeoutController.signal.aborted) throw new Error("CUSTOMER_ANALYSIS_TIMEOUT");
        records.push(await collectChannel(customer, channel, timeoutController.signal));
      }
      analysis = await analyzeCustomer({
        customer_name: customer.company_name, country: customer.country, website: customer.website,
        google_url: customer.google_url, address: customer.address,
        industry_keywords: [customer.industry, customer.category, customer.source, ...(customer.tags || [])].filter(Boolean).join(" / "),
        evidence: evidenceForModel(records),
      }, { signal: timeoutController.signal, timeoutMs: 14_000 });
      usage = addUsage(usage, analysis.usage);
    } else {
      for (const channel of AI_CHANNEL_ORDER) {
        if (timeoutController.signal.aborted) throw new Error("CUSTOMER_ANALYSIS_TIMEOUT");
        records.push(await collectChannel(customer, channel, timeoutController.signal));
        if (!records.some((item) => item.status === "COLLECTED")) continue;
        analysis = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: [customer.industry, customer.category, customer.source, ...(customer.tags || [])].filter(Boolean).join(" / "),
          evidence: evidenceForModel(records),
        }, { signal: timeoutController.signal, timeoutMs: 11_000 });
        usage = addUsage(usage, analysis.usage);
        if (analysis.is_target_customer && analysis.confidence_score > 90 && analysis.evidence_conflicts.length === 0) {
          earlyStopReason = `完成${AI_CHANNEL_LABELS[channel]}后，目标客户可信度${analysis.confidence_score}分且无关键矛盾`;
          break;
        }
      }
      if (!analysis) {
        analysis = await analyzeCustomer({
          customer_name: customer.company_name, country: customer.country, website: customer.website,
          google_url: customer.google_url, address: customer.address,
          industry_keywords: [customer.industry, customer.category, customer.source, ...(customer.tags || [])].filter(Boolean).join(" / "),
          evidence: evidenceForModel(records),
        }, { signal: timeoutController.signal, timeoutMs: 11_000 });
        usage = addUsage(usage, analysis.usage);
      }
    }
    if (timeoutController.signal.aborted) throw new Error("CUSTOMER_ANALYSIS_TIMEOUT");

    const website = records.find((item) => item.channel === "website")?.evidence as WebsiteEvidence | undefined;
    const google = records.find((item) => item.channel === "google_maps")?.evidence as GooglePlaceEvidence | undefined;
    const websiteEmail = newEmails(customer.email, [...(website?.emails || []), ...(google?.emails || [])]);
    const websitePhone = newPhones(customer.phone, [...(website?.phones || []), google?.phone || ""]);
    const admin = createAdminClient();
    const analyzedChannels = records.filter((item) => item.status === "COLLECTED").map((item) => item.channel);
    const skippedChannels = records.filter((item) => item.status !== "COLLECTED").map((item) => ({ channel: item.channel, status: item.status, reason: item.error }));
    const resultInsert = await admin.from("ai_screening_results").insert({
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
    }).select("id").single();
    if (resultInsert.error || !resultInsert.data) throw resultInsert.error || new Error("RESULT_WRITE_FAILED");

    const evidenceRows = records.map((item) => ({
      result_id: resultInsert.data.id, task_id: input.taskId, customer_id: customer.id,
      evidence_type: AI_CHANNEL_LABELS[item.channel], channel: item.channel,
      source_url: item.source_url || null, title: item.evidence && "title" in item.evidence ? item.evidence.title || null : item.evidence && "name" in item.evidence ? item.evidence.name || null : null,
      content: evidenceContent(item), metadata: item.evidence || {}, status: item.status,
      error_code: item.status === "FAILED" ? item.error || "FETCH_FAILED" : null,
      content_hash: item.evidence ? createHash("sha256").update(JSON.stringify(item.evidence)).digest("hex") : null,
    }));
    if (evidenceRows.length) {
      const evidenceWrite = await admin.from("ai_screening_evidence").insert(evidenceRows);
      if (evidenceWrite.error) throw evidenceWrite.error;
    }

    const customerUpdate = {
      industry: analysis.industry_type, ai_score: analysis.ai_score, ai_level: analysis.ai_level,
      ai_reason: analysis.ai_reason, is_target_customer: analysis.is_target_customer,
      ai_screening_done: true, ai_status: "COMPLETED",
      business_relevance: analysis.business_relevance, customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion, website_email: websiteEmail || null,
      website_phone: websitePhone || null, ai_last_result_id: resultInsert.data.id,
      ai_last_screened_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    let customerWrite = await admin.from("customers").update(customerUpdate).eq("id", customer.id);
    if (customerWrite.error) {
      customerWrite = await admin.from("customers").update({
        industry: analysis.industry_type, ai_score: analysis.ai_score, ai_level: analysis.ai_level, ai_reason: analysis.ai_reason,
      }).eq("id", customer.id);
    }
    if (customerWrite.error) throw customerWrite.error;

    const itemWrite = await admin.from("ai_screening_task_items").update({
      status: "COMPLETED", progress: 100, current_step: "WRITTEN_BACK", error_message: null, error_code: null,
      analyzed_channels: analyzedChannels, skipped_channels: skippedChannels, early_stop_reason: earlyStopReason,
      input_tokens: usage.input_tokens, cached_input_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, cost_usd: usage.cost_usd,
      duration_ms: Date.now() - started, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", input.taskItemId);
    if (itemWrite.error) throw itemWrite.error;
    await admin.rpc("refresh_ai_screening_task_totals", { p_task_id: input.taskId });
    return { status: "COMPLETED" as const, resultId: resultInsert.data.id };
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
