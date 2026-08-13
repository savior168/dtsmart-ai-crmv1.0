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
  ai_level: "S" | "A" | "B" | "C" | "D";
  ai_reason: string;
};

export function scoreToLevel(score: number): CustomerAnalysis["ai_level"] {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  throw new Error("OpenAI 未返回可解析的分析结果");
}

const systemPrompt = `
你是DTSmart的B2B客户校验专家，任务是代替人工初筛客户是否值得营销。

目标客户定义：
1. 明确经营手机维修、手机配件批发、手机配件零售、手机进口、电脑维修、电脑配件批发的企业。
2. 有采购手机/电脑配件、维修零件、屏幕、电池、充电器、手机壳、数据线、电脑维修件可能性的客户。
3. 官网、Google商家类型、评论、图片alt、业务描述、产品词越明确，分数越高。

必须选择一个行业分类：
手机维修店、手机配件批发商、手机配件零售商、手机进口商、电脑维修店、电脑配件批发商、其他。

评分规则：
90-100：S，证据非常明确，官网/Google/描述均强相关，可直接作为重点潜在客户。
80-89：A，强相关，有明确维修/配件/批发/进口业务证据。
60-79：B，相关但证据不完整，可进入潜在客户池人工营销。
40-59：C，弱相关或信息不足，不作为优先潜在客户。
0-39：D，无关行业或明显不是目标行业。

硬性要求：
- 60分及以上才是目标潜在客户。
- 无关行业必须归为“其他”，通常低于40分。
- 信息不足时必须降分，不能编造事实。
- ai_reason必须写出证据来源，例如官网标题、业务描述、Google类型、评论关键词、图片alt或缺失原因。
- 如果Google Places未配置或官网不可访问，要在理由里说明，并基于剩余证据保守打分。
`.trim();

export async function analyzeCustomer(input: CustomerAnalysisInput): Promise<CustomerAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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
              ai_level: { type: "string", enum: ["S", "A", "B", "C", "D"] },
              ai_reason: { type: "string" },
            },
            required: ["industry_type", "is_target_customer", "ai_score", "ai_level", "ai_reason"],
          },
        },
      },
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const apiError = payload.error && typeof payload.error === "object" ? (payload.error as { message?: string }).message : undefined;
    throw new Error(apiError || `OpenAI 请求失败 (${response.status})`);
  }
  const parsed = JSON.parse(responseText(payload)) as CustomerAnalysis;
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.ai_score) || 0)));
  if (!AI_INDUSTRIES.includes(parsed.industry_type)) throw new Error("OpenAI 返回了无效行业分类");
  return { ...parsed, ai_score: score, ai_level: scoreToLevel(score), is_target_customer: score >= 60 };
}
