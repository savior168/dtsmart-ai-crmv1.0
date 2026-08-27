import { lookup } from "node:dns/promises";

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

type FetchOptions = { signal?: AbortSignal; timeoutMs?: number };

function requestSignal(options: FetchOptions, fallbackMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || fallbackMs);
  return {
    signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function normalizeUrl(url?: string | null) {
  const value = url?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
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

const BUSINESS_MEDIA_TERMS = /(?:phone|mobile|iphone|ipad|macbook|computer|laptop|repair|service|screen|display|battery|accessor|parts|wholesale|store|shop|workshop|technician|smartphone|telefon|kom[oó]rk|napraw|serwis|komputer|reparaci|m[oó]vil|ordenador|inform[aá]tic|r[eé]paration|t[eé]l[eé]phone|ordinateur|riparazione|cellulare|维修|修理|手机|电脑|配件|屏幕|电池|门店|店铺|产品)/i;
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

function extractRelevantWebsiteImages(html: string, baseUrl: string) {
  const pageContext = [
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i),
  ].filter(Boolean).join(" ");
  const ranked = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match, index) => {
    const tag = match[0];
    const alt = decodeHtmlAttribute(tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "");
    const title = decodeHtmlAttribute(tag.match(/\btitle=["']([^"']*)["']/i)?.[1] || "");
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1] || "";
    const srcsetCandidates = srcset.split(",").map((item) => item.trim().split(/\s+/)[0]).filter(Boolean);
    const raw = srcsetCandidates.at(-1)
      || tag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1]
      || "";
    const context = `${alt} ${title} ${raw}`;
    if (!raw || DECORATIVE_MEDIA_TERMS.test(context)) return [];
    const score = (BUSINESS_MEDIA_TERMS.test(context) ? 100 : 0)
      + (BUSINESS_MEDIA_TERMS.test(pageContext) ? 20 : 0)
      - index / 100;
    return [{ raw, score }];
  }).sort((a, b) => b.score - a.score);
  // Only media carrying direct business context is retained as a key evidence
  // attachment. Generic hero/decorative images are deliberately excluded.
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

function extractEmails(text: string) {
  return unique((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()));
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
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("UNSAFE_SOURCE_ADDRESS");
  }
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
  if (!candidate || /[A-Za-z@]/.test(candidate)) return false;
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
    ...[...labeledText.matchAll(/(?:电话|联系电话|联系电话号码|tel(?:ephone)?|phone|teléfono|telefono)\s*[:：]?\s*(\+?\d[\d\s\-().]{5,}\d)/gi)].map((match) => match[1]),
  ];
  return unique(candidates.map((phone) => phone.replace(/\s+/g, " ").trim()).filter(isPlausiblePhone)).slice(0, 12);
}

function extractWhatsapps(text: string) {
  return unique([...text.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{7,18})/gi)].map((match) => match[1]));
}

function extractSocialUrls(html: string, baseUrl: string) {
  const supported = /(?:facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|wa\.me|api\.whatsapp\.com)/i;
  return unique([...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => {
      try { return new URL(decodeHtmlAttribute(match[1]), baseUrl).toString(); } catch { return ""; }
    })
    .filter((url) => supported.test(url)))
    .slice(0, 20);
}

