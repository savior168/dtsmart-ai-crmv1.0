/** Canonicalize a manually entered phone before validation and deduplication. */
export function normalizeManualPhone(value: unknown, label: string): string {
  const text = String(value ?? "").normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  if (!text) return "";
  // Retain the existing accepted format; only make pasted Unicode equivalents
  // (full-width digits, nonbreaking spaces and zero-width characters) usable.
  if (!/^\+?[\d\s().-]{6,25}$/.test(text)) {
    throw new Error(`${label}格式不正确`);
  }
  return text.replace(/\s+/g, " ");
}
