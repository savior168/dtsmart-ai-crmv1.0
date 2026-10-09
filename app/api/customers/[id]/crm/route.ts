import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dedupeVerifiedContactRows, normalizeEmailStrict, normalizePhoneInternational } from "@/lib/ai/contact-intelligence";
import { canReadCustomerAiEvidence } from "@/lib/ai/customer-evidence-access";

function cleanStoredDiscoveredValues(value: unknown, type: "EMAIL" | "PHONE", country: unknown, originals: unknown[]) {
  const normalize = (item: unknown) => type === "EMAIL" ? normalizeEmailStrict(String(item || "")) : normalizePhoneInternational(String(item || ""), String(country || ""));
  const originalSet = new Set(originals.map(normalize).filter(Boolean));
  const unique = new Map<string, string>();
  for (const raw of String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)) {
    const key = normalize(raw);
    if (key && !originalSet.has(key) && !unique.has(key)) unique.set(key, raw);
  }
  return [...unique.values()].join(", ") || null;
}

function isPublicUnclaimed(customer: { owner_id?: string | null; acquisition_scope?: string | null; pool_status?: string | null; status?: string | null }) {
  return !customer.owner_id && customer.acquisition_scope === "PUBLIC_POOL" && customer.pool_status === "AVAILABLE" && customer.status === "UNCLAIMED";
}

/** A public, unclaimed row is readable by every permitted role. Business
 * history and all attachment metadata are loaded only after owner/all-data access is confirmed. */