export async function collectWebsiteEvidence(url?: string | null, options: FetchOptions = {}): Promise<WebsiteEvidence | undefined> {
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
      headers: {
        "User-Agent": "Mozilla/5.0 DTSmart-AI-CRM/1.0 customer validation",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], emails: [], phones: [], error: `HTTP ${response.status}` };
    }
    const html = await readTextLimited(response);
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
      headers: { "User-Agent": "Mozilla/5.0 DTSmart-AI-CRM/1.0 customer validation", Accept: "text/html,application/xhtml+xml" },
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
    const links = [...html.matchAll(/<a[^>]+href=['\"]([^'\"#]+)['\"][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match, index) => ({ url: sameWebsiteUrl(url, match[1]), text: compactText(match[2]), index }))
      .filter((item): item is { url: string; text: string; index: number } => Boolean(item.url) && item.url !== url)
      .filter((item) => !excluded.test(`${item.url} ${item.text}`))
      .map((item) => {
        const candidate = new URL(item.url);
        const depth = candidate.pathname.split("/").filter(Boolean).length;
        const label = `${candidate.pathname} ${item.text}`;
        const score = (keywords.test(label) ? 100 : 0)
          + (depth <= 1 ? 18 : depth === 2 ? 8 : 0)
          + (item.text.length >= 2 && item.text.length <= 40 ? 5 : 0)
          - Math.min(12, item.index / 12);
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return [...new Set(links.map((item) => item.url))].slice(0, 4);
  } catch {
    return [];
  } finally {
    request.clear();
  }
}

export async function collectDeepWebsiteEvidence(url?: string | null, options: FetchOptions = {}): Promise<WebsiteEvidence | undefined> {
  const homepage = await collectWebsiteEvidence(url, options);
  if (!homepage?.reachable) return homepage;
  const importantPages = await discoverImportantWebsitePages(homepage.url, options);
  if (!importantPages.length) return homepage;
  const pages = (await Promise.all(importantPages.map((pageUrl) => collectWebsiteEvidence(pageUrl, { ...options, timeoutMs: Math.min(options.timeoutMs || 3500, 3500) })))).filter((page): page is WebsiteEvidence => Boolean(page?.reachable));
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

function nameSimilarity(left?: string | null, right?: string | null) {
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
  return Math.min(a.size, b.size) >= 3 ? Math.max(jaccardLike, overlap / Math.min(a.size, b.size)) : jaccardLike;
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
  const query = [input.company_name, locationText, input.country].filter(Boolean).join(", ");
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
    const digits = (value?: string | null) => String(value || "").replace(/\D/g, "");
    const domain = (value?: string | null) => { try { return new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
    const candidates = candidateArrays.map((row) => {
      const name = String(row[11] || "");
      const address = String(row[18] || row[39] || "");
      const website = Array.isArray(row[7]) ? String(row[7][0] || "") : "";
      const countryCode = String(row[243] || "").toUpperCase();
      const phoneBlock = Array.isArray(row[178]) && Array.isArray(row[178][0]) ? row[178][0] : [];
      const phone = String(phoneBlock[0] || "");
       const candidateNameSimilarity = nameSimilarity(input.company_name, name);
       const nameScore = Math.round(candidateNameSimilarity * 45);
      const addressSimilarity = addressIdentityScore(input.address, address);
      const addressScore = Math.round(addressSimilarity * 45);
      // A candidate exposing the exact customer-supplied official domain is a
      // much stronger identity signal than a loose name overlap. This is still
      // identity evidence only; the page content/types must separately prove
      // the industry.
      const websiteScore = domain(input.website) && domain(input.website) === domain(website) ? 55 : 0;
      const phoneScore = digits(input.phone).length >= 7 && digits(input.phone) === digits(phone) ? 20 : 0;
      const countryScore = input.country && String(input.country).toUpperCase() === countryCode ? 10 : 0;
       // An exact/near-exact business name returned as the unique top Google
       // candidate is a strong identity signal even when imported rows lack an
       // address. A supplied concrete place URL strengthens it further, while a
       // mismatched place URL receives no bonus and remains blocked.
       const exactNameScore = candidateNameSimilarity >= 0.85 ? 45 : 0;
       const exactPlaceUrlScore = resolvedFromSpecificPlace && candidateNameSimilarity >= 0.55 ? 65 : 0;
       return { row, name, address, website, phone, countryCode, score: Math.min(100, nameScore + addressScore + websiteScore + phoneScore + countryScore + exactNameScore + exactPlaceUrlScore) };
    }).sort((a, b) => b.score - a.score);
    const top = candidates[0]; const runnerUp = candidates[1];
    const close = Boolean(runnerUp && top.score - runnerUp.score < 10);
    const identityStatus: NonNullable<GooglePlaceEvidence["identity_status"]> = close ? "AMBIGUOUS" : top.score >= 80 ? "MATCHED" : top.score >= 60 ? "LIKELY_MATCHED" : top.score >= 40 ? "AMBIGUOUS" : "NOT_FOUND";
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
    const matchSignals = [top.score >= 35 ? "商家名称一致" : "", isSpecificPlaceUrl ? "使用客户提供的具体Google商家页" : "", addressIdentityScore(input.address, top.address) >= 0.7 ? "完整地址一致" : "", input.country && String(input.country).toUpperCase() === top.countryCode ? "国家代码一致" : "", domain(input.website) && domain(input.website) === domain(top.website) ? "公开网站一致" : "", digits(input.phone).length >= 7 && digits(input.phone) === digits(top.phone) ? "电话号码一致" : ""].filter(Boolean);
    return {
      configured: false,
      query,
      name: top.name,
      formatted_address: top.address,
      business_status: allStrings.some((item) => /(?:永久关闭|cerrado permanentemente|permanently closed)/i.test(item)) ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
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
      mismatch_signals: identityStatus === "NOT_FOUND" ? ["公开地图结果与客户名称或地址不一致"] : [],
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
  const query = [input.company_name, input.address, input.country].filter(Boolean).join(" ");
  if (!apiKey) {
    const publicEvidence = await collectPublicGooglePlaceEvidence(input, options);
    return publicEvidence || {
      configured: false, query, types: [], reviews: [], emails: [],
      error: "未能从公开Google商家页定位到与名称和地址一致的具体企业。",
    };
  }

  // Cost-controlled Places API (New) flow:
  // 1. Search only for Place IDs (currently an unlimited free SKU).
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
      photos?: Array<{ name?: string }>;
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
    const readDetail = async (placeId: string, fieldMask: string): Promise<PlaceDetail | null> => {
      const response = await fetchWithRetry(detailUrl(placeId), {
        signal: request.signal,
        headers: placesHeaders(fieldMask),
      });
      if (!response.ok) return null;
      return await response.json() as PlaceDetail;
    };

    const directPlaceId = input.place_id?.trim() || googlePlaceIdFromUrl(input.google_url);
    let candidateIds = directPlaceId ? [directPlaceId] : [];
    if (!candidateIds.length) {
      const searchResponse = await fetchWithRetry("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        signal: request.signal,
        headers: placesHeaders("places.id"),
        body: JSON.stringify({ textQuery: query, pageSize: 3, languageCode: "zh-CN" }),
      });
      const searchPayload = await searchResponse.json() as { places?: Array<{ id?: string }>; error?: { message?: string } };
      candidateIds = (searchPayload.places || []).map((item) => item.id || "").filter(Boolean).slice(0, 3);
      if (!searchResponse.ok || !candidateIds.length) {
        const fallback = await collectPublicGooglePlaceEvidence(input, options);
        return fallback || {
          configured: true, query, types: [], reviews: [], emails: [], candidate_count: 0,
          identity_status: "NOT_FOUND", identity_confidence: 0,
          error: searchPayload.error?.message || "未找到匹配的Google商家。",
        };
      }
    }

    const proFields = "id,displayName,formattedAddress,businessStatus,types,primaryType,primaryTypeDisplayName,googleMapsUri,photos";
    const details: PlaceDetail[] = [];
    for (const candidateId of candidateIds) {
      const item = await readDetail(candidateId, proFields);
      if (item) details.push(item);
      // A specific supplied Place ID is already the exact entity; there is no
      // reason to spend another request on other candidates.
      if (directPlaceId && item) break;
      // Most Text Search requests rank the intended entity first. A near-exact
      // name plus address is enough to avoid additional paid candidate reads.
      if (item && nameSimilarity(input.company_name, item.displayName?.text) >= 0.88
        && (!input.address || addressIdentityScore(input.address, item.formattedAddress) >= 0.55)) break;
    }
    if (!details.length) {
      const fallback = await collectPublicGooglePlaceEvidence(input, options);
      return fallback || { configured: true, query, types: [], reviews: [], emails: [], candidate_count: candidateIds.length, identity_status: "NOT_FOUND", identity_confidence: 0, error: "未能读取Google商家详情。" };
    }
    const normalize = (value?: string | null) => String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const domain = (value?: string | null) => { try { return new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
    const phone = (value?: string | null) => String(value || "").replace(/\D/g, "");
    const scored = details.map((item) => {
      const matchSignals: string[] = []; const mismatchSignals: string[] = [];
      const candidateName = item.displayName?.text || "";
      const candidateNameSimilarity = nameSimilarity(input.company_name, candidateName);
      const nameScore = Math.round(candidateNameSimilarity * 55);
      if (nameScore >= 44) matchSignals.push("商家名称高度一致"); else mismatchSignals.push("商家名称未达到高度一致");
      const addressSimilarity = addressIdentityScore(input.address, item.formattedAddress);
      const addressScore = Math.round(addressSimilarity * 35);
      if (addressScore >= 21) matchSignals.push("地址信息一致"); else if (input.address) mismatchSignals.push("地址信息不足或不一致");
      const countryScore = input.country && normalize(item.formattedAddress).includes(normalize(input.country)) ? 10 : 0;
      if (countryScore) matchSignals.push("国家或地区一致");
      const specificUrlScore = input.google_url && /google\.[^/]+\/maps\/(?:place|search)/i.test(input.google_url) && candidateNameSimilarity >= 0.55 ? 25 : 0;
      if (specificUrlScore) matchSignals.push("客户提供的Google商家入口与候选名称一致");
      const directIdScore = directPlaceId && item.id === directPlaceId ? 35 : 0;
      if (directIdScore) matchSignals.push("Google Place ID一致");
      return { item, score: Math.min(100, nameScore + addressScore + countryScore + specificUrlScore + directIdScore), matchSignals, mismatchSignals };
    }).sort((a, b) => b.score - a.score);
    let top = scored[0]; const runnerUp = scored[1];

    // Contact/rating fields are requested once, and only for the selected
    // entity. Generic Places categories such as `service` do not prove an
    // industry, so an already strongly matched but generically classified
    // entity also receives a small review/editorial clarification request.
    // This prevents clear repair businesses from being downgraded merely
    // because Google returned a generic primary type, while avoiding this
    // higher-cost evidence request for every customer.
    const genericPlaceTypes = new Set(["service", "point_of_interest", "establishment"]);
    const hasSpecificPlaceType = (top.item.types || []).some((type) => !genericPlaceTypes.has(type));
    const needsBusinessClarification = top.score >= 70 && !hasSpecificPlaceType;
    const needsContactEnrichment = !input.phone || !input.website || top.score < 70;
    if (top.item.id && (needsContactEnrichment || needsBusinessClarification)) {
      const enrichmentFields = [
        "id", "internationalPhoneNumber", "nationalPhoneNumber", "websiteUri",
        "rating", "userRatingCount", "regularOpeningHours",
        ...(needsBusinessClarification ? ["editorialSummary", "reviews"] : []),
      ].join(",");
      const enterprise = await readDetail(top.item.id, enrichmentFields);
      if (enterprise) {
        top = { ...top, item: { ...top.item, ...enterprise } };
        const websiteScore = domain(input.website) && domain(input.website) === domain(enterprise.websiteUri) ? 35 : 0;
        const enterprisePhone = enterprise.internationalPhoneNumber || enterprise.nationalPhoneNumber;
        const phoneScore = phone(input.phone).length >= 7 && phone(input.phone) === phone(enterprisePhone) ? 25 : 0;
        if (websiteScore) top.matchSignals.push("官网域名一致");
        if (phoneScore) top.matchSignals.push("电话号码一致");
        top.score = Math.min(100, top.score + websiteScore + phoneScore);
      }
    }
    const closeCandidates = Boolean(runnerUp && top.score - runnerUp.score < 10);
    const identityStatus: NonNullable<GooglePlaceEvidence["identity_status"]> = closeCandidates
      ? "AMBIGUOUS"
      : top.score >= 90
        ? "MATCHED"
        : top.score >= 70
          ? "LIKELY_MATCHED"
          : top.score >= 45
            ? "AMBIGUOUS"
            : "NOT_FOUND";
    const result = top.item;
    const reviewTexts = unique((result.reviews || []).map((review) => review.text?.text || review.originalText?.text || "")).slice(0, 5);
    const textualBusinessFacts = [result.editorialSummary?.text, ...reviewTexts].filter(Boolean).join(" ");
    const hasDirectBusinessActivity = /(?:repair|fix|replacement|parts?|accessor|wholesale|distributor|napraw|serwis|repar|r[eé]paration|riparazione|repara[cç][aã]o|维修|修理|更换|配件|批发|分销)/i.test(textualBusinessFacts);

    // Places photo resources require a separate paid media call. For a
    // strongly matched but generically typed business, reuse the public Maps
    // payload only as an auditable media supplement. It is merged solely when
    // Place ID, phone, or address independently confirms the same entity.
    let publicMedia: GooglePlaceEvidence | undefined;
    if (needsBusinessClarification) {
      publicMedia = await collectPublicGooglePlaceEvidence(input, { ...options, timeoutMs: Math.min(options.timeoutMs || 9_000, 9_000) });
      const samePublicEntity = Boolean(publicMedia && (
        (result.id && publicMedia.place_id === result.id)
        || (phone(publicMedia.phone).length >= 7 && phone(publicMedia.phone) === phone(result.internationalPhoneNumber || result.nationalPhoneNumber))
        || addressIdentityScore(publicMedia.formatted_address, result.formattedAddress) >= 0.8
      ));
      if (!samePublicEntity) publicMedia = undefined;
    }
    let placePhotoUrls: string[] = [];
    if (needsBusinessClarification && !hasDirectBusinessActivity && !(publicMedia?.image_urls?.length) && result.photos?.length) {
      const photoResponses = await Promise.all(result.photos.slice(0, 2).map(async (photo) => {
        if (!photo.name) return "";
        try {
          const photoResponse = await fetchWithRetry(`https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=1200&maxWidthPx=1200&skipHttpRedirect=true`, {
            signal: request.signal,
            headers: { "X-Goog-Api-Key": apiKey },
          });
          if (!photoResponse.ok) return "";
          const payload = await photoResponse.json() as { photoUri?: string };
          return /^https?:\/\//i.test(payload.photoUri || "") ? payload.photoUri || "" : "";
        } catch {
          return "";
        }
      }));
      placePhotoUrls = unique(photoResponses).slice(0, 2);
    }
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
      description: result.editorialSummary?.text || publicMedia?.description,
      image_urls: unique([...(publicMedia?.image_urls || []), ...placePhotoUrls]).slice(0, 2),
      video_urls: publicMedia?.video_urls || [],
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
    const fallback = await collectPublicGooglePlaceEvidence(input, options);
    return fallback || { configured: true, query, types: [], reviews: [], emails: [], error: error instanceof Error ? error.message : "Google商家读取失败" };
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

