export function publicReleaseReason(value: string | null | undefined): string {
  const reason = String(value || "").replace(/\s+/g, " ").trim();
  if (!reason) return "未填写释放原因";

  const redacted = reason
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[邮箱已隐藏]")
    .replace(/(?:https?:\/\/|www\.)[^\s，。；、]+/gi, "[链接已隐藏]")
    .replace(/(?:\+|00)?\d[\d\s().-]{7,}\d/g, (candidate) =>
      candidate.replace(/\D/g, "").length >= 9 ? "[号码已隐藏]" : candidate);
  return redacted.length > 160 ? `${redacted.slice(0, 160)}…` : redacted;
}
