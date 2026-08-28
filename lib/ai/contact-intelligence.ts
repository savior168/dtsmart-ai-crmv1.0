import { createHash } from "node:crypto";
import { countryInfo } from "../countries";
import type { IdentityStatus } from "./evidence-policy";

export type ContactType = "PHONE" | "EMAIL" | "WHATSAPP" | "CONTACT_FORM" | "FACEBOOK" | "INSTAGRAM" | "LINKEDIN" | "TIKTOK" | "OTHER";
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

export function isDateLikeContactValue(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  // Dates and times are frequently exposed in JSON-LD next to telephone
  // fields by malformed themes. They are not contact numbers. Keep dotted
  // phone formats such as 01.23.45.67.89 valid by only rejecting a complete
  // three-part date whose final component is a four-digit year.
  if (/^(?:\d{1,2}[./-]){2}(?:19|20)\d{2}$/.test(raw)) return true;
  if (/^(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}$/.test(raw)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) return true;
  return false;
}

const dialCodes: Record<string, string> = {
  US: "+1", CA: "+1", GB: "+44", IE: "+353", ES: "+34", PT: "+351", FR: "+33",
  DE: "+49", IT: "+39", NL: "+31", BE: "+32", PL: "+48", SE: "+46", NO: "+47",
  DK: "+45", FI: "+358", CH: "+41", AT: "+43", AU: "+61", NZ: "+64", CN: "+86",
  HK: "+852", SG: "+65", MY: "+60", TH: "+66", VN: "+84", PH: "+63", ID: "+62",
  IN: "+91", AE: "+971", SA: "+966", ZA: "+27", MX: "+52", BR: "+55", AR: "+54",
  CO: "+57", CL: "+56", PE: "+51", EC: "+593", JP: "+81", KR: "+82",
  RU: "+7", CZ: "+420", SK: "+421", HU: "+36", RO: "+40", BG: "+359",
  GR: "+30", TR: "+90", IL: "+972", PK: "+92", BD: "+880", NG: "+234",
};

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function normalizeEmailStrict(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return "";
  if (/@(?:example\.(?:com|org|net)|test\.|invalid\.|email\.)/i.test(normalized)) return "";
  // Common misspellings shipped in website/theme demo blocks. They can be
  // exposed as real mailto links, so syntax validation alone is insufficient.
  if (/@(?:examplde|exmaple|exemple|examle)\./i.test(normalized)) return "";
  if (/^(?:your|name|example|sample|test|user)@/i.test(normalized)) return "";
  return normalized;
}

export function normalizePhoneInternational(value?: string | null, country?: string | null) {
  const raw = String(value || "").replace(/(?:ext\.?|extension|分机)\s*\d+$/i, "").trim();
  if (!raw || /[A-Za-z@]/.test(raw) || isDateLikeContactValue(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || /^(\d)\1{6,}$/.test(digits)) return "";
  // Theme/demo phone values are often emitted through a genuine `tel:` link.
  // Reject unmistakable sequential placeholders before they can be presented
  // to sales users as verified customer contacts.
  if (/0123456789|1234567890|9876543210/.test(digits)) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  // Customer country values are stored in mixed forms (PL, Poland, 波兰, PL 波兰).
  // Resolve all of them to ISO before comparing a discovered public number with
  // the original number. Otherwise the same Polish number can be mistaken for a
  // new contact merely because one copy contains "+48" and spaces.
  const isoCode = countryInfo(country).code || String(country || "").trim().toUpperCase();
  const code = dialCodes[isoCode];
  if (!code) return digits;
  const countryDigits = code.slice(1);
  if (digits.startsWith(countryDigits)) return `+${digits}`;
  digits = digits.replace(/^0+/, "");
  return digits ? `${code}${digits}` : "";
}

export function normalizePublicContactUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|igshid|ref$|ref_src$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeByType(type: ContactType, value: string, country?: string | null) {
  if (type === "EMAIL") return normalizeEmailStrict(value);
  if (type === "PHONE" || type === "WHATSAPP") return normalizePhoneInternational(value, country);
  if (["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK", "OTHER", "CONTACT_FORM"].includes(type)) return normalizePublicContactUrl(value);
  return String(value || "").trim();
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
  const normalized = normalizeByType(input.type, input.value, input.country);
  if (!normalized || !/^https?:\/\//i.test(input.sourceUrl)) return null;
  const originals = new Set((input.originalValues || []).map((item) => normalizeByType(input.type, item, input.country)).filter(Boolean));
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
  const rank = (item: ContactCandidate) => {
    const source = item.sourceChannel === "website" ? 40 : item.sourceChannel === "google_maps" ? 35 : 20;
    const status = item.verificationStatus === "MATCHED_ORIGINAL" ? 35 : item.verificationStatus === "NEW_VERIFIED" ? 30 : item.verificationStatus === "CONFLICTING_VERIFIED" ? 15 : 0;
    const purpose = item.type === "EMAIL" && /(?:sales|purchase|procurement|wholesale|trade)@/i.test(item.valueNormalized) ? 15 : item.type === "WHATSAPP" ? 10 : 5;
    return source + status + purpose;
  };
  const unique = new Map<string, ContactCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.type}|${candidate.valueNormalized}`;
    const current = unique.get(key);
    // A contact can appear on the home page, contact page and Google profile.
    // Persist it once and retain the strongest verified source instead of
    // presenting identical WhatsApp/phone/email values several times.
    if (!current || rank(candidate) > rank(current)) unique.set(key, candidate);
  }
  const values = [...unique.values()];
  // Only a contact that either matches the customer's original value or was
  // found on a strictly matched official entity can be recommended. An
  // ambiguous Google candidate is useful for audit, but must never become the
  // sales team's preferred contact.
  const preferred = values
    .filter((item) => ["MATCHED_ORIGINAL", "NEW_VERIFIED"].includes(item.verificationStatus))
    .sort((a, b) => rank(b) - rank(a))[0] || null;
  return { contacts: values, preferred };
}

type StoredContactRow = {
  type?: unknown;
  value_raw?: unknown;
  value_normalized?: unknown;
  source_channel?: unknown;
  verification_status?: unknown;
};

/** Collapses legacy duplicates at API boundaries without deleting audit rows. */
export function dedupeVerifiedContactRows<T extends StoredContactRow>(rows: T[]) {
  const sourceRank = (row: T) => {
    const source = String(row.source_channel || "");
    const status = String(row.verification_status || "");
    return (source === "website" ? 40 : source === "google_maps" ? 35 : 20)
      + (status === "MATCHED_ORIGINAL" ? 35 : status === "NEW_VERIFIED" ? 30 : 0);
  };
  const unique = new Map<string, T>();
  for (const row of rows) {
    const type = String(row.type || "").toUpperCase();
    const raw = String(row.value_raw || "").trim();
    if (!type || !raw || (["PHONE", "WHATSAPP"].includes(type) && isDateLikeContactValue(raw))) continue;
    // Revalidate the raw value on every read. Older rows may contain a stored
    // normalized value that predates the stricter placeholder/date rules.
    const normalized = type === "EMAIL"
      ? normalizeEmailStrict(raw)
      : ["PHONE", "WHATSAPP"].includes(type)
        ? normalizePhoneInternational(raw)
        : normalizePublicContactUrl(raw);
    if (!normalized) continue;
    const key = `${type}|${normalized}`;
    const current = unique.get(key);
    if (!current || sourceRank(row) > sourceRank(current)) unique.set(key, row);
  }
  return [...unique.values()];
}


