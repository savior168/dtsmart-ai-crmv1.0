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
  score_breakdown: {
    entity_consistency: number;
    company_authenticity: number;
    business_activity: number;
    mobile_parts_match: number;
    macbook_parts_match: number;
    wholesale_import_distribution: number;
    repair_business_match: number;
    bulk_purchase_potential: number;
    contactability: number;
    evidence_completeness: number;
    contradiction_risk: number;
  };
  suggested_contact_order: string[];
  evidence_summaries: Array<{
    channel: string;
    title_zh: string;
    fact_zh: string;
    source_url: string;
    evidence_type: "支持" | "矛盾" | "中性";
    confidence: number;
  }>;
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

export type AnalysisTier = "fast" | "deep" | "escalation";

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
我们的业务是一站式手机和电脑维修配件外贸批发，核心产品包括手机/LCD/OLED屏幕、触摸屏总成、iPhone和MacBook屏幕、电池、MacBook键盘及上盖、充电尾插和排线、马达、摄像头、听筒、扬声器、麦克风、内部排线、主板维修配件、维修工具和耗材。
A级高价值客户优先包括配件进口商、批发商、代理/经销/分销商、为维修门店供货的供应商、多门店维修连锁、具有海关采购记录或专业展会证据且有批量采购能力的企业。B级潜在客户包括稳定经营的手机/iPhone/MacBook/电脑维修店、兼营配件的门店及有持续补货需求的电商卖家。
个人消费者、纯软件公司、无关企业、只卖整机且无维修配件业务的商家、官方直营店、无配件采购业务的运营商营业厅、永久停业机构和主体无法核实的数据通常不是目标客户。
电话或邮箱缺失不能直接判为非目标；单独出现mobile、phone、computer等词也不能直接判为目标。必须结合主体一致性、经营范围、产品/服务、活跃度、批发进口属性和采购可能性。
EXCEL_IMPORT、MANUAL、CSV、IMPORT及类似内部来源、导入方式或任务标签只表示数据如何进入系统，绝不是进口商、批发商或任何行业属性证据，严禁用于行业归类和评分。
目标行业：手机维修店、手机配件批发商、手机配件零售商、手机进口商、电脑维修店、电脑配件批发商；无法确认时归类为其他。
评分：85-100为A，70-84为B，50-69为C，0-49为D。只有评分不低于60且有明确业务证据时，is_target_customer才为true。
confidence_score表示当前证据足以支持结论的可信度，不等同于客户价值分；没有公开证据时必须降低可信度并明确说明。
ai_reason必须引用实际证据；business_relevance、customer_value和followup_suggestion必须可供销售直接使用。evidence_conflicts列出证据矛盾，没有则返回空数组。
score_breakdown的每个维度必须依据输入证据独立评分；contradiction_risk越高表示风险越大。suggested_contact_order按优先顺序给出实际可执行的联系渠道或动作。
所有给业务员阅读的文字必须使用简体中文。evidence_summaries只可摘录输入中真实存在的事实，每个已成功读取的来源提炼2–5条简洁中文事实；事实应直接说明“来源页面实际显示了什么”和“它支持或限制什么判断”，不得输出原始JSON、网页代码、空泛套话或未经视觉读取的图片内容。图片和视频只能提供真实可点击地址供人工核验，未实际读取画面时不得描述画面。每条事实必须带真实source_url；无法核验的内容不要写入。`;

function modelForTier(tier: AnalysisTier) {
  if (tier === "escalation") return process.env.OPENAI_ESCALATION_MODEL?.trim() || process.env.OPENAI_DEEP_MODEL?.trim() || "gpt-5.6-sol";
  if (tier === "deep") return process.env.OPENAI_DEEP_MODEL?.trim() || "gpt-5.6-terra";
  return process.env.OPENAI_SMART_MODEL?.trim() || "gpt-5.6-luna";
}

function hasChinese(value: unknown): value is string {
  return typeof value === "string" && /[\u3400-\u9fff]/.test(value) && !/^[\s]*[\[{]/.test(value);
}

function normalizedUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.hash = "";
    return `${url.origin}${url.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch { return ""; }
}

