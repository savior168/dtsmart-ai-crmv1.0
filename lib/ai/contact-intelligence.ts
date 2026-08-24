import { createHash } from "node:crypto";
import type { IdentityStatus } from "./evidence-policy";

export type ContactType = "PHONE" | "EMAIL" | "WHATSAPP" | "CONTACT_FORM" | "FACEBOOK" | "INSTAGRAM" | "LINKEDIN" | "OTHER";
export type ContactVerification = "ORIGINAL" | "MATCHED_ORIGINAL" | "NEW_VERIFIED" | "CONFLICTING_VERIFIED" | "UNVERIFIED" | "STALE" | "INVALID";

export type ContactCandidate = {
  type: ContactType;
  valueRaw: string;
  valueNormalized: string;
  sourceChannel: string;
  sourceUrl: string;
  sourcePageTitle?: string | null;
  capturedAt: string;
  identityStatus: IdentityStatus;
  verificationStatus: ContactVerification;
  contactStatus: string;
  contentHash: string;
};

const dialCodes: Record<string, string> = {
  US: "+1", CA: "+1", GB: "+44", IE: "+353", ES: "+34", PT: "+351", FR: "+33",
  DE: "+49", IT: "+39", NL: "+31", BE: "+32", PL: "+48", SE: "+46", NO: "+47",
  DK: "+45", FI: "+358", CH: "+41", AT: "+43", AU: "+61", NZ: "+64", CN: "+86",
  HK: "+852", SG: "+65", MY: "+60", TH: "+66", VN: "+84", PH: "+63", ID: "+62",
  IN: "+91", AE: "+971", SA: "+966", ZA: "+27", MX: "+52", BR: "+55", AR: "+54",
  CO: "+57", CL: "+56", PE: "+51", EC: "+593",
};

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function normalizeEmailStrict(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return "";
  if (/@(?:example\.(?:com|org|net)|test\.|invalid\.|email\.)/i.test(normalized)) return "";
  if (/^(?:your|name|example|sample|test|user)@/i.test(normalized)) return "";
  return normalized;
}

export function normalizePhoneInternational(value?: string | null, country?: string | null) {
  const raw = String(value || "").replace(/(?:ext\.?|extension|分机)\s*\d+$/i, "").trim();
  if (!raw || /[A-Za-z@]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || /^(\d)\1{6,}$/.test(digits)) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  const code = dialCodes[String(country || "").trim().toUpperCase()];
  if (!code) return digits;
  const countryDigits = code.slice(1);
  if (digits.startsWith(countryDigits)) return `+${digits}`;
  digits = digits.replace(/^0+/, "");
  return digits ? `${code}${digits}` : "";
}

export function buildContactCandidate(input: {
  type: ContactType;
  value: string;
  country?: string | null;
  sourceChannel: string;
  sourceUrl: string;
  sourcePageTitle?: string | null;
  identityStatus: IdentityStatus;
  originalValues?: string[];
  capturedAt?: string;
}): ContactCandidate | null {
  const normalized = input.type === "EMAIL"
    ? normalizeEmailStrict(input.value)
    : input.type === "PHONE" || input.type === "WHATSAPP"
      ? normalizePhoneInternational(input.value, input.country)
      : String(input.value || "").trim();
  if (!normalized || !/^https?:\/\//i.test(input.sourceUrl)) return null;
  const originals = new Set((input.originalValues || []).map((item) => input.type === "EMAIL" ? normalizeEmailStrict(item) : normalizePhoneInternational(item, input.country)).filter(Boolean));
  const official = ["website", "google_maps", "facebook", "instagram", "linkedin"].includes(input.sourceChannel);
  const verificationStatus: ContactVerification = originals.has(normalized)
    ? "MATCHED_ORIGINAL"
    : input.identityStatus === "MATCHED" && official ? "NEW_VERIFIED" : "UNVERIFIED";
  const capturedAt = input.capturedAt || new Date().toISOString();
  return {
    type: input.type, valueRaw: input.value.trim(), valueNormalized: normalized,
    sourceChannel: input.sourceChannel, sourceUrl: input.sourceUrl,
    sourcePageTitle: input.sourcePageTitle || null, capturedAt, identityStatus: input.identityStatus,
    verificationStatus, contactStatus: input.type === "WHATSAPP" ? "WHATSAPP_CONFIRMED" : "ACTIVE_UNKNOWN",
    contentHash: digest(`${input.type}|${normalized}|${input.sourceUrl}`),
  };
}

export function reconcileContacts(candidates: ContactCandidate[]) {
  const unique = new Map<string, ContactCandidate>();
  for (const candidate of candidates) unique.set(`${candidate.type}|${candidate.valueNormalized}|${candidate.sourceUrl}`, candidate);
  const values = [...unique.values()];
  for (const type of ["PHONE", "EMAIL"] as const) {
    const officialNew = values.filter((item) => item.type === type && item.verificationStatus === "NEW_VERIFIED");
    const distinct = new Set(officialNew.map((item) => item.valueNormalized));
    if (distinct.size > 1) officialNew.forEach((item) => { item.verificationStatus = "CONFLICTING_VERIFIED"; });
  }
  const rank = (item: ContactCandidate) => {
    const source = item.sourceChannel === "website" ? 40 : item.sourceChannel === "google_maps" ? 35 : 20;
    const status = item.verificationStatus === "MATCHED_ORIGINAL" ? 35 : item.verificationStatus === "NEW_VERIFIED" ? 30 : item.verificationStatus === "CONFLICTING_VERIFIED" ? 15 : 0;
    const purpose = item.type === "EMAIL" && /(?:sales|purchase|procurement|wholesale|trade)@/i.test(item.valueNormalized) ? 15 : item.type === "WHATSAPP" ? 10 : 5;
    return source + status + purpose;
  };
  const preferred = values.filter((item) => !["INVALID", "STALE"].includes(item.verificationStatus)).sort((a, b) => rank(b) - rank(a))[0] || null;
  return { contacts: values, preferred };
}

