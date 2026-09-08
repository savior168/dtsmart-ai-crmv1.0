import { lookup } from "node:dns/promises";
import { isDateLikeContactValue } from "./contact-intelligence";
import { countryInfo } from "../countries";

export type WebsiteEvidence = {
  url: string;
  reachable: boolean;
  language?: string;
  title?: string;
  description?: string;
  structured_types?: string[];
  structured_names?: string[];
  structured_descriptions?: string[];
  headings: string[];
  text_excerpt?: string;
  image_alts: string[];
  image_urls: string[];
  emails: string[];
  phones: string[];
  whatsapps?: string[];
  social_urls?: string[];
  video_urls?: string[];
  pages?: Array<{ url: string; title?: string; description?: string; headings: string[]; text_excerpt?: string; image_alts: string[]; image_urls: string[]; video_urls?: string[]; emails: string[]; phones: string[]; whatsapps?: string[]; social_urls?: string[] }>;
  error?: string;
};

export type GooglePlaceEvidence = {
  configured: boolean;
  query?: string;
  name?: string;
  formatted_address?: string;
  business_status?: string;
  rating?: number;
  user_ratings_total?: number;
  types: string[];
  website?: string;
  phone?: string;
  description?: string;
  opening_hours?: string[];
  image_urls?: string[];
  video_urls?: string[];
  emails?: string[];
  reviews: string[];
  place_id?: string;
  candidate_count?: number;
  identity_status?: "MATCHED" | "LIKELY_MATCHED" | "AMBIGUOUS" | "CONFLICTED" | "NOT_FOUND";
  identity_confidence?: number;
  match_signals?: string[];
  mismatch_signals?: string[];
  verified_google_maps_url?: string;
  error?: string;
};

export type CustomerEvidence = {
  website?: WebsiteEvidence;
  google_place?: GooglePlaceEvidence;
  public_channels?: Record<string, WebsiteEvidence>;
};

export type ExternalApiCall = { provider:"GOOGLE_PLACES";operation:string;sku:string;requestId?:string;unitPriceUsd:number|null;status:number };
type FetchOptions = { signal?: AbortSignal; timeoutMs?: number; onApiCall?:(call:ExternalApiCall)=>void|Promise<void> };

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

function requestSignal(options: FetchOptions, fallbackMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || fallbackMs);
  return {
    signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function evidenceDomain(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol)
      ? url.hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch { return ""; }
}

function normalizeUrl(url?: string | null) {
  const value = url?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/**
 * Some public business sites block only one hostname variant (usually `www`)
 * while their canonical bare domain remains accessible. Retry only the same
 * host with protocol/www normalization; never broaden to another domain.
 */
export function websiteUrlCandidates(url?: string | null) {
  const normalized = safePublicUrl(url);
  if (!normalized) return [];
  try {
    const original = new URL(normalized);
    const hosts = original.hostname.startsWith("www.")
      ? [original.hostname, original.hostname.slice(4)]
      : [original.hostname, `www.${original.hostname}`];
    const candidates = [
      original.toString(),
      ...hosts.map((host) => {
        const candidate = new URL(original.toString());
        candidate.protocol = "https:";
        candidate.hostname = host;
        return candidate.toString();
      }),
    ];
    return unique(candidates.map((candidate) => safePublicUrl(candidate) || ""));
  } catch {
    return [normalized];
  }
}

function compactText(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(html: string, pattern: RegExp, limit = 10) {
  return [...html.matchAll(pattern)].slice(0, limit).map((match) => compactText(match[1] || "")).filter(Boolean);
}

function firstMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match ? compactText(match[1] || "") : undefined;
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

// Only direct, visually verifiable target-business terms qualify a website
// image for AI inspection. Generic words such as shop/store/product are not
// enough: they frequently select hero banners, device adverts or ordinary
// storefront photos that do not prove repair/parts activity.
const DIRECT_BUSINESS_MEDIA_TERMS = /(?:phone[\s_-]*repair|mobile[\s_-]*repair|iphone[\s_-]*repair|ipad[\s_-]*repair|macbook[\s_-]*repair|computer[\s_-]*repair|laptop[\s_-]*repair|screen[\s_-]*(?:repair|replacement)|battery[\s_-]*(?:repair|replacement)|charging[\s_-]*port|motherboard[\s_-]*repair|repair[\s_-]*(?:bench|workshop|parts?)|spare[\s_-]*parts?|replacement[\s_-]*parts?|internal[\s_-]*parts?|wholesale[\s_-]*(?:phone|mobile|computer|repair|parts?)|telefon[^\s_-]*[\s_-]*(?:reparatur|napraw)|napraw[^\s_-]*[\s_-]*(?:telefon|kom[oó]rk|komputer|laptop)|serwis[\s_-]*(?:telefon|kom[oó]rk|komputer|laptop)|reparaci[oó]n[\s_-]*(?:de[\s_-]*)?(?:m[oó]vil|tel[eé]fono|ordenador|computadora)|r[eé]paration[\s_-]*(?:de[\s_-]*)?(?:t[eé]l[eé]phone|mobile|ordinateur)|riparazione[\s_-]*(?:telefono|cellulare|computer)|手机[\s_-]*(?:维修|修理)|电脑[\s_-]*(?:维修|修理)|屏幕[\s_-]*(?:更换|维修)|电池[\s_-]*(?:更换|维修)|充电口[\s_-]*(?:更换|维修)|主板[\s_-]*(?:更换|维修)|维修[\s_-]*(?:工作台|内配件|零件|配件)|内配件[\s_-]*(?:货架|陈列|批发))/i;
const DECORATIVE_MEDIA_TERMS = /(?:logo|icon|avatar|favicon|sprite|placeholder|spinner|loader|tracking|pixel|badge|payment|flag|emoji|newsletter|cookie|banner-ad)/i;

function originalMediaUrl(raw: string, baseUrl: string) {
  try {
    const decoded = decodeHtmlAttribute(raw.trim());
    if (!decoded || /^(?:data|blob|javascript):/i.test(decoded)) return null;
    const url = new URL(decoded, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    // Google business photos commonly expose many resized variants of the
    // same photo. Keep the canonical photo path and request its original
    // resolution instead of persisting a blurred thumbnail.
    if (/\.googleusercontent\.com$/i.test(url.hostname) && /\/p\//i.test(url.pathname)) {
      url.search = "";
      url.hash = "";
      return `${url.origin}${url.pathname.replace(/=(?:w|s)\d+.*$/i, "")}=s0`;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function mediaIdentity(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\.(?:thumb|thumbnail)(?=\.)/i, "").replace(/[-_](?:\d{2,4}x\d{2,4}|thumb|thumbnail)(?=\.)/gi, "");
    return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return url.toLowerCase();
  }
}

function uniqueOriginalMedia(values: string[], baseUrl: string, limit: number) {
  const output = new Map<string, string>();
  for (const raw of values) {
    const url = originalMediaUrl(raw, baseUrl);
    if (!url || DECORATIVE_MEDIA_TERMS.test(url) || /\.svg(?:\?|$)/i.test(url)) continue;
    const key = mediaIdentity(url);
    if (!output.has(key)) output.set(key, url);
    if (output.size >= limit) break;
  }
  return [...output.values()];
}

function largestSrcsetCandidate(srcset: string) {
  return srcset.split(",")
    .map((item) => {
      const [raw = "", descriptor = ""] = item.trim().split(/\s+/);
      const numeric = Number.parseFloat(descriptor);
      const weight = /w$/i.test(descriptor) ? numeric : /x$/i.test(descriptor) ? numeric * 1000 : 0;
      return { raw, weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((item) => item.raw)
    .sort((a, b) => b.weight - a.weight)[0]?.raw || "";
}

function explicitImageDimension(tag: string, name: "width" | "height") {
  const raw = tag.match(new RegExp(`\\b${name}=["']?(\\d+)`, "i"))?.[1];
  return raw ? Number.parseInt(raw, 10) : 0;
}

export function extractRelevantWebsiteImages(html: string, baseUrl: string) {
  const ranked = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match, index) => {
    const tag = match[0];
    const alt = decodeHtmlAttribute(tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "");
    const title = decodeHtmlAttribute(tag.match(/\btitle=["']([^"']*)["']/i)?.[1] || "");
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1] || "";
    const raw = largestSrcsetCandidate(srcset)
      || tag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1]
      || "";
    const context = `${alt} ${title} ${raw}`;
    if (!raw || DECORATIVE_MEDIA_TERMS.test(context)) return [];
    const width = explicitImageDimension(tag, "width");
    const height = explicitImageDimension(tag, "height");
    // Explicitly tiny assets are icons/thumbnails even if their filename
    // happens to contain a business keyword. Unknown dimensions are retained
    // because responsive sites commonly omit width/height from the HTML.
    if ((width > 0 && width < 480) || (height > 0 && height < 320)) return [];
    const score = (DIRECT_BUSINESS_MEDIA_TERMS.test(context) ? 100 : 0)
      + (width >= 1200 || height >= 800 ? 15 : 0)
      - index / 100;
    return [{ raw, score }];
  }).sort((a, b) => b.score - a.score);
  // Keep only direct business media. The returned URL is canonicalized to the
  // largest/original variant so evidence pages never persist a blurry thumb.
  return uniqueOriginalMedia(ranked.filter((item) => item.score >= 100).map((item) => item.raw), baseUrl, 12);
}

function extractRelevantWebsiteVideos(html: string, baseUrl: string) {
  const values = [...html.matchAll(/<(?:video|source|iframe)\b[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((value) => /(?:youtube\.com|youtu\.be|vimeo\.com|\.mp4(?:\?|$)|\.webm(?:\?|$))/i.test(value));
  return uniqueOriginalMedia(values, baseUrl, 8);
}

function extractStructuredBusinessData(html: string) {
  const types: string[] = [];
  const names: string[] = [];
  const descriptions: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    const rawTypes = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    rawTypes.filter((item): item is string => typeof item === "string").forEach((item) => types.push(item));
    if (typeof record.name === "string") names.push(compactText(record.name));
    if (typeof record.description === "string") descriptions.push(compactText(record.description));
    for (const key of ["category", "serviceType", "knowsAbout", "makesOffer", "itemOffered", "department", "hasOfferCatalog", "@graph"]) visit(record[key]);
  };
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch { /* malformed third-party JSON-LD is ignored */ }
  }
  for (const match of html.matchAll(/itemtype=["'][^"']*schema\.org\/([^"'\s>]+)["']/gi)) types.push(match[1]);
  return { types: unique(types).slice(0, 24), names: unique(names).slice(0, 12), descriptions: unique(descriptions).slice(0, 12) };
}

function decodeCloudflareEmail(encoded: string) {
  if (!/^[0-9a-f]{4,}$/i.test(encoded) || encoded.length % 2 !== 0) return "";
  const key = Number.parseInt(encoded.slice(0, 2), 16);
  let value = "";
  for (let index = 2; index < encoded.length; index += 2) value += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16) ^ key);
  return value;
}

function extractEmails(text: string) {
  const decoded = decodeHtmlAttribute(text);
  // Scan rendered text rather than raw source so addresses embedded in scripts,
  // analytics payloads and third-party widgets cannot become customer contacts.
  const direct = compactText(decoded).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const mailto = [...decoded.matchAll(/href=["']mailto:([^"'?#]+)["']/gi)].map((match) => decodeURIComponent(match[1]));
  const structured = [...decoded.matchAll(/["']email["']\s*:\s*["']([^"']+@[A-Z0-9.-]+\.[A-Z]{2,})["']/gi)].map((match) => match[1]);
  const cloudflare = [...decoded.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)].map((match) => decodeCloudflareEmail(match[1]));
  return unique([...direct, ...mailto, ...structured, ...cloudflare].map((email) => email.trim().toLowerCase()).filter((email) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email))).slice(0, 20);
}

function safePublicUrl(url?: string | null) {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") return null;
    if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return parsed.toString();
  } catch { return null; }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  return /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(normalized)
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

async function assertPublicHost(url: string) {
  const host = new URL(url).hostname;
  let addresses: Array<{ address: string; family: number }> = [];
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await waitForRetry(attempt);
    }
  }
  if (!addresses.length && lastError) throw lastError;
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("UNSAFE_SOURCE_ADDRESS");
  }
}

function normalizedPlaceQueryPart(value?: string | null) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function countryQueryLabel(value?: string | null) {
  const info = countryInfo(value);
  if (!info.code) return normalizedPlaceQueryPart(value);
  return new Intl.DisplayNames(["en"], { type: "region" }).of(info.code) || info.name || info.code;
}

export function placeAddressCountryStatus(country?: string | null, address?: string | null): "MATCH" | "MISMATCH" | "UNKNOWN" {
  const expected = countryInfo(country).code;
  const normalizedAddress = normalizedPlaceQueryPart(address);
  if (!expected || !normalizedAddress) return "UNKNOWN";
  const segments = normalizedAddress.split(",").map((part) => part.trim()).filter(Boolean).reverse();
  for (const segment of segments.slice(0, 2)) {
    const detected = countryInfo(segment).code;
    if (detected) return detected === expected ? "MATCH" : "MISMATCH";
  }
  const labels = [
    countryInfo(country).name,
    new Intl.DisplayNames(["en"], { type: "region" }).of(expected),
    new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(expected),
  ].filter((item): item is string => Boolean(item && item.length > 2));
  return labels.some((label) => normalizedAddress.toLocaleLowerCase().includes(label.toLocaleLowerCase())) ? "MATCH" : "UNKNOWN";
}

export function googlePlaceTextQueries(input: {
  company_name: string;
  address?: string | null;
  country?: string | null;
  phone?: string | null;
}) {
  const name = normalizedPlaceQueryPart(input.company_name);
  const address = normalizedPlaceQueryPart(input.address);
  const location = address || (String(input.country || "").length > 2 ? normalizedPlaceQueryPart(input.country) : "");
  // A supplied address is the most precise locator and may already contain the
  // company name. Search that exact address first, then compare every returned
  // entity by name, full address and telephone before accepting it.
  const primary = address || [name, location].filter(Boolean).join(", ");
  const phone = String(input.phone || "").replace(/[^\d+]/g, "");
  const country = countryQueryLabel(input.country);
  const identityFallback = phone.length >= 7 ? [name, phone, country].filter(Boolean).join(" ") : [name, country].filter(Boolean).join(" ");
  return [...new Set([primary, identityFallback].filter(Boolean))].slice(0, 2);
}

const NON_INDUSTRY_PLACE_TYPES = new Set([
  "service", "services", "point_of_interest", "establishment", "general_contractor",
  "contractor", "store", "business", "company",
]);

export function googlePlaceNeedsBusinessClarification(types: string[], identityScore: number) {
  const normalizedTypes = types.map((value) => String(value).trim().toLowerCase().replace(/\s+/g, "_"));
  const hasSpecificPlaceType = normalizedTypes.some((type) => type && !NON_INDUSTRY_PLACE_TYPES.has(type));
  const targetAdjacentPlaceType = normalizedTypes.some((type) => /(?:cell_phone|mobile_phone|electronics|computer|repair|accessor|store)/i.test(type));
  return identityScore >= 70 && (!hasSpecificPlaceType || targetAdjacentPlaceType);
}

async function waitForRetry(attempt: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, 250 * (2 ** attempt));
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function fetchWithRetry(url: string | URL, init: RequestInit, retries = 2) {
  let response: Response | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      response = await fetch(url, init);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === retries) throw error;
    }
    await waitForRetry(attempt, init.signal || undefined);
  }
  if (!response && lastError) throw lastError;
  return response!;
}

