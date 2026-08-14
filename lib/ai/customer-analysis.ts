import { AI_INDUSTRIES } from "@/lib/types";
import type { CustomerEvidence } from "@/lib/ai/web-enrichment";

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

const systemPrompt = `你是 DTSmart CRM 的B2B客户筛选专家。只能依据输入资料和官网/Google证据判断，不得编造事实。
目标行业：手机维修店、手机配件批发商、手机配件零售商、手机进口商、电脑维修店、电脑配件批发商；无法确认时归类为其他。
评分：85-100为A，70-84为B，50-69为C，0-49为D。只有评分不低于60且有明确业务证据时，is_target_customer才为true。
ai_reason必须引用实际证据，并说明业务相关性、客户价值和下一步跟进建议。`;

export async function analyzeCustomer(input: CustomerAnalysisInput): Promise<CustomerAnalysis> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_NOT_CONFIGURED");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
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
              },
              required: ["industry_type", "is_target_customer", "ai_score", "ai_level", "ai_reason", "business_relevance", "customer_value", "followup_suggestion"],
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

  let parsed: CustomerAnalysis;
  try {
    parsed = JSON.parse(responseText(payload)) as CustomerAnalysis;
  } catch {
    throw new Error("OPENAI_INVALID_JSON");
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.ai_score) || 0)));
  if (!AI_INDUSTRIES.includes(parsed.industry_type)) throw new Error("OPENAI_INVALID_INDUSTRY");
  return { ...parsed, ai_score: score, ai_level: scoreToLevel(score), is_target_customer: score >= 60 };
}
