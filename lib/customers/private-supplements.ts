import {
  normalizeGoogleIdentity,
  normalizeIdentityEmails,
  normalizeIdentityPhone,
  normalizeIdentityPhones,
  normalizeIdentityText,
  normalizeIdentityUrl,
} from "../import-dedupe";

export const PRIVATE_SUPPLEMENT_FIELDS = [
  "contact_name", "phone", "email", "website", "google_url", "address",
] as const;

export type PrivateSupplementField = typeof PRIVATE_SUPPLEMENT_FIELDS[number];

type CustomerLike = Record<string, unknown>;

function values(field: PrivateSupplementField, value: unknown) {
  if (field === "phone") return normalizeIdentityPhones(value).map((normalized) => ({ raw: String(value || "").trim(), normalized }));
  if (field === "email") return normalizeIdentityEmails(value).map((normalized) => ({ raw: normalized, normalized }));
  const raw = String(value || "").trim();
  if (!raw) return [];
  const normalized = field === "website" ? normalizeIdentityUrl(raw)
    : field === "google_url" ? normalizeGoogleIdentity(raw)
      : normalizeIdentityText(raw);
  return normalized ? [{ raw, normalized }] : [];
}

/** Returns only valid values that are not already present in the public master record. */
export function buildPrivateSupplementRows(
  customer: CustomerLike,
  submitted: CustomerLike,
  context: { customerId: string; submittedBy: string; sourceType: "BATCH_IMPORT" | "MANUAL_CREATE"; sourceBatch?: string | null; sourceBatchId?: string | null; sourceRow?: number | null },
) {
  return PRIVATE_SUPPLEMENT_FIELDS.flatMap((field) => {
    const existing = new Set(values(field, customer[field]).map((item) => item.normalized));
    return values(field, submitted[field])
      .filter((item) => !existing.has(item.normalized))
      .map((item) => ({
        customer_id: context.customerId,
        submitted_by: context.submittedBy,
        field_name: field,
        value_raw: item.raw,
        value_normalized: field === "phone" ? normalizeIdentityPhone(item.normalized) : item.normalized,
        source_type: context.sourceType,
        source_batch: context.sourceBatch || null,
        source_batch_id: context.sourceBatchId || null,
        source_row: context.sourceRow || null,
      }));
  });
}

export const privateSupplementFieldLabels: Record<PrivateSupplementField, string> = {
  contact_name: "联系人",
  phone: "电话",
  email: "邮箱",
  website: "官网",
  google_url: "Google Maps",
  address: "地址",
};