async function readTextLimited(response: Response, maxBytes = 350_000) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - size;
    chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
    size += Math.min(value.length, remaining);
    if (value.length > remaining) {
      await reader.cancel("SOURCE_RESPONSE_TOO_LARGE");
      break;
    }
  }
  const bytes = Buffer.concat(chunks);
  // Legacy non-UTF-8 sites are still common internationally. Respect the
  // declared charset so multilingual business evidence is not corrupted.
  const headerCharset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  const asciiPreview = bytes.subarray(0, Math.min(bytes.length, 8192)).toString("latin1");
  const metaCharset = asciiPreview.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1]
    || asciiPreview.match(/<meta[^>]+content=["'][^"']*charset\s*=\s*([^\s"';>]+)/i)?.[1];
  const declared = String(headerCharset || metaCharset || "utf-8").trim().toLowerCase();
  const aliases: Record<string, string> = {
    utf8: "utf-8",
    "iso-8859-1": "windows-1252",
    latin1: "windows-1252",
    gb2312: "gbk",
    "gb_2312-80": "gbk",
    "shift-jis": "shift_jis",
    sjis: "shift_jis",
    "x-sjis": "shift_jis",
    eucjp: "euc-jp",
    "ks_c_5601-1987": "euc-kr",
  };
  try {
    return new TextDecoder(aliases[declared] || declared).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchPublic(url: string, init: RequestInit, maxRedirects = 3): Promise<Response> {
  let current = safePublicUrl(url);
  if (!current) throw new Error("UNSAFE_SOURCE_URL");
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicHost(current);
    const response: Response = await fetchWithRetry(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 2_000_000) throw new Error("SOURCE_RESPONSE_TOO_LARGE");
      return response;
    }
    const location: string | null = response.headers.get("location");
    current = location ? safePublicUrl(new URL(location, current).toString()) : null;
    if (!current) throw new Error("UNSAFE_SOURCE_REDIRECT");
  }
  throw new Error("SOURCE_REDIRECT_LIMIT");
}

export function isPlausiblePhone(value?: string | null) {
  const candidate = String(value || "").replace(/(?:ext\.?|extension|分机)\s*\d+$/i, "").trim();
  if (!candidate || /[A-Za-z@]/.test(candidate) || isDateLikeContactValue(candidate)) return false;
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^(\d)\1{6,}$/.test(digits)) return false;
  return true;
}

