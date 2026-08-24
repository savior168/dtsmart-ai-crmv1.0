import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    const [customerResult, profileResult, followupsResult, claimsResult, protectionResult, aiEvidenceResult] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).or(`owner_id.eq.${user.id},created_by.eq.${user.id}`).single(),
      supabase.from("users").select("id,name,email,role,department_id").eq("id", user.id).single(),
      supabase.from("followups").select("*,creator:users(name,email)").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("customer_claims").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("customer_protection").select("*").eq("customer_id", id).order("start_date", { ascending: false }),
      supabase.from("audit_logs").select("content,created_at,user_id").eq("target_type", "customer").eq("target_id", id).eq("action", "CUSTOMER_AI_ANALYZE").order("created_at", { ascending: false }).limit(1),
    ]);
    if (customerResult.error) throw customerResult.error;
    if (profileResult.error) throw profileResult.error;
    if (followupsResult.error) throw followupsResult.error;
    if (claimsResult.error) throw claimsResult.error;
    if (protectionResult.error) throw protectionResult.error;
    if (aiEvidenceResult.error) throw aiEvidenceResult.error;
    const admin = createAdminClient();
    const latestAi = await admin.from("ai_screening_results").select("*").eq("customer_id", id).order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (latestAi.error) throw latestAi.error;
    const evidence = latestAi.data
      ? await admin.from("ai_screening_evidence").select("id,channel,title,normalized_fact,content,source_url,evidence_type,evidence_confidence,metadata,fetched_at").eq("result_id", latestAi.data.id).order("fetched_at", { ascending: false })
      : { data: [], error: null };
    if (evidence.error) throw evidence.error;
    const verifiedContacts = await admin.from("customer_contacts")
      .select("id,type,value_raw,value_normalized,source_channel,exact_source_url,source_page_title,captured_at,identity_match_status,verification_status,contact_status")
      .eq("customer_id", id)
      .order("captured_at", { ascending: false });
    if (verifiedContacts.error) throw verifiedContacts.error;
    const aiFacts = (evidence.data || []).filter((item) => {
      const fact = String(item.normalized_fact || item.content || "").trim();
      return /[\u3400-\u9fff]/.test(fact)
        && !/读取失败|未能取得|未保存|请重新执行|GOOGLE_MAPS_API_KEY|fetch failed/i.test(fact)
        && /^https?:\/\//i.test(String(item.source_url || ""));
    });
    let users: unknown[] = [];
    if (profileResult.data.role === "ADMIN") {
      const result = await supabase.from("users").select("id,name,email,role").eq("status", "ACTIVE").order("name");
      if (!result.error) users = result.data || [];
    }
    return NextResponse.json({ customer: customerResult.data, profile: profileResult.data, followups: followupsResult.data, claims: claimsResult.data, protections: protectionResult.data, ai_evidence: aiEvidenceResult.data?.[0] || null, ai_result: latestAi.data || null, ai_facts: aiFacts, verified_contacts: verifiedContacts.data || [], users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM资料加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
