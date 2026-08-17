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

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof value.message === "string" && value.message) {
      const extra = [value.details, value.hint].filter((item): item is string => typeof item === "string" && item.length > 0);
      return extra.length ? `${value.message}（${extra.join("；")}）` : value.message;
    }
    if (typeof value.code === "string" && value.code) return `数据库错误 ${value.code}`;
  }
  return String(error || "未知错误");
}

/** Persist only reviewable factual inputs, not raw pages or provider secrets. */
function evidenceSummary(evidence: Awaited<ReturnType<typeof collectCustomerEvidence>>) {
  const website = evidence.website;
  const google = evidence.google_place;
  return {
    website: website ? {
      url: website.url, reachable: website.reachable, title: website.title || null,
      description: website.description || null, headings: website.headings.slice(0, 20),
      important_pages: (website.pages || []).map((page) => ({ url: page.url, title: page.title || null, headings: page.headings.slice(0, 8) })),
      image_alts: website.image_alts.slice(0, 20), image_urls: website.image_urls.slice(0, 12),
      video_urls: (website.video_urls || []).slice(0, 8), emails: website.emails, phones: website.phones,
      fetch_error: website.error || null,
    } : null,
    google_maps: google ? {
      configured: google.configured, query: google.query || null, name: google.name || null,
      address: google.formatted_address || null, business_status: google.business_status || null,
      rating: google.rating ?? null, review_count: google.user_ratings_total ?? null,
      categories: google.types, website: google.website || null, phone: google.phone || null,
      reviews: google.reviews, fetch_error: google.error || null,
    } : null,
  };
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
    const coreUpdatePayload = {
      industry: analysis.industry_type,
      ai_score: analysis.ai_score,
      ai_level: analysis.ai_level,
      ai_reason: analysis.ai_reason,
    };
    // Core fields are present in the original production schema. Write these
    // first so AI screening always completes even when optional columns have
    // not yet been added to Supabase's schema cache.
    const { error: coreUpdateError } = await supabase.from("customers").update(coreUpdatePayload).eq("id", customer.id);
    if (coreUpdateError) throw coreUpdateError;

    // Optional enrichment is best-effort and isolated from the core write. On
    // older databases PostgREST returns PGRST204/42703 for missing columns;
    // those fields are reported in logs and never turn a successful analysis
    // into a failed task.
    const optionalUpdatePayload = {
      is_target_customer: analysis.is_target_customer,
      ai_screening_done: true,
      business_relevance: analysis.business_relevance,
      customer_value: analysis.customer_value,
      followup_suggestion: analysis.followup_suggestion,
      website_email: websiteEmail || null,
      website_phone: websitePhone || null,
    };
    const { error: optionalUpdateError } = await supabase.from("customers").update(optionalUpdatePayload).eq("id", customer.id);
    if (optionalUpdateError) {
      console.warn("AI_ANALYZE_OPTIONAL_FIELDS_SKIPPED", {
        customer_id: customer.id,
        code: optionalUpdateError.code,
        message: optionalUpdateError.message,
      });
    }
    // Audit logging must not turn a completed analysis into a user-visible failure.
    try {
      await writeAudit(supabase, user.id, "CUSTOMER_AI_ANALYZE", "customer", customer.id, {
        analysis,
        evidence: evidenceSummary(evidence),
        website_email_added: websiteEmail || null,
        website_phone_added: websitePhone || null,
        recycled: shouldRecycle,
      });
    } catch (auditError) {
      console.error("AI_ANALYZE_AUDIT_ERROR", { customer_id: customer.id, error: errorMessage(auditError) });
    }
    return NextResponse.json({ customer_id: customer.id, ...analysis, website_email: websiteEmail, website_phone: websitePhone, recycled: shouldRecycle, evidence });
  } catch (error) {
    const raw = errorMessage(error);
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
