import type { AiMappedCustomer } from "./semantic-fields.ts";
import type { GooglePlaceEvidence } from "./web-enrichment.ts";

/**
 * Build a fallback from the exact Google Text Search response that created an
 * AI-acquisition staging customer. Imported and manually-created customers are
 * deliberately excluded because their stored Place ID may be stale.
 */
export function applyTrustedAcquisitionGoogleSnapshot(
  customer: AiMappedCustomer,
  evidence?: GooglePlaceEvidence,
): GooglePlaceEvidence | undefined {
  const isTrustedAcquisitionRow = customer.source === "AI_ACQUISITION_STAGING"
    && customer.source_channel === "GOOGLE_MAPS"
    && Boolean(customer.google_place_id)
    && Boolean(customer.company_name)
    && Boolean(customer.google_url);
  if (!isTrustedAcquisitionRow) return evidence;

  const existingUsable = evidence
    && ["MATCHED", "LIKELY_MATCHED"].includes(String(evidence.identity_status || ""))
    && Number(evidence.identity_confidence || 0) >= 70
    && Boolean(evidence.name)
    && (evidence.types || []).length > 0;
  if (existingUsable) return evidence;

  const snapshotTypes = String(customer.category || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const snapshotError = evidence?.error
    ? `Google详情未补齐：${evidence.error}；已使用本次获客搜索的同源Place快照完成主体与行业核验。`
    : "已使用本次获客搜索的同源Place快照完成主体与行业核验；联系方式仍须由官网或Google详情独立核验。";
  return {
    ...(evidence || {}),
    configured: evidence?.configured ?? Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY),
    query: evidence?.query || customer.company_name,
    name: customer.company_name,
    formatted_address: customer.address || evidence?.formatted_address || undefined,
    types: snapshotTypes.length ? snapshotTypes : (evidence?.types || []),
    reviews: evidence?.reviews || [],
    emails: evidence?.emails || [],
    place_id: customer.google_place_id || undefined,
    candidate_count: 1,
    identity_status: "MATCHED",
    identity_confidence: 100,
    match_signals: [
      "本次AI获客Google搜索返回的Place ID与客户暂存记录一致",
      customer.address ? "商家名称与完整地址来自同一Google搜索响应" : "商家名称与Place ID来自同一Google搜索响应",
      ...(evidence?.match_signals || []),
    ],
    mismatch_signals: evidence?.mismatch_signals || [],
    verified_google_maps_url: customer.google_url || evidence?.verified_google_maps_url,
    error: snapshotError,
  };
}