function allowedEvidenceUrls(input: CustomerAnalysisInput) {
  const urls = new Set<string>();
  const add = (value: unknown) => { const normalized = normalizedUrl(value); if (normalized) urls.add(normalized); };
  const website = input.evidence?.website;
  if (website?.reachable) {
    add(website.url);
    website.pages?.forEach((page) => add(page.url));
  }
  Object.values(input.evidence?.public_channels || {}).forEach((channel) => {
    if (!channel.reachable) return;
    add(channel.url);
    channel.pages?.forEach((page) => add(page.url));
  });
  if (input.evidence?.google_place?.name) {
    add(input.google_url);
    add(input.evidence.google_place.website);
  }
  return urls;
}

function sameOrChildUrl(candidate: string, allowed: Set<string>) {
  const normalized = normalizedUrl(candidate);
  if (!normalized) return false;
  return [...allowed].some((source) => normalized === source || normalized.startsWith(`${source}/`) || source.startsWith(`${normalized}/`));
}

function sourceOrigin(value: string) {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin.toLowerCase(); }
  catch { return ""; }
}

function ensureChinese(value: unknown, fallback: string) {
  return hasChinese(value) ? value.trim().slice(0, 1800) : fallback;
}

function cleanEvidenceText(value: string) {
  return value
    .replace(/\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)/gi, "")
    .replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/gi, "")
    .replace(/Mobile Phone Repair Shop/gi, "手机维修店")
    .replace(/Cell Phone Store/gi, "手机零售店")
    .replace(/Computer Repair Service/gi, "电脑维修服务")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1600);
}

/** Enforces evidence-to-conclusion consistency after the model response. */
export function groundCustomerAnalysis(input: CustomerAnalysisInput, analysis: Omit<CustomerAnalysis, "usage">, additionalAllowedUrls: string[] = []): Omit<CustomerAnalysis, "usage"> {
  const allowedUrls = allowedEvidenceUrls(input);
  additionalAllowedUrls.forEach((url) => { const normalized = normalizedUrl(url); if (normalized) allowedUrls.add(normalized); });
  const evidence = (Array.isArray(analysis.evidence_summaries) ? analysis.evidence_summaries : [])
    .filter((item) => item && hasChinese(item.fact_zh) && hasChinese(item.title_zh) && sameOrChildUrl(item.source_url, allowedUrls))
    .map((item) => ({ ...item, title_zh: cleanEvidenceText(item.title_zh).slice(0, 180), fact_zh: cleanEvidenceText(item.fact_zh), confidence: Math.max(0, Math.min(100, Math.round(Number(item.confidence) || 0))) }))
    .filter((item) => item.fact_zh && !/GOOGLE_MAPS_API_KEY|fetch failed|EXCEL_IMPORT|MANUAL|CSV_IMPORT/i.test(item.fact_zh))
    .slice(0, 24);
  const supporting = evidence.filter((item) => item.evidence_type === "支持" && item.confidence >= 60);
  const independentSources = new Set(supporting.map((item) => sourceOrigin(item.source_url)).filter(Boolean)).size;
  const evidenceSufficient = supporting.length >= 2 && independentSources >= 1;
  const strongEnoughForHighConfidence = supporting.length >= 2 && independentSources >= 2;
  let score = Math.max(0, Math.min(100, Math.round(Number(analysis.ai_score) || 0)));
  let confidence = Math.max(0, Math.min(100, Math.round(Number(analysis.confidence_score) || 0)));
  if (!evidenceSufficient) {
    score = Math.min(score, 49);
    confidence = Math.min(confidence, evidence.length ? 49 : 25);
  } else if (!strongEnoughForHighConfidence) {
    confidence = Math.min(confidence, 79);
    score = Math.min(score, 84);
  }
  const evidenceLead = supporting.slice(0, 3).map((item) => item.fact_zh.replace(/[。；]+$/, "")).join("；");
  const insufficientReason = evidence.length
    ? "本次仅取得有限的可核验公开信息，证据不足以确认其行业属性和批量采购能力，建议人工核验或补充公开入口后重新分析。"
    : "本次未取得可追溯的公开页面证据，暂不能确认该客户是否属于目标行业，请补充有效官网、谷歌地图或企业主页后重新分析。";
  const aiReason = evidenceSufficient
    ? `公开证据显示：${evidenceLead}。据此将其归类为“${analysis.industry_type}”，综合评分${score}分；采购规模与实际需求仍需销售沟通确认。`
    : insufficientReason;
  const scoreBreakdown = evidenceSufficient ? analysis.score_breakdown : {
    entity_consistency: Math.min(49, Number(analysis.score_breakdown?.entity_consistency) || 0),
    company_authenticity: Math.min(49, Number(analysis.score_breakdown?.company_authenticity) || 0),
    business_activity: Math.min(49, Number(analysis.score_breakdown?.business_activity) || 0),
    mobile_parts_match: 0,
    macbook_parts_match: 0,
    wholesale_import_distribution: 0,
    repair_business_match: 0,
    bulk_purchase_potential: 0,
    contactability: Math.min(49, Number(analysis.score_breakdown?.contactability) || 0),
    evidence_completeness: Math.min(25, Number(analysis.score_breakdown?.evidence_completeness) || 0),
    contradiction_risk: Math.max(60, Number(analysis.score_breakdown?.contradiction_risk) || 0),
  };
  return {
    ...analysis,
    ai_score: score,
    ai_level: scoreToLevel(score),
    is_target_customer: evidenceSufficient && score >= 60 && confidence >= 60,
    confidence_score: confidence,
    evidence_sufficiency: evidenceSufficient ? (strongEnoughForHighConfidence ? analysis.evidence_sufficiency : "一般") : "不足",
    ai_reason: aiReason,
    business_relevance: evidenceSufficient ? `业务相关性依据：${evidenceLead}。以上事实与手机、电脑维修配件业务的匹配程度已计入评分。` : insufficientReason,
    customer_value: evidenceSufficient ? ensureChinese(analysis.customer_value, "已取得业务相关证据，但采购规模仍需销售首次沟通确认。") : "待核验：当前公开证据不足，不能可靠判断采购价值。",
    followup_suggestion: evidenceSufficient ? ensureChinese(analysis.followup_suggestion, "优先通过已核验的联系方式确认经营范围、采购频次和配件需求。") : "先核验企业主体并补充有效公开入口，证据充分后再制定销售开发计划。",
    score_breakdown: scoreBreakdown,
    evidence_conflicts: (Array.isArray(analysis.evidence_conflicts) ? analysis.evidence_conflicts : []).filter(hasChinese).slice(0, 20),
    suggested_contact_order: (Array.isArray(analysis.suggested_contact_order) ? analysis.suggested_contact_order : []).filter(Boolean).slice(0, 6),
    evidence_summaries: evidence,
  };
}

