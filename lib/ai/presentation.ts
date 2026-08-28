/**
 * Keep sales-facing conclusions readable. Verbatim foreign-language excerpts
 * belong to the source verification panel, not inside Chinese summaries.
 */
export function cleanChineseAiNarrative(value?: string | null) {
  return String(value || "")
    .replace(/[；;]?\s*关键原文\s*[：:]\s*[“\"]?[\s\S]*?[”\"](?=\s*(?:[。；;]|\n|$))/g, "")
    .replace(/[；;]?\s*关键原文\s*[：:]\s*[“\"]?[^\n]*/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
