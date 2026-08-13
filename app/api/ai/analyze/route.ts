import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";
import { analyzeCustomer } from "@/lib/ai/customer-analysis";
import { collectCustomerEvidence } from "@/lib/ai/web-enrichment";

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { customer_id, product_image_information } = (await request.json()) as { customer_id?: string; product_image_information?: string };
    if (!customer_id) return NextResponse.json({ error: "缺少 customer_id" }, { status: 400 });

    const { data: customer, error: readError } = await supabase
      .from("customers")
      .select("id,company_name,country,website,google_url,address,industry,category,tags,source")
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
    const { error: updateError } = await supabase.from("customers").update({
      industry: analysis.industry_type,
      ai_score: analysis.ai_score,
      ai_level: analysis.ai_level,
      ai_reason: analysis.ai_reason,
    }).eq("id", customer.id);
    if (updateError) throw updateError;
    await writeAudit(supabase, user.id, "CUSTOMER_AI_ANALYZE", "customer", customer.id, analysis);
    return NextResponse.json({ customer_id: customer.id, ...analysis, evidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI分析失败";
    const status = message === "UNAUTHORIZED" ? 401 : message === "OPENAI_NOT_CONFIGURED" ? 503 : 400;
    return NextResponse.json({ error: message, configured: message !== "OPENAI_NOT_CONFIGURED" }, { status });
  }
}
