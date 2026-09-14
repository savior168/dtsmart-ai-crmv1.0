/** Imported directory names may begin with a source-platform decoration. */
export function displayCustomerName(value: unknown, fallback = "—") {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]+\s*)+/u, "").trim();
  return cleaned || raw;
}