function webSearchSources(payload: Record<string, unknown>) {
  const urls = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "url" && typeof child === "string" && /^https?:\/\//i.test(child)) urls.add(child);
      else visit(child);
    }
  };
  // Responses may expose sources on web_search_call.action.sources and/or
  // message output_text annotations. Traverse the complete output so both
  // representations are accepted, but never accept URLs merely echoed by the model.
  visit(payload.output);
  return [...urls];
}

function pricingForModel(model: string) {
  const configured = process.env.OPENAI_MODEL_PRICING_JSON?.trim();
  if (configured) {
    try {
      const all = JSON.parse(configured) as Record<string, { input?: number; cached_input?: number; output?: number }>;
      const exact = all[model];
      if (exact) return { input: Number(exact.input || 0), cached_input: Number(exact.cached_input || 0), output: Number(exact.output || 0), source: "OPENAI_MODEL_PRICING_JSON" };
    } catch { /* invalid optional configuration falls back to versioned defaults */ }
  }
  const snapshots: Record<string, { input: number; cached_input: number; output: number }> = {
    "gpt-5.6-luna": { input: 0.2, cached_input: 0.02, output: 1.2 },
    "gpt-5.6-terra": { input: 2, cached_input: 0.2, output: 12 },
    "gpt-5.6-sol": { input: 5, cached_input: 0.5, output: 30 },
  };
  const known = snapshots[model];
  return {
    input: Number(process.env.OPENAI_INPUT_PRICE_PER_MILLION || known?.input || 0),
    cached_input: Number(process.env.OPENAI_CACHED_INPUT_PRICE_PER_MILLION || known?.cached_input || 0),
    output: Number(process.env.OPENAI_OUTPUT_PRICE_PER_MILLION || known?.output || 0),
    source: known ? "OPENAI_PRICING_2026_08_21" : "ENV_OR_UNCONFIGURED",
  };
}

