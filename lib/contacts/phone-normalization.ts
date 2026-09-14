import { countryInfo } from "../countries";

const dialCodes: Record<string, string> = {
  US: "+1", CA: "+1", GB: "+44", IE: "+353", ES: "+34", PT: "+351", FR: "+33", DE: "+49", IT: "+39", NL: "+31", BE: "+32", PL: "+48", SE: "+46", NO: "+47", DK: "+45", FI: "+358", CH: "+41", AT: "+43", AU: "+61", NZ: "+64", CN: "+86", HK: "+852", SG: "+65", MY: "+60", TH: "+66", VN: "+84", PH: "+63", ID: "+62", IN: "+91", AE: "+971", SA: "+966", ZA: "+27", MX: "+52", BR: "+55", AR: "+54", CO: "+57", CL: "+56", PE: "+51", EC: "+593", JP: "+81", KR: "+82", RU: "+7", CZ: "+420", SK: "+421", HU: "+36", RO: "+40", BG: "+359", GR: "+30", TR: "+90", IL: "+972", PK: "+92", BD: "+880", NG: "+234",
};

export function isDateLikeContactValue(value?: string | null) {
  const raw = String(value || "").trim();
  return Boolean(raw) && (/^(?:\d{1,2}[./-]){2}(?:19|20)\d{2}$/.test(raw) || /^(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}$/.test(raw) || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw));
}

export function normalizePhoneInternational(value?: string | null, country?: string | null) {
  const raw = String(value || "").replace(/(?:ext\.?|extension|分机)\s*\d+$/i, "").trim();
  if (!raw || /[A-Za-z@]/.test(raw) || isDateLikeContactValue(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || /^(\d)\1{6,}$/.test(digits) || /0123456789|1234567890|9876543210/.test(digits)) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  const isoCode = countryInfo(country).code || String(country || "").trim().toUpperCase();
  const code = dialCodes[isoCode];
  if (!code) return digits;
  if (digits.startsWith(code.slice(1))) return `+${digits}`;
  digits = digits.replace(/^0+/, "");
  return digits ? `${code}${digits}` : "";
}

/** Display-only formatting. It never changes the raw contact stored for a customer. */
export function formatPhoneInternational(value?: string | null, country?: string | null) {
  const normalized = normalizePhoneInternational(value, country);
  if (!normalized.startsWith("+")) return String(value || "").trim() || "未提供";
  const isoCode = countryInfo(country).code || String(country || "").trim().toUpperCase();
  const knownCode = dialCodes[isoCode] || Object.values(dialCodes).sort((a, b) => b.length - a.length).find((item) => normalized.startsWith(item)) || "";
  const prefix = knownCode || `+${normalized.slice(1, Math.min(4, normalized.length))}`;
  const national = normalized.slice(prefix.length);
  if (!national) return normalized;
  const finalLength = national.length % 3 === 1 && national.length > 4 ? 4 : 3;
  const groups: string[] = national.slice(0, -finalLength).match(/.{1,3}/g) || [];
  groups.push(national.slice(-finalLength));
  return `${prefix} ${groups.join(" ")}`;
}
