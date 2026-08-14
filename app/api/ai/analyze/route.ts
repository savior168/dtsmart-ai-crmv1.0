import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";
import { analyzeCustomer } from "@/lib/ai/customer-analysis";
import { collectCustomerEvidence } from "@/lib/ai/web-enrichment";

export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value?: string | null) {
  return String(value || "").replace(/[\s\-()]/g, "");
}

function joinNewEmails(original?: string | null, values: string[] = []) {
  const originalSet = new Set(String(original || "").split(",").map(normalizeEmail).filter(Boolean));
  return [...new Set(values.map(normalizeEmail).filter(Boolean).filter((email) => !originalSet.has(email)))].join(", ");
}

function joinNewPhones(original?: string | null, values: string[] = []) {
  const originalSet = new Set(String(original || "").split(",").map(normalizePhone).filter(Boolean));
  const cleaned = values.map((item) => String(item || "").trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const phone of cleaned) {
    const key = normalizePhone(phone);
    if (!key || originalSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(phone);
  }
  return result.join(", ");
}

export async function POST(request: NextRequest) {
  let requestedCustomerId: string | undefined;
  try {
    const { supabase, user } = await requireUser();
    const { customer_id, product_image_information } = (await request.json()) as { customer_id?: string; product_image_information?: string };
    requestedCustomerId = customer_id;
    if (!customer_id) return NextResponse.json({ error: "缺少 customer_id" }, { status: 400 });

    const { data: customer, error: readError } = await supabase
      .from("customers")
      .select("id,company_name,country,phone,email,website,google_url,address,industry,category,tags,source")
      .eq("id", customer_id)
      .is("deleted_at", null)
      .single();
    if (readError || !customer) throw readError || new Error("客户不存在或无权访问");

    const evidence = await collectCustomerEvidence({
      customer_name: customer.company_name,
      country: customer.country,
      website: customer.website,
      google_url: customer.google_url,
      address: customer.address,
    });
    const analysis = await analyzeCustomer({
      customer_name: customer.company_name,
      country: customer.country,
      website: customer.website,
      google_url: customer.google_url,
      address: customer.address,
      industry_keywords: [customer.industry, customer.category, customer.source, ...(customer.tags || [])].filter(Boolean).join(" / "),
      product_image_information: product_image_information || null,
      evidence,
    });

    const websiteEmail = joinNewEmails(customer.email, [...(evidence.website?.emails || []), ...(evidence.google_place?.emails || [])]);
    const websitePhone = joinNewPhones(customer.phone, [...(evidence.website?.phones || []), evidence.google_place?.phone || ""]);
    const shouldRecycle = false;
    const updatePayload = {
      industry: analysis.industry_type,
      ai_score: analysis.ai_score,
      ai_level: analysis.ai_level,
      ai_reason: analysis.ai_reason,
      is_target_customer: analysis.is_target_customer,
      ai_screening_done: true,
      business_relevance: analysis.business_relevance,
      customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion,
      website_email: websiteEmail || null,
      website_phone: websitePhone || null,
    };
    const { error: updateError } = await supabase.from("customers").update(updatePayload).eq("id", customer.id);
    if (updateError) throw updateError;
    await writeAudit(supabase, user.id, "CUSTOMER_AI_ANALYZE", "customer", customer.id, { ...analysis, websiteEmail, websitePhone, recycled: shouldRecycle });
    return NextResponse.json({ customer_id: customer.id, ...analysis, website_email: websiteEmail, website_phone: websitePhone, recycled: shouldRecycle, evidence });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const labels: Record<string, string> = {
      OPENAI_NOT_CONFIGURED: "生产环境未配置 OPENAI_API_KEY",
      OPENAI_TIMEOUT: "OpenAI 分析超时（超过45秒）",
      OPENAI_INVALID_JSON: "OpenAI 返回内容不是有效 JSON",
      OPENAI_EMPTY_RESPONSE: "OpenAI 返回空结果",
      UNAUTHORIZED: "登录会话已失效，请重新登录",
    };
    const message = labels[raw] || (raw.startsWith("OPENAI_API_ERROR:") ? `OpenAI 接口错误：${raw.slice(17)}` : raw.startsWith("OPENAI_NETWORK_ERROR:") ? `无法连接 OpenAI：${raw.slice(21)}` : `AI分析失败：${raw}`);
    const status = raw === "UNAUTHORIZED" ? 401 : raw === "OPENAI_NOT_CONFIGURED" ? 503 : 400;
    console.error("AI_ANALYZE_ERROR", { code: raw.split(":", 1)[0], message: raw, customer_id: requestedCustomerId || "missing" });
    return NextResponse.json({ error: message, code: raw.split(":", 1)[0], configured: raw !== "OPENAI_NOT_CONFIGURED" }, { status });
  }
}
