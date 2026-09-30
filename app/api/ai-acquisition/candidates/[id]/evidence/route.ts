import { NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canReadAiOwner } from "@/lib/ai/owner-scope";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let candidateId = "";
  try {
    const { account } = await requirePermission("ai.acquisition.evidence.view");
    const { id } = await context.params;
    candidateId = id;
    const admin = createAdminClient();
    const candidate = await admin.from("ai_acquisition_candidates").select("*,ai_acquisition_tasks!inner(user_id,task_number,industry,industries)").eq("id", id).maybeSingle();
    if (candidate.error) throw candidate.error;
    if (!candidate.data) return NextResponse.json({ error: "CANDIDATE_NOT_FOUND" }, { status: 404 });
    const ownerId = (candidate.data.ai_acquisition_tasks as { user_id?: string } | null)?.user_id;
    if (ownerId !== account.id && (!hasPermission(account, "ai.acquisition.data_all") || !await canReadAiOwner(account, ownerId))) throw new Error("FORBIDDEN");
    const itemId = String(candidate.data.screening_task_item_id || "");
    const customerId = String(candidate.data.staging_customer_id || candidate.data.imported_customer_id || "");
    const result = itemId
      ? await admin.from("ai_screening_results").select("id,score,grade,target_decision,identity_status,verified_business_name,verified_address,match_signals,mismatch_signals,industry_type,evidence_sufficiency_score,short_reason,business_scope,company_scale_evidence,customer_value,followup_suggestion").eq("task_item_id", itemId).eq("is_latest_valid", true).maybeSingle()
      : { data: null, error: null };
    if (result.error) throw result.error;
    const [evidence, contacts, customer] = await Promise.all([
      result.data?.id ? admin.from("ai_screening_evidence").select("id,source_url,source_type,channel,title,evidence_type,evidence_strength,evidence_confidence,identity_match_status,normalized_fact,translated_fact,content,original_excerpt,metadata,created_at:fetched_at").eq("result_id", result.data.id).order("fetched_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
      customerId ? admin.from("customer_contacts").select("id,type,value_raw,value_normalized,verification_status,identity_match_status,source_channel,exact_source_url").eq("customer_id", customerId).in("type", ["PHONE","EMAIL","WHATSAPP"]).in("verification_status", ["NEW_VERIFIED","SOURCE_CONFIRMED","MATCHED_ORIGINAL"]).not("exact_source_url", "is", null).order("type", { ascending: true }) : Promise.resolve({ data: [], error: null }),
      customerId ? admin.from("customers").select("website").eq("id", customerId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (result.error || evidence.error || contacts.error || customer.error) throw result.error || evidence.error || contacts.error || customer.error;
    const task = candidate.data.ai_acquisition_tasks as { industry?: string; industries?: string[] | null } | null;
    return NextResponse.json({ candidate: candidate.data, target_industries: task?.industries?.length ? task.industries : task?.industry ? [task.industry] : [], website_url: customer.data?.website || candidate.data.website || null, analysis: result.data, evidence: evidence.data || [], contacts: contacts.data || [], evidence_available: Boolean(result.data?.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "核验依据加载失败";
    const databaseError = error as { code?: string; details?: string; hint?: string };
    console.error("[ai-acquisition-evidence] load failed", {
      candidateId,
      code: databaseError.code || null,
      message,
      details: databaseError.details || null,
      hint: databaseError.hint || null,
    });
    const publicMessage = message === "UNAUTHORIZED" ? "登录状态已失效，请重新登录" : message === "FORBIDDEN" ? "您没有查看该客户核验依据的权限" : message === "CANDIDATE_NOT_FOUND" ? "该候选客户记录不存在或已失效" : "核验依据暂时无法加载，请稍后重试";
    return NextResponse.json({ error: publicMessage }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "CANDIDATE_NOT_FOUND" ? 404 : 500 });
  }
}