export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user, account } = await requirePermission("customers.view");
    const { id } = await context.params;
    const admin = createAdminClient();
    const [customerResult, profileResult] = await Promise.all([
      admin.from("customers").select("*").eq("id", id).is("deleted_at", null).single(),
      supabase.from("users").select("id,name,email,role,department_id").eq("id", user.id).single(),
    ]);
    if (customerResult.error) throw customerResult.error;
    if (profileResult.error) throw profileResult.error;
    const customer = customerResult.data;
    const isOwner = customer.owner_id === user.id;
    const directReport = account.role === "SUPERVISOR" && customer.owner_id
      ? await admin.from("users").select("id").eq("id", customer.owner_id).eq("manager_id", account.id).eq("status", "ACTIVE").maybeSingle()
      : { data: null };
    const canReadAll = account.role === "ADMIN" || Boolean(directReport.data);
    const publicReadOnly = isPublicUnclaimed(customer);
    if (!canReadAll && !isOwner && !publicReadOnly) throw new Error("FORBIDDEN");

    const [latestAi, verifiedContacts] = await Promise.all([
      admin.from("ai_screening_results").select("*").eq("customer_id", id).eq("is_latest_valid", true).eq("writeback_status", "COMPLETED").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("customer_contacts").select("id,type,value_raw,value_normalized,source_channel,exact_source_url,source_page_title,captured_at,identity_match_status,verification_status,contact_status").eq("customer_id", id).in("verification_status", ["MATCHED_ORIGINAL", "NEW_VERIFIED"]).order("captured_at", { ascending: false }),
    ]);
    if (latestAi.error) throw latestAi.error;
    if (verifiedContacts.error) throw verifiedContacts.error;
    const decisionMakers = await admin.from("customer_decision_makers").select("id,full_name,job_title,role_type,contact_type,contact_value,exact_source_url,source_excerpt,verification_status,confidence,verified_at").eq("customer_id",id).eq("verification_status","SOURCE_VERIFIED").order("confidence",{ascending:false}).order("verified_at",{ascending:false});
    if(decisionMakers.error)console.warn("[customer-crm] verified decision makers unavailable",{customer_id:id,code:decisionMakers.error.code,message:decisionMakers.error.message});
    const evidence = latestAi.data ? await admin.from("ai_screening_evidence").select("id,channel,title,normalized_fact,content,original_excerpt,source_url,evidence_type,evidence_confidence,metadata,fetched_at").eq("result_id", latestAi.data.id).order("fetched_at", { ascending: false }) : { data: [], error: null };
    if (evidence.error) throw evidence.error;
    const aiFacts = (evidence.data || []).filter((item) => {
      const fact = String(item.normalized_fact || item.content || "").trim();
      return /[\u3400-\u9fff]/.test(fact) && !/读取失败|未能取得|未保存|请重新执行|GOOGLE_MAPS_API_KEY|fetch failed/i.test(fact) && /^https?:\/\//i.test(String(item.source_url || ""));
    });
    const aiCompleted = Boolean(customer.ai_screening_done && latestAi.data);
    const canViewAiEvidence = aiCompleted && canReadCustomerAiEvidence({
      viewerId: user.id, viewerRole: account.role, customerOwnerId: customer.owner_id,
      isDirectReport: Boolean(directReport.data),
      canViewCustomerEvidence: hasPermission(account, "customers.ai_evidence_view"),
      canViewAiResults: hasPermission(account, "ai.results.view"),
    });
    const aiResultForDisplay = aiCompleted && latestAi.data ? {
      target_decision: latestAi.data.target_decision,
      ai_reason: latestAi.data.ai_reason,
      summary: latestAi.data.summary,
      business_relevance: latestAi.data.business_relevance,
      business_scope: latestAi.data.business_scope,
      company_scale_evidence: latestAi.data.company_scale_evidence,
      customer_value: latestAi.data.customer_value,
      followup_suggestion: latestAi.data.followup_suggestion,
    } : null;
    const customerForDisplay = { ...customer, website_email: cleanStoredDiscoveredValues(customer.website_email, "EMAIL", customer.country, [customer.email]), website_phone: cleanStoredDiscoveredValues(customer.website_phone, "PHONE", customer.country, [customer.phone, customer.whatsapp]), ...(!aiCompleted ? { industry: null, ai_score: null, ai_level: null, is_target_customer: null, ai_reason: null, business_scope: null, business_relevance: null, customer_value: null, followup_suggestion: null, company_scale_evidence: null } : {}) };
    const base = { customer: customerForDisplay, profile: profileResult.data, can_edit: hasPermission(account, "customers.edit") && (account.role === "ADMIN" || isOwner), can_change_stage: hasPermission(account, "customers.edit") && Boolean(customer.owner_id) && (account.role === "ADMIN" || isOwner), can_sales_operate: hasPermission(account, "followups.create") && (account.role === "ADMIN" || isOwner), can_view_ai_evidence: canViewAiEvidence, access_scope: publicReadOnly ? "PUBLIC_POOL" : "BUSINESS", ai_result: aiResultForDisplay, ai_facts: aiCompleted ? aiFacts : [], verified_contacts: aiCompleted ? dedupeVerifiedContactRows(verifiedContacts.data || []) : [], decision_makers:aiCompleted?(decisionMakers.data||[]):[] };
    if (publicReadOnly) return NextResponse.json({ ...base, current_owner: null, effective_protection: { source: "NONE", start_date: null, expire_date: null, status: "EXPIRED", remaining_days: 0, permanent: false }, followups: [], attachments: [], quotes: [], claims: [], audit_logs: [], protections: [], private_supplements: [], users: [] });

    const [followupsResult, claimsResult, protectionResult, auditLogsResult, attachmentsResult, quotesResult, privateSupplementsResult] = await Promise.all([
      admin.from("followups").select("*,creator:users(name,email)").eq("customer_id", id).order("created_at", { ascending: false }),
      admin.from("customer_claims").select("id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason,source_owner_id,assignment_batch_id,created_at").eq("customer_id", id).order("created_at", { ascending: false }),
      admin.from("customer_protection").select("*").eq("customer_id", id).order("start_date", { ascending: false }),
      admin.from("audit_logs").select("id,action,content,created_at,user_id").eq("target_type", "customer").eq("target_id", id).order("created_at", { ascending: false }).limit(100),
      admin.from("attachments").select("id,followup_id,quote_id,filename,mime_type,size_bytes,kind,created_at").eq("customer_id", id).order("created_at", { ascending: false }),
      admin.from("quotes").select("id,quote_number,status,currency,total_amount,valid_until,created_at,updated_at").eq("customer_id", id).order("updated_at", { ascending: false }),
      admin.from("customer_private_supplements").select("id,field_name,value_raw,source_type,source_batch,source_row,created_at").eq("customer_id", id).eq("submitted_by", user.id).order("created_at", { ascending: false }),
    ]);
    for (const result of [followupsResult, claimsResult, protectionResult, auditLogsResult, attachmentsResult, quotesResult, privateSupplementsResult]) if (result.error) throw result.error;
    const historyUserIds = [...new Set([customer.owner_id, ...(claimsResult.data || []).flatMap((item) => [item.user_id, item.source_owner_id]), ...(followupsResult.data || []).map((item) => item.user_id)].filter(Boolean))] as string[];
    const historyUsersResult = historyUserIds.length
      ? await admin.from("users").select("id,name,email").in("id", historyUserIds)
      : { data: [], error: null };
    if (historyUsersResult.error) throw historyUsersResult.error;
    const historyUsersById = new Map((historyUsersResult.data || []).map((item) => [item.id, item]));
    const claims = (claimsResult.data || []).map((item) => ({ ...item, actor: historyUsersById.get(item.user_id) || null, source_owner: item.source_owner_id ? historyUsersById.get(item.source_owner_id) || null : null }));
    const currentOwner = customer.owner_id ? historyUsersById.get(customer.owner_id) || null : null;
    const usersResult = ["ADMIN", "SUPERVISOR"].includes(profileResult.data.role) ? await supabase.from("users").select("id,name,email,role").eq("status", "ACTIVE").order("name") : { data: [], error: null };
    const latestProtection = (protectionResult.data || [])[0] || null;
    const activeProtection = latestProtection?.status === "ACTIVE" && (!latestProtection.expire_date || new Date(latestProtection.expire_date).getTime() > Date.now()) ? latestProtection : null;
    const latestClaim = claims.find((item) => ["CLAIM", "TRANSFER", "RELEASE"].includes(String(item.action)));
    const isReleased = customer.status === "RELEASED" || latestClaim?.action === "RELEASE";
    const defaultStart = latestClaim && ["CLAIM", "TRANSFER"].includes(String(latestClaim.action)) ? latestClaim.created_at : customer.created_at;
    const defaultExpire = customer.owner_id && !isReleased && !latestProtection ? new Date(new Date(defaultStart).getTime() + 90 * 86400000).toISOString() : null;
    const expireDate = latestProtection?.expire_date || defaultExpire;
    const permanent = Boolean(activeProtection && !activeProtection.expire_date) || customer.status === "DEAL";
    const remainingDays = permanent ? null : expireDate ? Math.max(0, Math.ceil((new Date(expireDate).getTime() - Date.now()) / 86400000)) : 0;
    const displayClaims = claims.map((item) => {
      const actor = item.actor?.name || item.actor?.email || item.owner_name || "系统记录缺少姓名";
      const previous = item.source_owner?.name || item.source_owner?.email || null;
      const action = item.action === "RELEASE"
        ? `释放客户：${actor}${previous ? `（原归属：${previous}）` : ""}${item.release_reason ? `；原因：${item.release_reason}` : ""}`
        : item.action === "TRANSFER"
          ? `转移客户归属：${actor}${previous ? `（原归属：${previous}）` : ""}`
          : `认领客户：${actor}`;
      return { ...item, action };
    });
    return NextResponse.json({ ...base, current_owner: currentOwner, effective_protection: { source: latestProtection ? "EXPLICIT" : customer.owner_id && !isReleased ? "DEFAULT_90_DAYS" : "NONE", start_date: latestProtection?.start_date || (customer.owner_id && !isReleased ? defaultStart : null), expire_date: permanent ? null : expireDate, status: permanent || ((activeProtection || !latestProtection) && (remainingDays ?? 0) > 0) ? "ACTIVE" : isReleased ? "RELEASED" : "EXPIRED", remaining_days: remainingDays, permanent }, followups: followupsResult.data || [], attachments: attachmentsResult.data || [], quotes: quotesResult.data || [], claims: displayClaims, audit_logs: auditLogsResult.data || [], protections: protectionResult.data || [], private_supplements: privateSupplementsResult.data || [], users: usersResult.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM资料加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
