import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_FIELD_MAPPING_VERSION, type AiMappedCustomer } from "@/lib/ai/semantic-fields";
import type { AiStrategy } from "@/lib/ai/task-types";

// Bump both versions whenever the evidence gate or writeback contract changes.
// This deliberately invalidates older cache rows that could be reused before
// their evidence/customer writeback had completed.
export const AI_RULE_VERSION = "2026.09.09.16";
export const AI_EVIDENCE_SCHEMA_VERSION = "2026.09.09.16";

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function reusableEvidenceIsTraceable(row: Record<string, unknown>) {
  if (!isUuid(row.source_result_id)) return false;
  const analysis = row.analysis_result && typeof row.analysis_result === "object"
    ? row.analysis_result as Record<string, unknown>
    : null;
  if (!analysis
    || analysis.writeback_status !== "COMPLETED"
    || analysis.is_latest_valid !== true
    || analysis.identity_status !== "MATCHED"
    || !["AUTO_DEVELOP", "AUTO_REJECT"].includes(String(analysis.automation_status || ""))) return false;
  const snapshot = Array.isArray(row.evidence_snapshot) ? row.evidence_snapshot : [];
  const valid = snapshot.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    const fact = String(record.normalized_fact || record.content || "").trim();
    const url = String(record.source_url || "").trim();
    return /[\u3400-\u9fff]/.test(fact)
      && !/读取失败|未能取得|未保存|请重新执行/.test(fact)
      && /^https?:\/\//i.test(url);
  });
  const channels = new Set(valid.map((item) => String((item as Record<string, unknown>).channel || (item as Record<string, unknown>).source_channel || "")));
  return valid.some((item) => String((item as Record<string, unknown>).strength || "") === "STRONG_DIRECT")
    || (valid.length >= 2 && channels.size >= 2);
}

function compact(value?: string | null) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}@.+]/gu, "");
}

function domain(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function customerIdentityKeys(customer: AiMappedCustomer) {
  const name = compact(customer.company_name || customer.contact_name);
  const country = compact(customer.country);
  const phone = compact(customer.phone);
  const email = compact(customer.email);
  const website = domain(customer.website);
  const google = compact(customer.google_url);
  const strong: string[] = [];
  if (name && phone.length >= 7) strong.push(`name_phone:${name}|${phone}|${country}`);
  if (name && email.includes("@")) strong.push(`name_email:${name}|${email}|${country}`);
  if (name && website) strong.push(`name_domain:${name}|${website}|${country}`);
  if (name && google) strong.push(`name_google:${name}|${google}|${country}`);
  return [...new Set(strong)].map(digest);
}

export function customerSourceSignature(customer: AiMappedCustomer) {
  return digest(JSON.stringify({
    company: compact(customer.company_name), country: compact(customer.country), phone: compact(customer.phone),
    email: compact(customer.email), website: domain(customer.website), google: compact(customer.google_url),
    linkedin: compact(customer.linkedin_url), facebook: compact(customer.facebook_url), instagram: compact(customer.instagram_url),
  }));
}

export async function findReusableAnalysis(customer: AiMappedCustomer, strategy: AiStrategy) {
  const keys = customerIdentityKeys(customer);
  if (!keys.length) return null;
  const strategies = strategy === "SMART" ? ["SMART", "DEEP"] : ["DEEP"];
  const admin = createAdminClient();
  const sourceSignature = customerSourceSignature(customer);
  const result = await admin.from("ai_analysis_reuse_cache")
    .select("*")
    .in("identity_key", keys)
    .in("strategy", strategies)
    .eq("rule_version", AI_RULE_VERSION)
    .eq("field_mapping_version", AI_FIELD_MAPPING_VERSION)
    .eq("evidence_schema_version", AI_EVIDENCE_SCHEMA_VERSION)
    .eq("source_signature", sourceSignature)
    .gt("expires_at", new Date().toISOString())
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    // Compatibility: a not-yet-applied additive migration must not stop analysis.
    if (/ai_analysis_reuse_cache|schema cache|does not exist/i.test(result.error.message)) return null;
    throw result.error;
  }
  if (!result.data || !reusableEvidenceIsTraceable(result.data as Record<string, unknown>)) return null;
  const cachedAnalysis = result.data.analysis_result && typeof result.data.analysis_result === "object"
    ? result.data.analysis_result as Record<string, unknown>
    : {};
  if (!["AUTO_DEVELOP", "AUTO_REJECT"].includes(String(cachedAnalysis.automation_status || ""))
      || cachedAnalysis.score == null || !["A", "B", "C", "D"].includes(String(cachedAnalysis.grade || ""))) return null;
  const cachedScore = Number(cachedAnalysis.score);
  if ((cachedAnalysis.automation_status === "AUTO_DEVELOP" && cachedScore < 60)
      || (cachedAnalysis.automation_status === "AUTO_REJECT" && cachedScore >= 60)) return null;
  const sourceResultId = String(result.data.source_result_id || "");
  const [sourceResult, sourceEvidence] = await Promise.all([
    admin.from("ai_screening_results").select("id").eq("id", sourceResultId).eq("is_latest_valid", true).eq("writeback_status", "COMPLETED").maybeSingle(),
    admin.from("ai_screening_evidence").select("id").eq("result_id", sourceResultId).limit(1).maybeSingle(),
  ]);
  if (sourceResult.error || sourceEvidence.error || !sourceResult.data || !sourceEvidence.data) return null;
  await admin.from("ai_analysis_reuse_cache").update({ reused_at: new Date().toISOString() }).eq("id", result.data.id);
  return result.data;
}

export async function saveReusableAnalysis(input: {
  customer: AiMappedCustomer;
  strategy: AiStrategy;
  resultId: string;
  analysisResult: Record<string, unknown>;
  evidenceSnapshot: unknown[];
  discoveredContacts: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
}) {
  const keys = customerIdentityKeys(input.customer);
  if (!keys.length) return;
  const admin = createAdminClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.strategy === "DEEP" ? 30 : 14) * 86_400_000).toISOString();
  const sourceSignature = customerSourceSignature(input.customer);
  const rows = keys.map((identityKey) => ({
    identity_key: identityKey,
    source_customer_id: input.customer.id,
    source_result_id: input.resultId,
    strategy: input.strategy,
    rule_version: AI_RULE_VERSION,
    field_mapping_version: AI_FIELD_MAPPING_VERSION,
    evidence_schema_version: AI_EVIDENCE_SCHEMA_VERSION,
    source_signature: sourceSignature,
    analysis_result: input.analysisResult,
    evidence_snapshot: input.evidenceSnapshot,
    discovered_contacts: input.discoveredContacts,
    model_snapshot: input.modelSnapshot,
    captured_at: now.toISOString(),
    original_captured_at: now.toISOString(),
    expires_at: expiresAt,
    updated_at: now.toISOString(),
  }));
  const write = await admin.from("ai_analysis_reuse_cache").upsert(rows, { onConflict: "identity_key,strategy,rule_version,source_signature" });
  if (write.error && !/ai_analysis_reuse_cache|schema cache|does not exist/i.test(write.error.message)) throw write.error;
}

