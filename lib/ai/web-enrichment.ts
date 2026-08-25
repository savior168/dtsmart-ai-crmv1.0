import { lookup } from "node:dns/promises";

export type WebsiteEvidence = {
  url: string;
  reachable: boolean;
  title?: string;
  description?: string;
  headings: string[];
  text_excerpt?: string;
  image_alts: string[];
  image_urls: string[];
  emails: string[];
  phones: string[];
  whatsapps?: string[];
  video_urls?: string[];
  pages?: Array<{ url: string; title?: string; description?: string; headings: string[]; text_excerpt?: string; image_alts: string[]; image_urls: string[]; video_urls?: string[]; emails: string[]; phones: string[]; whatsapps?: string[] }>;
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
  return new TextDecoder().decode(Buffer.concat(chunks));
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
    const visibleText = compactText(html).slice(0, 6000);
    if (/(?:log in|sign in|登录后继续|cookie settings|accept all cookies)/i.test(`${firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || ""} ${visibleText}`)
        && /(?:facebook|instagram|linkedin|tiktok)\.com/i.test(parsedUrl.hostname)) {
      return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], emails: [], phones: [], error: "社媒登录页或Cookie页，未读取到企业公开主页" };
    }
    const imageUrls = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
      .slice(0, 12)
      .map((match) => match[1])
      .filter(Boolean);
    return {
      url: normalized,
      reachable: true,
      title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description: firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i),
      headings: matches(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 16),
      text_excerpt: visibleText.slice(0, 5000),
      image_alts: matches(html, /<img[^>]+alt=["']([^"']+)["'][^>]*>/gi, 16),
      image_urls: imageUrls,
      emails: extractEmails(html),
      phones: extractPhones(html),
      whatsapps: extractWhatsapps(html),
      video_urls: unique([...html.matchAll(/<(?:video|source|iframe)[^>]+(?:src)=['\"]([^'\"]+)['\"]/gi)].map((match) => match[1])).slice(0, 12),
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
    const keywords = /about|company|service|product|contact|support|team|portfolio|solution|业务|关于|服务|产品|联系/i;
    const links = [...html.matchAll(/<a[^>]+href=['\"]([^'\"#]+)['\"][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({ url: sameWebsiteUrl(url, match[1]), text: compactText(match[2]) }))
      .filter((item): item is { url: string; text: string } => Boolean(item.url) && keywords.test(`${item.url} ${item.text}`));
    return [...new Set(links.map((item) => item.url).filter((item) => item !== url))].slice(0, 4);
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
    headings: unique([...homepage.headings, ...pages.flatMap((page) => page.headings)]).slice(0, 40),
    image_alts: unique([...homepage.image_alts, ...pages.flatMap((page) => page.image_alts)]).slice(0, 40),
    image_urls: unique([...homepage.image_urls, ...pages.flatMap((page) => page.image_urls)]).slice(0, 30),
    video_urls: unique([...(homepage.video_urls || []), ...pages.flatMap((page) => page.video_urls || [])]).slice(0, 20),
    emails: unique([...homepage.emails, ...pages.flatMap((page) => page.emails)]),
    phones: unique([...homepage.phones, ...pages.flatMap((page) => page.phones)]),
    whatsapps: unique([...(homepage.whatsapps || []), ...pages.flatMap((page) => page.whatsapps || [])]),
    text_excerpt: [homepage.text_excerpt, ...pages.map((page) => page.text_excerpt)].filter(Boolean).join("\n\n").slice(0, 16_000),
    pages: pages.map(({ url: pageUrl, title, description, headings, text_excerpt, image_alts, image_urls, video_urls, emails, phones, whatsapps }) => ({ url: pageUrl, title, description, headings, text_excerpt, image_alts, image_urls, video_urls, emails, phones, whatsapps })),
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

function nestedStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => nestedStrings(item, output));
  return output;
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
  const query = locationText || [input.company_name, input.country].filter(Boolean).join(", ");
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
    const searchPage = isSpecificPlaceUrl ? providedUrl! : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    const pageResponse = await fetchPublic(searchPage, { signal: request.signal, headers });
    if (!pageResponse.ok) return undefined;
    const pageHtml = await readTextLimited(pageResponse, 450_000);
    const endpointMatch = pageHtml.match(/<link\s+href="([^"]*(?:\/search\?tbm=map|\/maps\/preview\/place\?)[^"]+)"/i);
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
      const nameScore = Math.round(textSimilarity(input.company_name, name) * 45);
      const addressScore = Math.round(textSimilarity(input.address, address) * 35);
      const websiteScore = domain(input.website) && domain(input.website) === domain(website) ? 15 : 0;
      const phoneScore = digits(input.phone).length >= 7 && digits(input.phone) === digits(phone) ? 20 : 0;
      const countryScore = input.country && String(input.country).toUpperCase() === countryCode ? 10 : 0;
      const exactPlaceUrlScore = isSpecificPlaceUrl && nameScore >= 35 ? 50 : 0;
      return { row, name, address, website, phone, countryCode, score: Math.min(100, nameScore + addressScore + websiteScore + phoneScore + countryScore + exactPlaceUrlScore) };
    }).sort((a, b) => b.score - a.score);
    const top = candidates[0]; const runnerUp = candidates[1];
    const close = Boolean(runnerUp && top.score - runnerUp.score < 10);
    const identityStatus: NonNullable<GooglePlaceEvidence["identity_status"]> = close ? "AMBIGUOUS" : top.score >= 80 ? "MATCHED" : top.score >= 60 ? "LIKELY_MATCHED" : top.score >= 40 ? "AMBIGUOUS" : "NOT_FOUND";
    const allStrings = nestedStrings(top.row);
    const imageUrls = unique(allStrings.filter((item) => /^https:\/\/(?:lh\d+|streetviewpixels)\.googleusercontent\.com/i.test(item))).slice(0, 24);
    const videoUrls = unique(allStrings.filter((item) => /^https?:\/\//i.test(item) && /(?:youtube\.com|youtu\.be|\.mp4(?:\?|$))/i.test(item))).slice(0, 12);
    const hours = unique(allStrings.filter((item) => /(?:营业|开放|关闭|abierto|cerrado|a\.m\.|p\.m\.)/i.test(item) && item.length < 140)).slice(0, 14);
    const descriptionBlock = Array.isArray(top.row[154]) && Array.isArray(top.row[154][0]) ? top.row[154][0] : [];
    const verifiedUrl = isSpecificPlaceUrl ? searchPage : typeof top.row[42] === "string" ? top.row[42] : searchPage;
    const matchSignals = [top.score >= 35 ? "商家名称一致" : "", isSpecificPlaceUrl ? "使用客户提供的具体Google商家页" : "", textSimilarity(input.address, top.address) >= 0.45 ? "完整地址一致" : "", input.country && String(input.country).toUpperCase() === top.countryCode ? "国家代码一致" : "", domain(input.website) && domain(input.website) === domain(top.website) ? "公开网站一致" : "", digits(input.phone).length >= 7 && digits(input.phone) === digits(top.phone) ? "电话号码一致" : ""].filter(Boolean);
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
}, options: FetchOptions = {}): Promise<GooglePlaceEvidence | undefined> {
  if (!input.google_url && !input.company_name) return undefined;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  const query = [input.company_name, input.address, input.country].filter(Boolean).join(" ");
  const publicEvidence = await collectPublicGooglePlaceEvidence(input, options);
  if (publicEvidence && ["MATCHED", "LIKELY_MATCHED"].includes(String(publicEvidence.identity_status))) return publicEvidence;
  if (!apiKey) return publicEvidence || {
    configured: false, query, types: [], reviews: [], emails: [],
    error: "未能从公开Google商家页定位到与名称和地址一致的具体企业。",
  };

  const request = requestSignal(options, 4500);
  try {
    type Candidate = { place_id?: string; name?: string; formatted_address?: string; business_status?: string; rating?: number; user_ratings_total?: number; types?: string[] };
    const directPlaceId = googlePlaceIdFromUrl(input.google_url);
    let candidates: Candidate[] = directPlaceId ? [{ place_id: directPlaceId }] : [];
    if (!candidates.length) {
      const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      searchUrl.searchParams.set("query", query);
      searchUrl.searchParams.set("key", apiKey);
      const searchResponse = await fetchWithRetry(searchUrl, { signal: request.signal });
      const searchPayload = await searchResponse.json() as {
        status?: string;
        error_message?: string;
        results?: Candidate[];
      };
      candidates = (searchPayload.results || []).filter((item) => item.place_id).slice(0, 5);
      if (!searchResponse.ok || !candidates.length) {
        return { configured: true, query, types: [], reviews: [], emails: [], error: searchPayload.error_message || searchPayload.status || "PLACE_NOT_FOUND" };
      }
    }
    type Detail = { place_id: string; name?: string; formatted_address?: string; business_status?: string; rating?: number; user_ratings_total?: number; types?: string[]; website?: string; formatted_phone_number?: string; reviews?: Array<{ text?: string }> };
    const details = (await Promise.all(candidates.map(async (candidate): Promise<Detail | null> => {
      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("place_id", candidate.place_id!);
      detailsUrl.searchParams.set("fields", "place_id,name,formatted_address,business_status,rating,user_ratings_total,types,website,formatted_phone_number,reviews,url");
      detailsUrl.searchParams.set("key", apiKey);
       const response = await fetchWithRetry(detailsUrl, { signal: request.signal });
      const payload = await response.json() as { result?: Omit<Detail, "place_id">; status?: string };
      return response.ok && payload.result ? { ...candidate, ...payload.result, place_id: candidate.place_id! } : null;
    }))).filter((item): item is Detail => Boolean(item));
    if (!details.length) return { configured: true, query, types: [], reviews: [], emails: [], candidate_count: candidates.length, identity_status: "NOT_FOUND", identity_confidence: 0, error: "PLACE_DETAILS_NOT_FOUND" };
    const normalize = (value?: string | null) => String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const tokens = (value?: string | null) => new Set(normalize(value).split(/\s+/).filter((item) => item.length > 1));
    const similarity = (a?: string | null, b?: string | null) => {
      const left = tokens(a); const right = tokens(b); if (!left.size || !right.size) return 0;
      const common = [...left].filter((item) => right.has(item)).length;
      return common / Math.max(left.size, right.size);
    };
    const domain = (value?: string | null) => { try { return new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
    const phone = (value?: string | null) => String(value || "").replace(/\D/g, "");
    const scored = details.map((item) => {
      const matchSignals: string[] = []; const mismatchSignals: string[] = [];
      const nameScore = Math.round(similarity(input.company_name, item.name) * 45);
      if (nameScore >= 36) matchSignals.push("商家名称高度一致"); else mismatchSignals.push("商家名称未达到高度一致");
      const addressScore = Math.round(similarity(input.address, item.formatted_address) * 25);
      if (addressScore >= 18) matchSignals.push("地址信息一致"); else if (input.address) mismatchSignals.push("地址信息不足或不一致");
      const countryScore = input.country && normalize(item.formatted_address).includes(normalize(input.country)) ? 10 : 0;
      if (countryScore) matchSignals.push("国家或地区一致");
      const websiteScore = domain(input.website) && domain(input.website) === domain(item.website) ? 15 : 0;
      if (websiteScore) matchSignals.push("官网域名一致"); else if (input.website && item.website) mismatchSignals.push("官网域名不一致");
      const phoneScore = phone(input.phone).length >= 7 && phone(input.phone) === phone(item.formatted_phone_number) ? 20 : 0;
      if (phoneScore) matchSignals.push("电话号码一致"); else if (input.phone && item.formatted_phone_number) mismatchSignals.push("电话号码不一致");
      return { item, score: Math.min(100, nameScore + addressScore + countryScore + websiteScore + phoneScore), matchSignals, mismatchSignals };
    }).sort((a, b) => b.score - a.score);
    const top = scored[0]; const runnerUp = scored[1];
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
    const evidence: GooglePlaceEvidence = {
      configured: true,
      query,
      name: result.name,
      formatted_address: result.formatted_address,
      business_status: result.business_status,
      rating: result.rating,
      user_ratings_total: result.user_ratings_total,
      types: result.types || [],
      website: result.website,
      phone: result.formatted_phone_number,
      // Google Places does not expose a business email. Review text belongs to
      // reviewers and must never be promoted to the merchant's contact data.
      emails: [],
      reviews: (result.reviews || []).map((review) => review.text || "").filter(Boolean).slice(0, 5),
      place_id: result.place_id,
      candidate_count: details.length,
      identity_status: identityStatus,
      identity_confidence: top.score,
      match_signals: top.matchSignals,
      mismatch_signals: top.mismatchSignals,
      verified_google_maps_url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(result.place_id)}`,
    };
    return evidence;
  } catch (error) {
    return { configured: true, query, types: [], reviews: [], emails: [], error: error instanceof Error ? error.message : "google place fetch failed" };
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