export async function analyzeCustomer(input: CustomerAnalysisInput, options: { signal?: AbortSignal; timeoutMs?: number; tier?: AnalysisTier } = {}): Promise<CustomerAnalysis> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_NOT_CONFIGURED");

  const model = modelForTier(options.tier || "fast");
  const hasDirectEvidence = Boolean(input.evidence?.website?.reachable)
    || Object.values(input.evidence?.public_channels || {}).some((item) => item.reachable)
    || Boolean(input.evidence?.google_place?.name);
  const needsPublicSearch = !hasDirectEvidence || Boolean(input.google_url && input.evidence?.google_place?.configured === false);
  const publicSearchInstruction = needsPublicSearch
    ? `\n结构化公开证据不足。请立即使用网页检索工具核验该企业，优先检索精确企业名称“${input.customer_name}”、国家/地址“${[input.country, input.address].filter(Boolean).join(" ")}”以及谷歌地图入口“${input.google_url || "未提供"}”。只有网页检索实际返回并带URL引用的事实才能写入evidence_summaries；无法从公开网页确认的电话、地址、营业时间、评分、评论、图片或行业不得猜测。`
    : "";
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
        ...(needsPublicSearch ? {
          tools: [{ type: "web_search", search_context_size: options.tier === "deep" ? "medium" : "low" }],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
        } : {}),
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: `${JSON.stringify(input)}${publicSearchInstruction}` }] },
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
                score_breakdown: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    entity_consistency: { type: "integer", minimum: 0, maximum: 100 },
                    company_authenticity: { type: "integer", minimum: 0, maximum: 100 },
                    business_activity: { type: "integer", minimum: 0, maximum: 100 },
                    mobile_parts_match: { type: "integer", minimum: 0, maximum: 100 },
                    macbook_parts_match: { type: "integer", minimum: 0, maximum: 100 },
                    wholesale_import_distribution: { type: "integer", minimum: 0, maximum: 100 },
                    repair_business_match: { type: "integer", minimum: 0, maximum: 100 },
                    bulk_purchase_potential: { type: "integer", minimum: 0, maximum: 100 },
                    contactability: { type: "integer", minimum: 0, maximum: 100 },
                    evidence_completeness: { type: "integer", minimum: 0, maximum: 100 },
                    contradiction_risk: { type: "integer", minimum: 0, maximum: 100 },
                  },
                  required: ["entity_consistency", "company_authenticity", "business_activity", "mobile_parts_match", "macbook_parts_match", "wholesale_import_distribution", "repair_business_match", "bulk_purchase_potential", "contactability", "evidence_completeness", "contradiction_risk"],
                },
                suggested_contact_order: { type: "array", items: { type: "string" }, maxItems: 6 },
                evidence_summaries: {
                  type: "array",
                  maxItems: 24,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      channel: { type: "string" },
                      title_zh: { type: "string" },
                      fact_zh: { type: "string" },
                      source_url: { type: "string" },
                      evidence_type: { type: "string", enum: ["支持", "矛盾", "中性"] },
                      confidence: { type: "integer", minimum: 0, maximum: 100 },
                    },
                    required: ["channel", "title_zh", "fact_zh", "source_url", "evidence_type", "confidence"],
                  },
                },
              },
              required: ["industry_type", "is_target_customer", "ai_score", "ai_level", "ai_reason", "business_relevance", "customer_value", "followup_suggestion", "confidence_score", "evidence_sufficiency", "evidence_conflicts", "score_breakdown", "suggested_contact_order", "evidence_summaries"],
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
  const pricing = pricingForModel(model);
  const inputPrice = pricing.input;
  const cachedPrice = pricing.cached_input;
  const outputPrice = pricing.output;
  const cost = (uncachedInput * inputPrice + cachedTokens * cachedPrice + outputTokens * outputPrice) / 1_000_000;
  const grounded = groundCustomerAnalysis(input, {
    ...parsed,
    ai_score: score,
    confidence_score: confidence,
    ai_level: scoreToLevel(score),
    is_target_customer: score >= 60 && confidence >= 60,
  }, webSearchSources(payload));
  return {
    ...grounded,
    usage: {
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedTokens,
      output_tokens: outputTokens,
      total_tokens: Number(usagePayload.total_tokens || inputTokens + outputTokens),
      cost_usd: Number(cost.toFixed(6)),
      pricing_snapshot: { currency: "USD", unit: "per_million_tokens", input: inputPrice, cached_input: cachedPrice, output: outputPrice, source: pricing.source },
    },
  };
}
