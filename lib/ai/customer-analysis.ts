import { AI_INDUSTRIES } from "../types";
import type { CustomerEvidence } from "./web-enrichment";

export type CustomerAnalysisInput = {
  customer_name: string;
  country?: string | null;
  website?: string | null;
  google_url?: string | null;
  address?: string | null;
  industry_keywords?: string | null;
  product_image_information?: string | null;
  evidence?: CustomerEvidence;
};

export type CustomerAnalysis = {
  industry_type: (typeof AI_INDUSTRIES)[number];
  is_target_customer: boolean;
  ai_score: number;
  ai_level: "A" | "B" | "C" | "D";
  ai_reason: string;
  business_relevance: string;
  customer_value: string;
  followup_suggestion: string;
  confidence_score: number;
  evidence_sufficiency: "充分" | "一般" | "不足";
  evidence_conflicts: string[];
  usage: {
    model: string;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number;
    pricing_snapshot: Record<string, number | string>;
  };
};

export function scoreToLevel(score: number): CustomerAnalysis["ai_level"] {
  return score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
}

function responseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const chunks: string[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : []) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) chunks.push(text);
    }
  }
  const result = chunks.join("\n").trim();
  if (!result) throw new Error("OPENAI_EMPTY_RESPONSE");
  return result.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

const systemPrompt = `你是 DTSmart TradeOS 的B2B客户筛选专家。只能依据输入的可核对公开证据判断，不得编造事实。
我们的业务是一站式手机和电脑配件外贸批发，目标客户应具备手机/电脑维修、配件批发、配件零售、进口分销或明确的相关采购可能。
目标行业：手机维修店、手机配件批发商、手机配件零售商、手机进口商、电脑维修店、电脑配件批发商；无法确认时归类为其他。
评分：85-100为A，70-84为B，50-69为C，0-49为D。只有评分不低于60且有明确业务证据时，is_target_customer才为true。
confidence_score表示当前证据足以支持结论的可信度，不等同于客户价值分；没有公开证据时必须降低可信度并明确说明。
ai_reason必须引用实际证据；business_relevance、customer_value和followup_suggestion必须可供销售直接使用。evidence_conflicts列出证据矛盾，没有则返回空数组。`;

export async function analyzeCustomer(input: CustomerAnalysisInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CustomerAnalysis> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_NOT_CONFIGURED");

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 18_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "customer_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                industry_type: { type: "string", enum: AI_INDUSTRIES },
                is_target_customer: { type: "boolean" },
                ai_score: { type: "integer", minimum: 0, maximum: 100 },
                ai_level: { type: "string", enum: ["A", "B", "C", "D"] },
                ai_reason: { type: "string" },
                business_relevance: { type: "string" },
                customer_value: { type: "string" },
                followup_suggestion: { type: "string" },
                confidence_score: { type: "integer", minimum: 0, maximum: 100 },
                evidence_sufficiency: { type: "string", enum: ["充分", "一般", "不足"] },
                evidence_conflicts: { type: "array", items: { type: "string" } },
              },
              required: ["industry_type", "is_target_customer", "ai_score", "ai_level", "ai_reason", "business_relevance", "customer_value", "followup_suggestion", "confidence_score", "evidence_sufficiency", "evidence_conflicts"],
            },
          },
        },
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("OPENAI_TIMEOUT");
    throw new Error(`OPENAI_NETWORK_ERROR:${error instanceof Error ? error.message : "unknown"}`);
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const apiError = payload.error;
    const detail = apiError && typeof apiError === "object" && typeof (apiError as { message?: unknown }).message === "string"
      ? (apiError as { message: string }).message
      : `HTTP_${response.status}`;
    throw new Error(`OPENAI_API_ERROR:${detail}`);
  }

  let parsed: Omit<CustomerAnalysis, "usage">;
  try {
    parsed = JSON.parse(responseText(payload)) as Omit<CustomerAnalysis, "usage">;
  } catch {
    throw new Error("OPENAI_INVALID_JSON");
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.ai_score) || 0)));
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence_score) || 0)));
  if (!AI_INDUSTRIES.includes(parsed.industry_type)) throw new Error("OPENAI_INVALID_INDUSTRY");
  const usagePayload = (payload.usage && typeof payload.usage === "object" ? payload.usage : {}) as {
    input_tokens?: number; output_tokens?: number; total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  const inputTokens = Number(usagePayload.input_tokens || 0);
  const cachedTokens = Number(usagePayload.input_tokens_details?.cached_tokens || 0);
  const outputTokens = Number(usagePayload.output_tokens || 0);
  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  const inputPrice = Number(process.env.OPENAI_INPUT_PRICE_PER_MILLION || 0.15);
  const cachedPrice = Number(process.env.OPENAI_CACHED_INPUT_PRICE_PER_MILLION || 0.075);
  const outputPrice = Number(process.env.OPENAI_OUTPUT_PRICE_PER_MILLION || 0.6);
  const cost = (uncachedInput * inputPrice + cachedTokens * cachedPrice + outputTokens * outputPrice) / 1_000_000;
  return {
    ...parsed,
    ai_score: score,
    confidence_score: confidence,
    ai_level: scoreToLevel(score),
    is_target_customer: score >= 60 && confidence >= 60,
    evidence_conflicts: Array.isArray(parsed.evidence_conflicts) ? parsed.evidence_conflicts.filter(Boolean).slice(0, 20) : [],
    usage: {
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedTokens,
      output_tokens: outputTokens,
      total_tokens: Number(usagePayload.total_tokens || inputTokens + outputTokens),
      cost_usd: Number(cost.toFixed(6)),
      pricing_snapshot: { currency: "USD", unit: "per_million_tokens", input: inputPrice, cached_input: cachedPrice, output: outputPrice },
    },
  };
}
