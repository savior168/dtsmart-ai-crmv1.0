import { NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { account } = await requirePermission("ai.acquisition.evidence.view");
    const { id } = await context.params;
    const admin = createAdminClient();
    const candidate = await admin.from("ai_acquisition_candidates").select("*,ai_acquisition_tasks!inner(user_id,task_number)").eq("id", id).maybeSingle();
    if (candidate.error) throw candidate.error;
    if (!candidate.data) return NextResponse.json({ error: "CANDIDATE_NOT_FOUND" }, { status: 404 });
    const ownerId = (candidate.data.ai_acquisition_tasks as { user_id?: string } | null)?.user_id;
    if (ownerId !== account.id && !hasPermission(account, "ai.acquisition.data_all")) throw new Error("FORBIDDEN");
    const itemId = String(candidate.data.screening_task_item_id || "");
    const customerId = String(candidate.data.staging_customer_id || candidate.data.imported_customer_id || "");
    const [result, evidence, contacts] = await Promise.all([
      itemId ? admin.from("ai_screening_results").select("score,grade,target_decision,identity_status,evidence_sufficiency_score,short_reason,reason,followup_suggestion").eq("task_item_id", itemId).eq("is_latest_valid", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
      itemId ? admin.from("ai_screening_evidence").select("id,source_url,source_type,evidence_type,evidence_strength,content_excerpt:original_excerpt,created_at").eq("task_item_id", itemId).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
      customerId ? admin.from("customer_contacts").select("id,type,value_raw,value_normalized,verification_status,identity_match_status,source_channel,exact_source_url").eq("customer_id", customerId).in("type", ["PHONE","EMAIL","WHATSAPP"]).in("verification_status", ["NEW_VERIFIED","SOURCE_CONFIRMED","MATCHED_ORIGINAL"]).not("exact_source_url", "is", null).order("type", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (result.error || evidence.error || contacts.error) throw result.error || evidence.error || contacts.error;
    return NextResponse.json({ candidate: candidate.data, analysis: result.data, evidence: evidence.data || [], contacts: contacts.data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "核验依据加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
