import { normalizePhoneInternational } from "./phone-normalization";

/** Split legacy website contact fields using the same rules in lists and exports. */
export function splitStoredContactValues(value: string | null | undefined, type: "PHONE" | "EMAIL", country?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const chunks = raw
    .split(/[,;|\r\n]+|(?=\s+\d+\s*[:：]\s*)/)
    .map((item) => item.replace(/^\s*\d+\s*[:：]\s*/, "").trim())
    .filter(Boolean);
  const unique = new Map<string, string>();
  for (const chunk of chunks) {
    const normalized = type === "EMAIL" ? chunk.toLowerCase() : normalizePhoneInternational(chunk, country);
    if (!normalized || (type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))) continue;
    if (!unique.has(normalized)) unique.set(normalized, type === "PHONE" ? normalized : chunk);
  }
  return [...unique.values()];
}