function extractPhones(html: string) {
  // Only accept explicit telephone markup or a nearby telephone label. Scanning every
  // number on a page also captures prices, dates, product codes and analytics values.
  const labeledText = compactText(html);
  const candidates = [
    ...[...html.matchAll(/href=["']tel:([^"'?#]+)["']/gi)].map((match) => decodeURIComponent(match[1]).replace(/^\/\//, "")),
    ...[...html.matchAll(/["'](?:telephone|phone)["']\s*:\s*["']([^"']+)["']/gi)].map((match) => match[1]),
      ...[...labeledText.matchAll(/(?:电话|联系电话|联系电话号码|tel(?:ephone)?|phone|mobile|mobil|handy|telefon(?:nummer)?|téléphone|teléfono|telefono|telefone)\s*[:：]?\s*(\+?\d[\d\s\-().]{5,}\d)/gi)].map((match) => match[1]),
  ];
  return unique(candidates.map((phone) => phone.replace(/\s+/g, " ").trim()).filter(isPlausiblePhone)).slice(0, 12);
}

function extractWhatsapps(text: string) {
  const decoded = decodeHtmlAttribute(text);
  const values = [...decoded.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?[^"'\s>]*phone=|whatsapp:\/\/send\?[^"'\s>]*phone=)([^&"'\s<>]+)/gi)]
    .map((match) => decodeURIComponent(match[1]).replace(/[^+\d]/g, ""))
    .filter((value) => value.replace(/\D/g, "").length >= 7);
  return unique(values).slice(0, 12);
}

function extractSocialUrls(html: string, baseUrl: string) {
  const supported = /(?:facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|wa\.me|api\.whatsapp\.com)/i;
  return unique([...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => {
      try { return new URL(decodeHtmlAttribute(match[1]), baseUrl).toString(); } catch { return ""; }
    })
    .filter((url) => {
      if (!supported.test(url)) return false;
      try {
        const parsed = new URL(url);
        // Platform home pages such as facebook.com/ or instagram.com/ are
        // theme placeholders, not merchant contact profiles.
        if (/(?:facebook|instagram|linkedin|tiktok)\.com$/i.test(parsed.hostname.replace(/^www\./, ""))) {
          return parsed.pathname.split("/").filter(Boolean).length > 0;
        }
        return true;
      } catch { return false; }
    }))
    .slice(0, 20);
}

async function collectWebsiteEvidenceOnce(url?: string | null, options: FetchOptions = {}): Promise<WebsiteEvidence | undefined> {
  const normalized = safePublicUrl(url);
  if (!normalized) return undefined;

  const request = requestSignal(options, 5000);
  try {
    const parsedUrl = new URL(normalized);
    if (/google\./i.test(parsedUrl.hostname) && /^\/search/i.test(parsedUrl.pathname)) {
      return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], emails: [], phones: [], error: "搜索结果页不是具体企业页面" };
    }
    const response = await fetchPublic(normalized, {
      signal: request.signal,
      headers: BROWSER_HEADERS,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], emails: [], phones: [], error: `HTTP ${response.status}` };
    }
    const html = await readTextLimited(response, 700_000);
    const structured = extractStructuredBusinessData(html);
    const visibleText = compactText(html).slice(0, 6000);
    if (/(?:log in|sign in|登录后继续|cookie settings|accept all cookies)/i.test(`${firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || ""} ${visibleText}`)
        && /(?:facebook|instagram|linkedin|tiktok)\.com/i.test(parsedUrl.hostname)) {
      return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], emails: [], phones: [], error: "社媒登录页或Cookie页，未读取到企业公开主页" };
    }
    const imageUrls = extractRelevantWebsiteImages(html, normalized);
    return {
      url: normalized,
      reachable: true,
      language: firstMatch(html, /<html[^>]+lang=["']([^"']+)["']/i)
        || response.headers.get("content-language")?.split(",")[0]?.trim()
        || undefined,
      title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description: firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i),
      structured_types: structured.types,
      structured_names: structured.names,
      structured_descriptions: structured.descriptions,
      headings: matches(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 16),
      text_excerpt: visibleText.slice(0, 5000),
      image_alts: matches(html, /<img[^>]+alt=["']([^"']+)["'][^>]*>/gi, 16),
      image_urls: imageUrls,
      emails: extractEmails(html),
      phones: extractPhones(html),
      whatsapps: extractWhatsapps(html),
      social_urls: extractSocialUrls(html, normalized),
      video_urls: extractRelevantWebsiteVideos(html, normalized),
    };
  } catch (error) {
    return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], emails: [], phones: [], error: error instanceof Error ? error.message : "website fetch failed" };
  } finally {
    request.clear();
  }
}

function sameWebsiteUrl(base: string, candidate: string) {
  try {
    const resolved = new URL(candidate, base);
    const origin = new URL(base);
    return ["http:", "https:"].includes(resolved.protocol) && resolved.hostname === origin.hostname ? safePublicUrl(resolved.toString()) : null;
  } catch {
    return null;
  }
}

