import { normalizeManualPhone } from "./manual-phone";

export type ManualContactKind = "phone" | "email" | "wechat" | "whatsapp";

/** Keep legacy single-value fields compatible while storing multiple manual values. */
export function splitManualContacts(value: unknown): string[] {
  return String(value ?? "").split(/[,，;；|\r\n]+/).map((item) => item.trim()).filter(Boolean);
}

/** Preserve contacts stored by earlier imports in JSONB alongside legacy text. */
export function manualContactValues(value: unknown, stored: unknown): string[] {
  const values = [...splitManualContacts(value), ...(Array.isArray(stored) ? stored.flatMap(splitManualContacts) : [])];
  return [...new Map(values.map((item) => [item.toLowerCase(), item])).values()];
}

export function manualContactColumns(value: Record<string, unknown>) {
  return {
    phone_numbers: splitManualContacts(value.phone),
    email_addresses: splitManualContacts(value.email),
    whatsapp_numbers: splitManualContacts(value.whatsapp),
    wechat_numbers: splitManualContacts(value.wechat),
  };
}

export function normalizeManualContacts(value: unknown, kind: ManualContactKind): string {
  const labels = { phone: "联系电话", email: "邮箱", wechat: "微信号码", whatsapp: "WhatsApp号码" };
  const seen = new Set<string>();
  const normalized: string[] = [];
  const entries = Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : splitManualContacts(value);
  if (entries.length > 20) throw new Error(`${labels[kind]}最多填写20项`);
  for (const entry of entries) {
    const item = kind === "phone" || kind === "whatsapp"
      ? normalizeManualPhone(entry, labels[kind])
      : entry.normalize("NFKC").trim();
    if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) throw new Error("邮箱格式不正确");
    if (kind === "wechat" && (item.length > 100 || /[\r\n,，;；|]/.test(item))) throw new Error("微信号码格式不正确");
    const key = kind === "email" ? item.toLowerCase() : kind === "wechat" ? item.toLowerCase() : item.replace(/\D/g, "");
    if (!seen.has(key)) { seen.add(key); normalized.push(item); }
  }
  return normalized.join("; ");
}

