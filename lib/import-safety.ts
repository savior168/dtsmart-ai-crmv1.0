export type ImportPayloadRow = {
  import_meta?: Record<string, unknown>;
  [key: string]: unknown;
};

const IMPORTABLE_CUSTOMER_FIELDS = [
  "company_name", "contact_name", "country", "phone", "whatsapp", "email",
  "website", "google_url", "address", "industry", "category", "source", "tags",
  "rating", "ai_score", "ai_level", "facebook_url", "instagram_url", "tiktok_url", "linkedin_url", "notes",
  "wechat", "tax_number", "manual_grade", "import_stage", "source_stage_label", "source_grade_label", "tally_requirements", "forwarder_address", "other_address", "shipping_address", "shipping_contact_entries", "forwarder_contact_entries",
] as const;

/** Only customer source fields may cross the API boundary into a database insert. */
export function sanitizeImportRow(raw: ImportPayloadRow) {
  const item: ImportPayloadRow = {};
  IMPORTABLE_CUSTOMER_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) item[field] = raw[field];
  });
  if (raw.import_meta && typeof raw.import_meta === "object") item.import_meta = raw.import_meta;
  return item;
}

export function readableImportError(value: unknown, fallback: string) {
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (typeof value === "string" && value.trim() && value !== "[object Object]") return value.trim();
  if (value && typeof value === "object") {
    const detail = value as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "error"]) {
      const text = typeof detail[key] === "string" ? detail[key].trim() : "";
      if (text && text !== "[object Object]") return text;
    }
    const code = typeof detail.code === "string" ? detail.code.trim() : "";
    if (code) return `数据库错误 ${code}`;
  }
  return fallback;
}