async function discoverImportantWebsitePages(url: string, options: FetchOptions = {}) {
  const request = requestSignal(options, 3500);
  try {
    const response = await fetchPublic(url, {
      signal: request.signal,
      headers: BROWSER_HEADERS,
    });
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return [];
    const html = await readTextLimited(response);
    // Known words give a strong ranking signal, but they are deliberately not
    // the only route to discovery. A website can use any language, omit html
    // lang, or use localized slugs. In that case we still inspect a small set
    // of shallow same-origin navigation pages and let the multilingual model
    // interpret their original text. This keeps coverage global without
    // crawling an entire site or inflating token cost.
    const keywords = /about|company|service|product|contact|support|team|portfolio|solution|repair|shop|store|business|o nas|kontakt|usług|serwis|napraw|produkt|empresa|nosotros|contacto|servicio|reparaci|producto|à propos|contact|service|répar|produit|azienda|chi siamo|contatt|servizi|ripar|prodott|empresa|sobre|contato|serviç|repara|produto|über uns|kontakt|dienst|reparatur|produkt|о нас|контакт|услуг|ремонт|продукт|会社|私たち|連絡|サービス|修理|製品|公司|关于|服务|维修|产品|联系|會社|關於|服務|維修|產品|聯絡/i;
    const excluded = /privacy|policy|terms|legal|cookie|login|sign[ -]?in|register|account|cart|checkout|wishlist|blog|news|press|career|vacan|polityka|regulamin|privacidad|mentions-l[eé]gales|impressum|隐私|条款|登录|注册|购物车/i;
    const navigationLinks = [...html.matchAll(/<a[^>]+href=['\"]([^'\"#]+)['\"][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match, index) => ({ url: sameWebsiteUrl(url, match[1]), text: compactText(match[2]), index }))
      .filter((item): item is { url: string; text: string; index: number } => Boolean(item.url) && item.url !== url);
    // Important service pages are often absent from the visible home-page
    // navigation. Read the site's own sitemap as a bounded discovery source;
    // URLs still have to be same-origin and pass the business-page ranking.
    let sitemapLinks: Array<{ url: string; text: string; index: number }> = [];
    try {
      const sitemapUrl = new URL("/sitemap.xml", url).toString();
      const sitemapResponse = await fetchPublic(sitemapUrl, { signal: request.signal, headers: BROWSER_HEADERS });
      if (sitemapResponse.ok) {
        const sitemap = await readTextLimited(sitemapResponse, 350_000);
        sitemapLinks = [...sitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
          .slice(0, 300)
          .map((match, index) => ({ url: sameWebsiteUrl(url, decodeHtmlAttribute(compactText(match[1]))), text: "", index: navigationLinks.length + index }))
          .filter((item): item is { url: string; text: string; index: number } => Boolean(item.url) && item.url !== url);
      }
    } catch { /* A missing or blocked sitemap does not invalidate the website. */ }
    const links = [...navigationLinks, ...sitemapLinks]
      .filter((item) => !excluded.test(`${item.url} ${item.text}`))
      .map((item) => {
        const candidate = new URL(item.url);
        const depth = candidate.pathname.split("/").filter(Boolean).length;
        const label = `${candidate.pathname} ${item.text}`;
        // Prefer service/category pages over individual product detail pages.
        // Detail pages otherwise crowd out About, Services and Contact pages
        // while adding little company-level evidence.
        const directBusinessDetail = /(?:repair|reparatur|reparasjon|reparaci|r[eé]paration|riparazione|napraw|serwis|screen|battery|charging|parts?|spare|wholesale|dealer|b2b|维修|屏幕|电池|配件|批发)/i.test(label);
        const detailPagePenalty = /\/(?:product|item|sku)\//i.test(candidate.pathname) && !directBusinessDetail ? 80 : 0;
        const score = (keywords.test(label) ? 100 : 0)
          + (depth <= 1 ? 18 : depth === 2 ? 8 : 0)
          + (item.text.length >= 2 && item.text.length <= 40 ? 5 : 0)
          - Math.min(12, item.index / 12)
          - detailPagePenalty;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const ranked = [...new Map(links.map((item) => [item.url, item])).values()];
    const selected: string[] = [];
    const take = (pattern: RegExp, count: number) => {
      for (const item of ranked) {
        if (selected.length >= 8 || selected.filter((value) => pattern.test(value)).length >= count) break;
        if (pattern.test(`${item.url} ${item.text}`) && !selected.includes(item.url)) selected.push(item.url);
      }
    };
    // Preserve coverage across business proof, catalogue/B2B and identity
    // pages instead of allowing six similar navigation items to crowd out the
    // page that actually proves the customer's activity.
    take(/repair|service|serwis|reparatur|reparasjon|napraw|reparaci|r[eé]paration|ripar|维修|修理/i, 3);
    take(/product|parts?|spare|accessor|wholesale|dealer|trade|b2b|shop|store|produkt|配件|批发|产品/i, 2);
    take(/about|company|team|contact|impressum|legal|kontakt|über-uns|o-nas|关于|联系|公司/i, 2);
    for (const item of ranked) {
      if (selected.length >= 8) break;
      if (!selected.includes(item.url)) selected.push(item.url);
    }
    return selected;
  } catch {
    return [];
  } finally {
    request.clear();
  }
}

async function discoverRelevantChildPages(rootUrl: string, seedUrls: string[], options: FetchOptions = {}) {
  const request = requestSignal(options, 5_000);
  const businessPath = /repair|service|serwis|reparatur|reparasjon|napraw|reparaci|r[eé]paration|ripar|screen|battery|charging|motherboard|parts?|spare|accessor|wholesale|dealer|trade|b2b|product|produkt|about|company|contact|kontakt|impressum|维修|修理|屏幕|电池|主板|配件|批发|关于|联系/i;
  const excluded = /privacy|policy|terms|cookie|login|sign[ -]?in|register|account|cart|checkout|wishlist|blog|news|press|career|vacan|隐私|条款|登录|注册|购物车/i;
  try {
    const rootOrigin = new URL(rootUrl).origin;
    const batches = await mapWithConcurrency(seedUrls.slice(0, 3), 2, async (seedUrl) => {
      try {
        const response = await fetchPublic(seedUrl, { signal: request.signal, headers: BROWSER_HEADERS });
        if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return [];
        const html = await readTextLimited(response, 500_000);
        return [...html.matchAll(/<a[^>]+href=['\"]([^'\"#]+)['\"][^>]*>([\s\S]*?)<\/a>/gi)]
          .map((match) => ({ url: sameWebsiteUrl(rootUrl, match[1]), label: compactText(match[2]) }))
          .filter((item): item is { url: string; label: string } => Boolean(item.url))
          .filter((item) => {
            const parsed = new URL(item.url);
            const depth = parsed.pathname.split("/").filter(Boolean).length;
            const description = `${parsed.pathname} ${item.label}`;
            return parsed.origin === rootOrigin && depth <= 4 && businessPath.test(description) && !excluded.test(description);
          })
          .map((item) => item.url);
      } catch { return []; }
    });
    return [...new Set(batches.flat())].filter((item) => !seedUrls.includes(item)).slice(0, 4);
  } finally {
    request.clear();
  }
}

export async function collectDeepWebsiteEvidence(url?: string | null, options: FetchOptions = {}): Promise<WebsiteEvidence | undefined> {
  const homepage = await collectWebsiteEvidence(url, options);
  if (!homepage?.reachable) return homepage;
  const importantPages = await discoverImportantWebsitePages(homepage.url, options);
  if (!importantPages.length) return homepage;
  const firstLevelPages = (await mapWithConcurrency(importantPages, 2, (pageUrl) => collectWebsiteEvidence(pageUrl, { ...options, timeoutMs: Math.min(options.timeoutMs || 5000, 5000) }))).filter((page): page is WebsiteEvidence => Boolean(page?.reachable));
  const deepSeedPattern = /repair|service|serwis|reparatur|reparasjon|napraw|reparaci|r[eé]paration|ripar|parts?|spare|accessor|wholesale|dealer|trade|b2b|product|produkt|维修|修理|配件|批发/i;
  const seedUrls = firstLevelPages
    .filter((page) => deepSeedPattern.test(`${page.url} ${page.title || ""} ${page.headings.join(" ")}`))
    .map((page) => page.url)
    .slice(0, 3);
  const childUrls = seedUrls.length ? await discoverRelevantChildPages(homepage.url, seedUrls, options) : [];
  const childPages = (await mapWithConcurrency(childUrls, 2, (pageUrl) => collectWebsiteEvidence(pageUrl, { ...options, timeoutMs: Math.min(options.timeoutMs || 5000, 5000) }))).filter((page): page is WebsiteEvidence => Boolean(page?.reachable));
  const pages = [...new Map([...firstLevelPages, ...childPages].map((page) => [page.url, page])).values()];
  return {
    ...homepage,
    structured_types: unique([...(homepage.structured_types || []), ...pages.flatMap((page) => page.structured_types || [])]).slice(0, 40),
    structured_names: unique([...(homepage.structured_names || []), ...pages.flatMap((page) => page.structured_names || [])]).slice(0, 24),
    structured_descriptions: unique([...(homepage.structured_descriptions || []), ...pages.flatMap((page) => page.structured_descriptions || [])]).slice(0, 24),
    headings: unique([...homepage.headings, ...pages.flatMap((page) => page.headings)]).slice(0, 40),
    image_alts: unique([...homepage.image_alts, ...pages.flatMap((page) => page.image_alts)]).slice(0, 40),
    image_urls: unique([...homepage.image_urls, ...pages.flatMap((page) => page.image_urls)]).slice(0, 30),
    video_urls: unique([...(homepage.video_urls || []), ...pages.flatMap((page) => page.video_urls || [])]).slice(0, 20),
    emails: unique([...homepage.emails, ...pages.flatMap((page) => page.emails)]),
    phones: unique([...homepage.phones, ...pages.flatMap((page) => page.phones)]),
    whatsapps: unique([...(homepage.whatsapps || []), ...pages.flatMap((page) => page.whatsapps || [])]),
    social_urls: unique([...(homepage.social_urls || []), ...pages.flatMap((page) => page.social_urls || [])]),
    text_excerpt: [homepage.text_excerpt, ...pages.map((page) => page.text_excerpt)].filter(Boolean).join("\n\n").slice(0, 16_000),
    pages: pages.map(({ url: pageUrl, title, description, headings, text_excerpt, image_alts, image_urls, video_urls, emails, phones, whatsapps, social_urls }) => ({ url: pageUrl, title, description, headings, text_excerpt, image_alts, image_urls, video_urls, emails, phones, whatsapps, social_urls })),
  };
}

function googlePlaceIdFromUrl(value?: string | null) {
  if (!value) return "";
  try {
    const decoded = decodeURIComponent(value);
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const explicit = parsed.searchParams.get("place_id")
      || decoded.match(/place_id[:=]([A-Za-z0-9_-]{10,})/i)?.[1]
      || decoded.match(/(?:^|[?&])q=place_id:([A-Za-z0-9_-]{10,})/i)?.[1];
    return explicit || "";
  } catch {
    return "";
  }
}

export async function collectWebsiteEvidence(url?: string | null, options: FetchOptions = {}): Promise<WebsiteEvidence | undefined> {
  const candidates = websiteUrlCandidates(url);
  if (!candidates.length) return undefined;
  let last: WebsiteEvidence | undefined;
  for (const candidate of candidates) {
    last = await collectWebsiteEvidenceOnce(candidate, { ...options, timeoutMs: Math.min(options.timeoutMs || 5000, 5000) });
    if (last?.reachable) return last;
    if (options.signal?.aborted) break;
  }
  return last;
}

function decodeHtmlAttribute(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function normalizedWords(value?: string | null) {
  return new Set(String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter((item) => item.length > 1));
}

function textSimilarity(left?: string | null, right?: string | null) {
  const a = normalizedWords(left); const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((item) => b.has(item)).length / Math.max(a.size, b.size);
}

function addressIdentityScore(left?: string | null, right?: string | null) {
  const a = normalizedWords(left); const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  const important = [...a].filter((item) => /\d/.test(item) || item.length >= 4);
  const overlap = important.filter((item) => b.has(item)).length;
  const postal = [...a].find((item) => /\d/.test(item) && item.length >= 4);
  const postalMatch = Boolean(postal && b.has(postal));
  const streetNumber = [...a].find((item) => /^\d+[a-z]?$/.test(item));
  const streetNumberMatch = Boolean(streetNumber && b.has(streetNumber));
  const ratio = important.length ? overlap / important.length : textSimilarity(left, right);
  return Math.min(1, ratio + (postalMatch ? 0.25 : 0) + (streetNumberMatch ? 0.15 : 0));
}

const BUSINESS_NAME_GENERIC_TOKENS = new Set([
  "service", "services", "serwis", "repair", "repairs", "reparatur", "reparasjon", "naprawa",
  "fix", "care", "clinic", "klinik", "store", "shop", "center", "centre", "tech", "technology",
  "solutions", "mobile", "mobil", "phone", "smartphone", "handy", "telefon", "gsm", "computer",
  "computers", "laptop", "notebook", "pc", "iphone", "ipad", "macbook", "apple", "ltd", "limited",
  "gmbh", "sarl", "company", "co",
]);

function canonicalBusinessConcepts(value?: string | null) {
  const text = String(value || "").normalize("NFKD").toLowerCase();
  const concepts = new Set<string>();
  if (/(?:repair|reparatur|reparasjon|reparaci|repara[cç]|r[eé]paration|riparazione|napraw|serwis|fix|维修|修理)/i.test(text)) concepts.add("repair");
  if (/(?:phone|mobile|mobil|smartphone|handy|telefon|gsm|iphone|ipad|m[oó]vil|celular|手机|平板)/i.test(text)) concepts.add("mobile");
  if (/(?:computer|laptop|notebook|macbook|\bpc\b|komputer|ordenador|ordinateur|电脑|笔记本)/i.test(text)) concepts.add("computer");
  if (/(?:accessor|parts?|spare|screen|battery|akcesoria|cz[eę][sś]ci|配件|屏幕|电池)/i.test(text)) concepts.add("parts");
  return concepts;
}

function distinctiveBusinessTokens(value?: string | null) {
  return [...normalizedWords(value)].filter((token) => {
    if (BUSINESS_NAME_GENERIC_TOKENS.has(token)) return false;
    return ![...canonicalBusinessConcepts(token)].length;
  });
}

export function nameSimilarity(left?: string | null, right?: string | null) {
  const compactLeft = String(left || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const compactRight = String(right || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!compactLeft || !compactRight) return 0;
  if (compactLeft === compactRight) return 1;
  const shorterText = compactLeft.length <= compactRight.length ? compactLeft : compactRight;
  const longerText = compactLeft.length > compactRight.length ? compactLeft : compactRight;
  if (shorterText.length >= 6 && longerText.includes(shorterText)) return 1;
  const a = normalizedWords(left); const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  const jaccardLike = overlap / Math.max(a.size, b.size);
  // Token containment is useful only for a sufficiently specific (3+ token)
  // business name. Two generic shared words such as "doctor" and "iphone"
  // must not make a different nearby business an automatic identity match.
  const lexical = Math.min(a.size, b.size) >= 3 ? Math.max(jaccardLike, overlap / Math.min(a.size, b.size)) : jaccardLike;
  const leftConcepts = canonicalBusinessConcepts(left);
  const rightConcepts = canonicalBusinessConcepts(right);
  const sharedConcepts = [...leftConcepts].filter((item) => rightConcepts.has(item));
  const leftDistinctive = distinctiveBusinessTokens(left);
  const rightDistinctive = new Set(distinctiveBusinessTokens(right));
  const sharedDistinctive = leftDistinctive.filter((item) => rightDistinctive.has(item));
  // Multilingual reordered names such as "Mobilreparasjon Lillehammer" and
  // "Lillehammer Mobile Repair" identify the same entity. Require both a
  // distinctive brand/location token and two translated business concepts so
  // generic names like "Phone Repair" never become automatic matches.
  const semantic = sharedConcepts.length >= 2 && sharedDistinctive.length >= 1 ? 0.92 : 0;
  return Math.max(lexical, semantic);
}

function phoneIdentityDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function phoneIdentityMatch(left?: string | null, right?: string | null) {
  const a = phoneIdentityDigits(left);
  const b = phoneIdentityDigits(right);
  if (a.length < 7 || b.length < 7) return false;
  if (a === b) return true;
  // A public profile may use a local number while the imported row already
  // contains the country prefix. Only tolerate a prefix difference when the
  // complete shorter number (at least 8 digits) is preserved.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

export function resolveGoogleCandidateIdentity(input: {
  score: number;
  runnerUpScore?: number | null;
  nameSimilarity: number;
  addressSimilarity: number;
  hasInputAddress: boolean;
  phoneMatch: boolean;
  officialDomainMatch: boolean;
  directPlaceIdMatch: boolean;
  phoneConflict?: boolean;
  officialDomainConflict?: boolean;
}) {
  const uniqueCandidate = input.runnerUpScore == null || input.score - input.runnerUpScore >= 10;
  const nameAndAddress = input.nameSimilarity >= 0.8 && input.addressSimilarity >= 0.72;
  const addressAndPhone = input.addressSimilarity >= 0.72 && input.phoneMatch;
  const directPlaceCorroborated = input.directPlaceIdMatch
    && (input.nameSimilarity >= 0.55 || input.addressSimilarity >= 0.55 || input.phoneMatch || input.officialDomainMatch);
  // A broad Maps search can return a similarly named nearby merchant. A
  // materially different address without an exact phone/domain/Place ID is a
  // hard conflict, regardless of the aggregate score.
  const addressConflict = input.hasInputAddress && input.addressSimilarity < 0.45
    && !input.phoneMatch && !input.officialDomainMatch && !input.directPlaceIdMatch;
  if (addressConflict) return "AMBIGUOUS" as const;
  // A conflicting phone remains a contact conflict. It must not erase an
  // exact-name + full-address entity match; a conflicting official domain is
  // still identity-critical.
  if (input.phoneConflict && input.officialDomainConflict) return "CONFLICTED" as const;
  if ((input.phoneConflict && !nameAndAddress && !input.officialDomainMatch && !input.directPlaceIdMatch)
      || (input.officialDomainConflict && !input.phoneMatch && !input.directPlaceIdMatch)) return "AMBIGUOUS" as const;
  if (uniqueCandidate && (nameAndAddress || addressAndPhone || directPlaceCorroborated)) return "MATCHED" as const;
  // A competing nearby result must not override the candidate whose exact
  // name/address is also tied to the imported official domain. Keep a phone
  // difference as a contact conflict instead of reopening entity discovery.
  if (!uniqueCandidate && nameAndAddress && input.officialDomainMatch) return "MATCHED" as const;
  if (!uniqueCandidate) return "AMBIGUOUS" as const;
  if (input.score >= 90) return "MATCHED" as const;
  if (input.score >= 70) return "LIKELY_MATCHED" as const;
  if (input.score >= 45) return "AMBIGUOUS" as const;
  return "NOT_FOUND" as const;
}

function nestedStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => nestedStrings(item, output));
  return output;
}

function googleCidLookupUrl(value?: string | null) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    const matches = [...decoded.matchAll(/!1s0x[0-9a-f]+:(0x[0-9a-f]+)/gi)];
    const hex = matches.at(-1)?.[1];
    return hex ? `https://www.google.com/maps?cid=${BigInt(hex).toString()}` : null;
  } catch {
    return null;
  }
}

/**
 * Google Maps' public search page exposes the selected public place payload to
 * ordinary browsers. Use it as a credential-free fallback so a customer is not
 * downgraded merely because the optional Places API key is absent. This only
 * reads public fields and keeps the exact Maps page as the audit source.
 */
async function collectPublicGooglePlaceEvidence(input: {
  company_name: string;
  address?: string | null;
  country?: string | null;
  google_url?: string | null;
  phone?: string | null;
  website?: string | null;
}, options: FetchOptions): Promise<GooglePlaceEvidence | undefined> {
  const locationText = String(input.address || "").trim();
  // When a customer link opens a broad Maps result list, search the full
  // address first. It is a better locator than appending several loose terms
  // and avoids selecting a similarly named nearby business.
  const query = googlePlaceTextQueries(input)[0] || [input.company_name, locationText, input.country].filter(Boolean).join(", ");
  if (!query) return undefined;
  const request = requestSignal(options, 9_000);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,es;q=0.7",
    Accept: "text/html,application/xhtml+xml,application/json",
  };
  try {
    const providedUrl = safePublicUrl(input.google_url);
    const isSpecificPlaceUrl = Boolean(providedUrl && /google\.[^/]+\/maps\/place\//i.test(providedUrl));
    const canonicalSearchPage = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    const cidLookupPage = isSpecificPlaceUrl ? googleCidLookupUrl(providedUrl) : null;
    const searchPage = cidLookupPage || (isSpecificPlaceUrl ? providedUrl! : canonicalSearchPage);
    const pageResponse = await fetchPublic(searchPage, { signal: request.signal, headers });
    if (!pageResponse.ok) return undefined;
    let pageHtml = await readTextLimited(pageResponse, 450_000);
    let endpointMatch = pageHtml.match(/<link\s+href="([^"]*(?:\/search\?tbm=map|\/maps\/preview\/place\?)[^"]+)"/i);
    let resolvedFromSpecificPlace = Boolean(endpointMatch && cidLookupPage);
    // A concrete /maps/place/ page often bootstraps its place payload through
    // JavaScript and no longer exposes the legacy endpoint link in the first
    // HTML response. Fall back to an exact business-name search instead of
    // incorrectly treating the supplied place URL as unreadable.
    if (!endpointMatch && isSpecificPlaceUrl) {
      const fallbackResponse = await fetchPublic(canonicalSearchPage, { signal: request.signal, headers });
      if (!fallbackResponse.ok) return undefined;
      pageHtml = await readTextLimited(fallbackResponse, 450_000);
      endpointMatch = pageHtml.match(/<link\s+href="([^"]*(?:\/search\?tbm=map|\/maps\/preview\/place\?)[^"]+)"/i);
      resolvedFromSpecificPlace = false;
    }
    if (!endpointMatch) return undefined;
    const endpoint = new URL(decodeHtmlAttribute(endpointMatch[1]), "https://www.google.com").toString();
    const dataResponse = await fetchPublic(endpoint, { signal: request.signal, headers });
    if (!dataResponse.ok) return undefined;
    const raw = await readTextLimited(dataResponse, 1_500_000);
    const payload = JSON.parse(raw.replace(/^\)\]\}'\s*/, "")) as unknown;
    const candidateArrays: unknown[][] = [];
    const visit = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (value.length > 80 && typeof value[11] === "string" && Array.isArray(value[13]) && typeof value[18] === "string") candidateArrays.push(value);
      value.forEach(visit);
    };
    visit(payload);
    if (!candidateArrays.length) return undefined;
    const domain = evidenceDomain;
    const candidates = candidateArrays.map((row) => {
      const name = String(row[11] || "");
      const address = String(row[18] || row[39] || "");
      const website = Array.isArray(row[7]) ? String(row[7][0] || "") : "";
      const countryCode = String(row[243] || "").toUpperCase();
      const phoneBlock = Array.isArray(row[178]) && Array.isArray(row[178][0]) ? row[178][0] : [];
      const phone = String(phoneBlock[0] || "");
       const candidateNameSimilarity = nameSimilarity(input.company_name, name);
       const nameScore = Math.round(candidateNameSimilarity * 15);
      const addressSimilarity = addressIdentityScore(input.address, address);
      const addressScore = Math.round(addressSimilarity * 55);
      // A candidate exposing the exact customer-supplied official domain is a
      // much stronger identity signal than a loose name overlap. This is still
      // identity evidence only; the page content/types must separately prove
      // the industry.
      const officialDomainMatch = Boolean(domain(input.website) && domain(input.website) === domain(website));
      const websiteScore = officialDomainMatch ? 70 : 0;
      const matchedPhone = phoneIdentityMatch(input.phone, phone);
      const phoneScore = matchedPhone ? 70 : 0;
      const expectedCountryCode = countryInfo(input.country).code;
      const countryMismatch = Boolean(expectedCountryCode && countryCode && expectedCountryCode !== countryCode);
      const countryScore = expectedCountryCode && expectedCountryCode === countryCode ? 10 : 0;
       // Imported names are mutable and may be stale. They only rank candidates;
       // stable identity signals (address, phone, official domain or a concrete
       // Place ID) must carry the attribution decision.
       const exactPlaceUrlScore = resolvedFromSpecificPlace ? 35 : 0;
       return { row, name, address, website, phone, countryCode, nameSimilarity: candidateNameSimilarity, addressSimilarity, officialDomainMatch, phoneMatch: matchedPhone, score: countryMismatch ? 0 : Math.min(100, nameScore + addressScore + websiteScore + phoneScore + countryScore + exactPlaceUrlScore) };
    }).sort((a, b) => b.score - a.score);
    const top = candidates[0]; const runnerUp = candidates[1];
    const identityStatus: NonNullable<GooglePlaceEvidence["identity_status"]> = resolveGoogleCandidateIdentity({
      score: top.score,
      runnerUpScore: runnerUp?.score,
      nameSimilarity: top.nameSimilarity,
      addressSimilarity: top.addressSimilarity,
      hasInputAddress: Boolean(input.address),
      phoneMatch: top.phoneMatch,
      officialDomainMatch: top.officialDomainMatch,
      directPlaceIdMatch: resolvedFromSpecificPlace,
      phoneConflict: Boolean(input.phone && top.phone && !top.phoneMatch),
      officialDomainConflict: Boolean(domain(input.website) && domain(top.website) && domain(input.website) !== domain(top.website)),
    });
    const allStrings = nestedStrings(top.row);
    const imageUrls = uniqueOriginalMedia(
      allStrings.filter((item) => /^https:\/\/lh\d+\.googleusercontent\.com\/p\//i.test(item)),
      searchPage,
      12,
    );
    const videoUrls = uniqueOriginalMedia(
      allStrings.filter((item) => /^https?:\/\//i.test(item) && /(?:youtube\.com|youtu\.be|vimeo\.com|\.mp4(?:\?|$)|\.webm(?:\?|$))/i.test(item)),
      searchPage,
      8,
    );
    const hours = unique(allStrings.filter((item) => /(?:营业|开放|关闭|abierto|cerrado|a\.m\.|p\.m\.)/i.test(item) && item.length < 140)).slice(0, 14);
    const descriptionBlock = Array.isArray(top.row[154]) && Array.isArray(top.row[154][0]) ? top.row[154][0] : [];
    // Keep the customer's original concrete Maps URL as the audit entry. The
    // CID/search endpoints above are implementation details used to read its
    // public payload and must not replace the user-verifiable source link.
    const verifiedUrl = isSpecificPlaceUrl ? providedUrl! : typeof top.row[42] === "string" ? top.row[42] : searchPage;
    const nameVariantConfirmed = top.nameSimilarity < 0.8 && top.addressSimilarity >= 0.72 && top.phoneMatch;
    const phoneChanged = Boolean(input.phone && top.phone && !top.phoneMatch);
    const matchSignals = [top.nameSimilarity >= 0.8 ? "商家名称高度一致（辅助信号）" : "", nameVariantConfirmed ? "商家名称存在细微差异，完整地址与电话已确认同一主体" : "", isSpecificPlaceUrl ? "使用客户提供的具体Google商家页" : "", top.addressSimilarity >= 0.72 ? "完整地址一致" : "", countryInfo(input.country).code && countryInfo(input.country).code === top.countryCode ? "国家代码一致" : "", top.officialDomainMatch ? "公开网站一致" : "", top.phoneMatch ? "电话号码一致" : ""].filter(Boolean);
    const mismatchSignals = [
      input.address && top.addressSimilarity < 0.45 ? "地址信息不一致" : "",
      phoneChanged ? "Google商家电话与原始电话不一致，需核对是否为换号、分店或错误候选" : "",
      domain(input.website) && domain(top.website) && domain(input.website) !== domain(top.website) ? "Google商家官网与原始官网域名不一致" : "",
    ].filter(Boolean);
    return {
      configured: false,
      query,
      name: top.name,
      formatted_address: top.address,
      business_status: allStrings.some((item) => /(?:永久关闭|cerrado permanentemente|permanently closed)/i.test(item)) ? "CLOSED_PERMANENTLY" : undefined,
      types: Array.isArray(top.row[13]) ? top.row[13].filter((item): item is string => typeof item === "string") : [],
      website: top.website || undefined,
      phone: top.phone || undefined,
      description: String(descriptionBlock[0] || "") || undefined,
      opening_hours: hours,
      image_urls: imageUrls,
      video_urls: videoUrls,
      emails: [], reviews: [],
      place_id: typeof top.row[78] === "string" ? top.row[78] : undefined,
      candidate_count: candidates.length,
      identity_status: identityStatus,
      identity_confidence: top.score,
      match_signals: matchSignals,
      mismatch_signals: identityStatus === "NOT_FOUND" ? ["公开地图结果与客户名称或地址不一致"] : mismatchSignals,
      verified_google_maps_url: verifiedUrl,
    };
  } catch {
    return undefined;
  } finally {
    request.clear();
  }
}

export async function collectGooglePlaceEvidence(input: {
  company_name: string;
  address?: string | null;
  country?: string | null;
  google_url?: string | null;
  phone?: string | null;
  website?: string | null;
  place_id?: string | null;
}, options: FetchOptions = {}): Promise<GooglePlaceEvidence | undefined> {
  if (!input.google_url && !input.company_name) return undefined;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  const queries = googlePlaceTextQueries(input);
  const regionCode = countryInfo(input.country).code;
  const query = queries[0] || [input.company_name, input.address, input.country].filter(Boolean).join(" ");
  if (!apiKey) {
    const publicEvidence = await collectPublicGooglePlaceEvidence(input, options);
    return publicEvidence || {
      configured: false, query, types: [], reviews: [], emails: [],
      error: "未能从公开Google商家页定位到与名称和地址一致的具体企业。",
    };
  }

  // Cost-controlled Places API (New) flow:
  // 1. Search only for Place IDs to minimize fields, latency and billable SKU
  //    cost. Never assume it is free: monthly caps and account pricing vary.
  // 2. Read the minimum Pro fields for the top-ranked candidate and only try a
  //    second/third candidate when identity matching is still ambiguous.
  // 3. Read Enterprise contact fields only after the entity is matched and the
  //    customer is missing an official phone or website.
  // Public Maps parsing remains a fallback for API/network failures; it is no
  // longer the primary path when a server-side key is configured.
  const request = requestSignal(options, 12_000);
  try {
    type LocalizedText = { text?: string; languageCode?: string };
    type PlaceDetail = {
      id?: string;
      displayName?: LocalizedText;
      formattedAddress?: string;
      businessStatus?: string;
      types?: string[];
      primaryType?: string;
      primaryTypeDisplayName?: LocalizedText;
      googleMapsUri?: string;
      internationalPhoneNumber?: string;
      nationalPhoneNumber?: string;
      websiteUri?: string;
      rating?: number;
      userRatingCount?: number;
      regularOpeningHours?: { weekdayDescriptions?: string[] };
      editorialSummary?: LocalizedText;
      reviews?: Array<{ text?: LocalizedText; originalText?: LocalizedText }>;
    };
    const placesHeaders = (fieldMask: string) => ({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    });
    const detailUrl = (placeId: string) => `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
    const configuredRate = (name: string) => {
      const raw = process.env[name];
      if (raw === undefined || raw.trim() === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const reportCall = async (operation:string,sku:string,status:number,rateEnv:string,response:Response) => {
      try { await options.onApiCall?.({ provider:"GOOGLE_PLACES",operation,sku,status,unitPriceUsd:configuredRate(rateEnv),requestId:response.headers.get("x-request-id")||response.headers.get("x-goog-request-id")||undefined }); } catch { /* 费用留痕失败不应破坏客户证据采集，调用方另行记录系统告警。 */ }
    };
    const readDetail = async (placeId: string, fieldMask: string): Promise<PlaceDetail | null> => {
      const response = await fetchWithRetry(detailUrl(placeId), {
        signal: request.signal,
        headers: placesHeaders(fieldMask),
      });
      const enterprise = /internationalPhoneNumber|reviews|rating|websiteUri/.test(fieldMask);
      await reportCall(enterprise?"商家详情与联系方式":"商家基础详情",enterprise?"PLACES_DETAILS_ENTERPRISE":"PLACES_DETAILS_PRO",response.status,enterprise?"GOOGLE_PLACES_ENTERPRISE_USD_PER_REQUEST":"GOOGLE_PLACES_PRO_USD_PER_REQUEST",response);
      if (!response.ok) return null;
      return await response.json() as PlaceDetail;
    };

    // A Place ID stored by an earlier analysis is a locator hint, not proof of
    // identity. Reusing it as a direct match created a self-validating loop:
    // the same previously misattributed place became "Place ID一致" forever.
    // Only an ID encoded in the customer's concrete Maps URL is a direct link;
    // a stored ID is used solely as a last-resort candidate and must pass the
    // current name/address/phone/domain checks again.
    const directPlaceId = googlePlaceIdFromUrl(input.google_url);
    const storedPlaceIdHint = input.place_id?.trim() || "";
    let candidateIds = directPlaceId ? [directPlaceId] : [];
    if (!candidateIds.length) {
      let searchError = "未找到匹配的Google商家。";
      for (const [index, textQuery] of queries.entries()) {
        const searchResponse = await fetchWithRetry("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          signal: request.signal,
          headers: placesHeaders("places.id"),
          body: JSON.stringify({
            textQuery,
            pageSize: 3,
            languageCode: "zh-CN",
            ...(regionCode ? { regionCode } : {}),
          }),
        });
        await reportCall(index === 0 ? "名称地址文本搜索" : "电话号码精确回退搜索","PLACES_TEXT_SEARCH_ID_ONLY",searchResponse.status,"GOOGLE_PLACES_TEXT_SEARCH_USD_PER_REQUEST",searchResponse);
        const searchPayload = await searchResponse.json() as { places?: Array<{ id?: string }>; error?: { message?: string } };
        searchError = searchPayload.error?.message || searchError;
        candidateIds = (searchPayload.places || []).map((item) => item.id || "").filter(Boolean).slice(0, 3);
        if (searchResponse.ok && candidateIds.length) break;
      }
      if (!candidateIds.length && storedPlaceIdHint) candidateIds = [storedPlaceIdHint];
      if (!candidateIds.length) {
        return {
          configured: true, query, types: [], reviews: [], emails: [], candidate_count: 0,
          identity_status: "NOT_FOUND", identity_confidence: 0,
          error: searchError,
        };
      }
    }

    // Rank all candidates with lower-cost identity fields first. Contact fields
    // are requested only for the best ambiguous candidates, rather than paying
    // the higher tier for every result returned by text search.
    const baseIdentityFields = "id,displayName,formattedAddress,businessStatus,types,primaryType,primaryTypeDisplayName,googleMapsUri";
    const contactFields = "id,internationalPhoneNumber,nationalPhoneNumber,websiteUri";
    let details = (await Promise.all(candidateIds.map((candidateId) => readDetail(candidateId, baseIdentityFields))))
      .filter((item): item is PlaceDetail => Boolean(item));
    if (!details.length) {
      return { configured: true, query, types: [], reviews: [], emails: [], candidate_count: candidateIds.length, identity_status: "NOT_FOUND", identity_confidence: 0, error: "未能读取Google商家详情。" };
    }
    const domain = evidenceDomain;
    const providedGoogleUrl = safePublicUrl(input.google_url);
    const hasConcretePlacePath = Boolean(providedGoogleUrl && /google\.[^/]+\/maps\/place\//i.test(providedGoogleUrl));
    const scoreDetails = (items: PlaceDetail[]) => items.map((item) => {
      const matchSignals: string[] = []; const mismatchSignals: string[] = [];
      const candidateName = item.displayName?.text || "";
      const candidateNameSimilarity = nameSimilarity(input.company_name, candidateName);
      const nameScore = Math.round(candidateNameSimilarity * 15);
      if (nameScore >= 12) matchSignals.push("商家名称高度一致（辅助信号）"); else mismatchSignals.push("商家名称未达到高度一致");
      const addressSimilarity = addressIdentityScore(input.address, item.formattedAddress);
      const addressScore = Math.round(addressSimilarity * 55);
      if (addressScore >= 33) matchSignals.push("地址信息一致"); else if (input.address) mismatchSignals.push("地址信息不足或不一致");
      const countryStatus = placeAddressCountryStatus(input.country, item.formattedAddress);
      if (countryStatus === "MISMATCH") mismatchSignals.push("Google商家国家与客户国家不一致，候选已淘汰");
      const countryScore = countryStatus === "MATCH" ? 10 : 0;
      if (countryScore) matchSignals.push("国家或地区一致");
      // /maps/search/... is only a query, not a concrete merchant identity.
      // Treating it as a specific-place signal caused similarly named nearby
      // businesses to outrank the customer's full address.
      const specificUrlScore = hasConcretePlacePath && candidateNameSimilarity >= 0.55 ? 20 : 0;
      if (specificUrlScore) matchSignals.push("客户提供的Google商家入口与候选名称一致");
      const directIdScore = directPlaceId && item.id === directPlaceId ? 35 : 0;
      if (directIdScore) matchSignals.push("Google Place ID一致");
      const candidatePhone = item.internationalPhoneNumber || item.nationalPhoneNumber;
      const matchedPhone = phoneIdentityMatch(input.phone, candidatePhone);
      const inputDomain = domain(input.website);
      const candidateDomain = domain(item.websiteUri);
      const officialDomainMatch = Boolean(inputDomain && candidateDomain && inputDomain === candidateDomain);
      const phoneConflict = Boolean(input.phone && candidatePhone && !matchedPhone);
      const officialDomainConflict = Boolean(inputDomain && candidateDomain && inputDomain !== candidateDomain);
      if (matchedPhone) matchSignals.push("电话号码一致");
      if (officialDomainMatch) matchSignals.push("官网域名一致");
      if (phoneConflict) mismatchSignals.push("Google商家电话与原始电话不一致，需核对是否为换号、分店或错误候选");
      if (officialDomainConflict) mismatchSignals.push("Google商家官网与原始官网域名不一致");
      const contactBonus = (matchedPhone ? 70 : 0) + (officialDomainMatch ? 70 : 0);
      const conflictPenalty = (phoneConflict ? 15 : 0) + (officialDomainConflict ? 20 : 0);
      return { item, score: countryStatus === "MISMATCH" ? 0 : Math.max(0, Math.min(100, nameScore + addressScore + countryScore + specificUrlScore + directIdScore + contactBonus - conflictPenalty)), nameSimilarity: candidateNameSimilarity, addressSimilarity, officialDomainMatch, phoneMatch: matchedPhone, phoneConflict, officialDomainConflict, directPlaceIdMatch: Boolean(directIdScore), matchSignals, mismatchSignals };
    }).sort((a, b) => b.score - a.score);
    let scored = scoreDetails(details);

    // Search rank is not identity. A full-address lookup can return a building
    // or nearby merchant, so use name+phone only when the best address result
    // is still below the attribution threshold. Already matched rows avoid the
    // extra request and its latency/cost.
    if (!directPlaceId && scored[0]?.score < 70 && queries[1]) {
      const fallbackResponse = await fetchWithRetry("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        signal: request.signal,
        headers: placesHeaders("places.id"),
        body: JSON.stringify({
          textQuery: queries[1],
          pageSize: 3,
          languageCode: "zh-CN",
          ...(regionCode ? { regionCode } : {}),
        }),
      });
      await reportCall("电话号码精确回退搜索", "PLACES_TEXT_SEARCH_ID_ONLY", fallbackResponse.status, "GOOGLE_PLACES_TEXT_SEARCH_USD_PER_REQUEST", fallbackResponse);
      if (fallbackResponse.ok) {
        const fallbackPayload = await fallbackResponse.json() as { places?: Array<{ id?: string }> };
        const known = new Set(details.map((item) => item.id).filter(Boolean));
        const fallbackIds = (fallbackPayload.places || []).map((item) => item.id || "").filter((id) => id && !known.has(id)).slice(0, 3);
        const fallbackDetails = (await Promise.all(fallbackIds.map((id) => readDetail(id, baseIdentityFields))))
          .filter((item): item is PlaceDetail => Boolean(item));
        if (fallbackDetails.length) {
          details = [...details, ...fallbackDetails];
          scored = scoreDetails(details);
        }
      }
    }
    // Name/address can be decisive on their own. When they are not, inspect
    // contact fields only for the top two plausible candidates and re-rank.
    const baseTop = scored[0];
    const baseRunnerUp = scored[1];
    const needsContactDisambiguation = Boolean(baseTop && (
      baseTop.score < 90
      || (baseRunnerUp && baseTop.score - baseRunnerUp.score < 15)
      || (input.phone && baseTop.addressSimilarity < 0.72)
    ));
    if (needsContactDisambiguation) {
      const candidateContacts = (await Promise.all(scored.slice(0, 2).map(async (candidate) => {
        if (!candidate.item.id) return null;
        const contact = await readDetail(candidate.item.id, contactFields);
        return contact ? { id: candidate.item.id, contact } : null;
      }))).filter((entry): entry is { id: string; contact: PlaceDetail } => Boolean(entry));
      if (candidateContacts.length) {
        details = details.map((detail) => ({
          ...detail,
          ...(candidateContacts.find((entry) => entry.id === detail.id)?.contact || {}),
        }));
        scored = scoreDetails(details);
      }
    }
    let top = scored[0]; const runnerUp = scored[1];

    // Contact/rating fields are requested once, and only for the selected
    // entity. Generic Places categories such as `service` do not prove an
    // industry, so an already strongly matched but generically classified
    // entity also receives a small review/editorial clarification request.
    // This prevents clear repair businesses from being downgraded merely
    // because Google returned a generic primary type, while avoiding this
    // higher-cost evidence request for every customer.
    const needsBusinessClarification = googlePlaceNeedsBusinessClarification([
      top.item.primaryTypeDisplayName?.text || "", top.item.primaryType || "", ...(top.item.types || []),
    ], top.score);
    const needsContactCompletion = Boolean(top.item.id && (
      (!input.phone && !top.item.internationalPhoneNumber && !top.item.nationalPhoneNumber)
      || (!input.website && !top.item.websiteUri)
    ));
    if (top.item.id && (needsBusinessClarification || needsContactCompletion)) {
      const enrichmentFields = [
        "id", "internationalPhoneNumber", "nationalPhoneNumber", "websiteUri",
        ...(needsBusinessClarification ? ["rating", "userRatingCount", "regularOpeningHours"] : []),
        ...(needsBusinessClarification ? ["editorialSummary", "reviews"] : []),
      ].join(",");
      const enterprise = await readDetail(top.item.id, enrichmentFields);
      if (enterprise) {
        top = { ...top, item: { ...top.item, ...enterprise } };
      }
    }
    const identityStatus: NonNullable<GooglePlaceEvidence["identity_status"]> = resolveGoogleCandidateIdentity({
      score: top.score,
      runnerUpScore: runnerUp?.score,
      nameSimilarity: top.nameSimilarity,
      addressSimilarity: top.addressSimilarity,
      hasInputAddress: Boolean(input.address),
      phoneMatch: top.phoneMatch,
      officialDomainMatch: top.officialDomainMatch,
      directPlaceIdMatch: top.directPlaceIdMatch,
      phoneConflict: top.phoneConflict,
      officialDomainConflict: top.officialDomainConflict,
    });
    const result = top.item;
    const googlePhone = result.internationalPhoneNumber || result.nationalPhoneNumber;
    const phoneChanged = Boolean(input.phone && googlePhone && !phoneIdentityMatch(input.phone, googlePhone));
    const nameVariantConfirmed = top.nameSimilarity < 0.8 && top.addressSimilarity >= 0.72 && top.phoneMatch;
    if (nameVariantConfirmed) {
      top.mismatchSignals = top.mismatchSignals.filter((signal) => signal !== "商家名称未达到高度一致");
      top.matchSignals.push("商家名称存在细微差异，完整地址与电话已确认同一主体");
    }
    if (top.addressSimilarity >= 0.72) top.mismatchSignals = top.mismatchSignals.filter((signal) => signal !== "地址信息不足或不一致");
    if (phoneChanged && !top.mismatchSignals.some((signal) => signal.includes("电话与原始电话不一致"))) top.mismatchSignals.push("Google商家电话与原始电话不一致，需核对是否为换号、分店或错误候选");
    const reviewTexts = unique((result.reviews || []).map((review) => review.text?.text || review.originalText?.text || "")).slice(0, 5);
    // Reviews/editorial text are sufficient for deterministic industry facts.
    // Do not scrape Maps HTML or download paid photos in the normal batch path;
    // this removes duplicate work and avoids a separate media SKU. Visual
    // evidence can be added later only through an explicitly selected source.
    const evidence: GooglePlaceEvidence = {
      configured: true,
      query,
      name: result.displayName?.text,
      formatted_address: result.formattedAddress,
      business_status: result.businessStatus,
      rating: result.rating,
      user_ratings_total: result.userRatingCount,
      types: unique([result.primaryTypeDisplayName?.text || "", result.primaryType || "", ...(result.types || [])]).filter(Boolean),
      website: result.websiteUri,
      phone: result.internationalPhoneNumber || result.nationalPhoneNumber,
      opening_hours: result.regularOpeningHours?.weekdayDescriptions || [],
      description: result.editorialSummary?.text,
      image_urls: [],
      video_urls: [],
      // Google Places does not expose a business email. Review text belongs to
      // reviewers and must never be promoted to the merchant's contact data.
      emails: [],
      reviews: reviewTexts,
      place_id: result.id,
      candidate_count: details.length,
      identity_status: identityStatus,
      identity_confidence: top.score,
      match_signals: top.matchSignals,
      mismatch_signals: top.mismatchSignals,
      verified_google_maps_url: result.googleMapsUri || (result.id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(result.id)}` : input.google_url || undefined),
    };
    return evidence;
  } catch (error) {
    return { configured: true, query, types: [], reviews: [], emails: [], identity_status: "NOT_FOUND", identity_confidence: 0, error: error instanceof Error ? error.message : "Google商家读取失败" };
  } finally {
    request.clear();
  }
}

export async function collectCustomerEvidence(input: {
  customer_name: string;
  country?: string | null;
  website?: string | null;
  google_url?: string | null;
  address?: string | null;
}, options: FetchOptions = {}): Promise<CustomerEvidence> {
  const [website, google_place] = await Promise.all([
    collectDeepWebsiteEvidence(input.website, options),
    collectGooglePlaceEvidence({
      company_name: input.customer_name,
      country: input.country,
      address: input.address,
      google_url: input.google_url,
    }, options),
  ]);
  return { website, google_place };
}

/** Read a public social/company page without requiring provider credentials. */
export async function collectPublicPageEvidence(url?: string | null, options: FetchOptions = {}) {
  return collectWebsiteEvidence(url, { ...options, timeoutMs: Math.min(options.timeoutMs || 4000, 4000) });
}

/**
 * Zero-token public locator used after the supplied website and before paid
 * Places. Result links are merely candidates: callers must
 * fetch each page and pass the normal name/address/phone identity gate before
 * using any content as evidence.
 */
export async function discoverPublicBusinessUrls(input: {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  country?: string | null;
}, options: FetchOptions = {}) {
  const name = normalizedPlaceQueryPart(input.company_name);
  const address = normalizedPlaceQueryPart(input.address);
  const phone = String(input.phone || "").replace(/[^\d+]/g, "");
  const queries = [...new Set([
    [name, address].filter(Boolean).join(" "),
    phone.length >= 7 ? [name, phone, input.country].filter(Boolean).join(" ") : "",
    [name, address, "repair service"].filter(Boolean).join(" "),
    [name, address, "Facebook Instagram"].filter(Boolean).join(" "),
  ].filter(Boolean))].slice(0, 4);
  const request = requestSignal(options, 8_000);
  try {
    const normalizeSearchLink = (raw: string) => {
      try {
        const decoded = raw.replace(/&amp;/g, "&");
        const parsed = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
        const uddg = parsed.searchParams.get("uddg");
        if (uddg) return safePublicUrl(decodeURIComponent(uddg));
        // Bing result redirects encode the target as base64url prefixed by a1.
        const bingTarget = parsed.hostname.endsWith("bing.com") ? parsed.searchParams.get("u") : null;
        if (bingTarget?.startsWith("a1")) {
          const encoded = bingTarget.slice(2).replace(/-/g, "+").replace(/_/g, "/");
          return safePublicUrl(Buffer.from(encoded, "base64").toString("utf8"));
        }
        return safePublicUrl(parsed.toString());
      } catch { return null; }
    };
    const resultLinks = (html: string) => unique([
      ...[...html.matchAll(/[?&]uddg=([^&"']+)/gi)].map((match) => {
        try { return safePublicUrl(decodeURIComponent(match[1].replace(/&amp;/g, "&"))); } catch { return null; }
      }),
      ...[...html.matchAll(/<a[^>]+href=["']([^"']{1,1200})["']/gi)].map((match) => normalizeSearchLink(match[1])),
    ].filter((url): url is string => Boolean(url))
      .filter((url) => !/(?:duckduckgo\.com|bing\.com|google\.[^/]+\/(?:search|maps))/i.test(url)));
    const pages = await mapWithConcurrency(queries, 2, async (query) => {
      try {
        const response = await fetchWithRetry(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          signal: request.signal,
          headers: BROWSER_HEADERS,
        }, 1);
        if (response.ok) {
          const links = resultLinks(await readTextLimited(response, 180_000));
          if (links.length) return links;
        }
        // Search providers occasionally return an interstitial or no result
        // links for one query. Use a second ordinary index only in that case;
        // this remains zero-token discovery and avoids an expensive model web
        // search solely because one HTML layout changed.
        const fallback = await fetchWithRetry(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
          signal: request.signal,
          headers: BROWSER_HEADERS,
        }, 1);
        if (!fallback.ok) return [] as string[];
        return resultLinks(await readTextLimited(fallback, 180_000));
      } catch { return [] as string[]; }
    });
    return unique(pages.flat()).slice(0, 10);
  } finally {
    request.clear();
  }
}

