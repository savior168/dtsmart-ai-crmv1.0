import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dedupeVerifiedContactRows } from "@/lib/ai/contact-intelligence";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await context.params;
    const [customerResult, profileResult, followupsResult, claimsResult, protectionResult, aiEvidenceResult, auditLogsResult] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).or(`owner_id.eq.${user.id},created_by.eq.${user.id}`).single(),
      supabase.from("users").select("id,name,email,role,department_id").eq("id", user.id).single(),
      supabase.from("followups").select("*,creator:users(name,email)").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("customer_claims").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("customer_protection").select("*").eq("customer_id", id).order("start_date", { ascending: false }),
      supabase.from("audit_logs").select("content,created_at,user_id").eq("target_type", "customer").eq("target_id", id).eq("action", "CUSTOMER_AI_ANALYZE").order("created_at", { ascending: false }).limit(1),
      supabase.from("audit_logs").select("id,action,content,created_at,user_id").eq("target_type", "customer").eq("target_id", id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (customerResult.error) throw customerResult.error;
    if (profileResult.error) throw profileResult.error;
    if (followupsResult.error) throw followupsResult.error;
    if (claimsResult.error) throw claimsResult.error;
    if (protectionResult.error) throw protectionResult.error;
    if (aiEvidenceResult.error) throw aiEvidenceResult.error;
    if (auditLogsResult.error) throw auditLogsResult.error;
    const admin = createAdminClient();
    const latestAi = await admin.from("ai_screening_results").select("*").eq("customer_id", id).eq("is_latest_valid", true).eq("writeback_status", "COMPLETED").order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (latestAi.error) throw latestAi.error;
    const evidence = latestAi.data
      ? await admin.from("ai_screening_evidence").select("id,channel,title,normalized_fact,content,original_excerpt,source_url,evidence_type,evidence_confidence,metadata,fetched_at").eq("result_id", latestAi.data.id).order("fetched_at", { ascending: false })
      : { data: [], error: null };
    if (evidence.error) throw evidence.error;
    const verifiedContacts = await admin.from("customer_contacts")
      .select("id,type,value_raw,value_normalized,source_channel,exact_source_url,source_page_title,captured_at,identity_match_status,verification_status,contact_status")
      .eq("customer_id", id)
      .in("verification_status", ["MATCHED_ORIGINAL", "NEW_VERIFIED"])
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
    const customer = customerResult.data;
    const latestProtection = (protectionResult.data || [])[0] || null;
    const activeProtection = latestProtection?.status === "ACTIVE" && (!latestProtection.expire_date || new Date(latestProtection.expire_date).getTime() > Date.now())
      ? latestProtection
      : null;
    const latestClaim = (claimsResult.data || []).find((item) => ["CLAIM", "TRANSFER", "RELEASE"].includes(String(item.action)));
    const isReleased = customer.status === "RELEASED" || latestClaim?.action === "RELEASE";
    const defaultStart = latestClaim && ["CLAIM", "TRANSFER"].includes(String(latestClaim.action)) ? latestClaim.created_at : customer.created_at;
    const defaultExpire = customer.owner_id && !isReleased && !latestProtection ? new Date(new Date(defaultStart).getTime() + 90 * 86400000).toISOString() : null;
    const expireDate = latestProtection?.expire_date || defaultExpire;
    const permanent = Boolean(activeProtection && !activeProtection.expire_date) || customer.status === "DEAL";
    const remainingDays = permanent ? null : expireDate ? Math.max(0, Math.ceil((new Date(expireDate).getTime() - Date.now()) / 86400000)) : 0;
    const effectiveProtection = {
      source: latestProtection ? "EXPLICIT" : customer.owner_id && !isReleased ? "DEFAULT_90_DAYS" : "NONE",
      start_date: latestProtection?.start_date || (customer.owner_id && !isReleased ? defaultStart : null),
      expire_date: permanent ? null : expireDate,
      status: permanent || ((activeProtection || !latestProtection) && (remainingDays ?? 0) > 0) ? "ACTIVE" : isReleased ? "RELEASED" : "EXPIRED",
      remaining_days: remainingDays,
      permanent,
    };
    const canEdit = profileResult.data.role === "ADMIN" || customer.owner_id === user.id || (!customer.owner_id && customer.created_by === user.id);
    return NextResponse.json({ customer, profile: profileResult.data, can_edit: canEdit, effective_protection: effectiveProtection, followups: followupsResult.data, claims: claimsResult.data, audit_logs: auditLogsResult.data || [], protections: protectionResult.data, ai_evidence: aiEvidenceResult.data?.[0] || null, ai_result: latestAi.data || null, ai_facts: aiFacts, verified_contacts: dedupeVerifiedContactRows(verifiedContacts.data || []), users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM资料加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

