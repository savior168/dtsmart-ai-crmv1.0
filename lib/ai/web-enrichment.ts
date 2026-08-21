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
  pages?: Array<{ url: string; title?: string; description?: string; headings: string[]; text_excerpt?: string; image_alts: string[]; image_urls: string[]; emails: string[]; phones: string[] }>;
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
  emails?: string[];
  reviews: string[];
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

function extractPhones(text: string) {
  return unique((text.match(/(?:\+?\d[\d\s\-().]{6,}\d)/g) || []).map((phone) => phone.replace(/\s+/g, " ").trim())).slice(0, 12);
}

function extractWhatsapps(text: string) {
  return unique([...text.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{7,18})/gi)].map((match) => match[1]));
}

export async function collectWebsiteEvidence(url?: string | null, options: FetchOptions = {}): Promise<WebsiteEvidence | undefined> {
  const normalized = normalizeUrl(url);
  if (!normalized) return undefined;

  const request = requestSignal(options, 5000);
  try {
    const response = await fetch(normalized, {
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
    const html = (await response.text()).slice(0, 350_000);
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
      text_excerpt: compactText(html).slice(0, 5000),
      image_alts: matches(html, /<img[^>]+alt=["']([^"']+)["'][^>]*>/gi, 16),
      image_urls: imageUrls,
      emails: extractEmails(html),
      phones: extractPhones(compactText(html)),
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
    return ["http:", "https:"].includes(resolved.protocol) && resolved.hostname === origin.hostname ? resolved.toString() : null;
  } catch {
    return null;
  }
}

async function discoverImportantWebsitePages(url: string, options: FetchOptions = {}) {
  const request = requestSignal(options, 3500);
  try {
    const response = await fetch(url, {
      signal: request.signal,
      headers: { "User-Agent": "Mozilla/5.0 DTSmart-AI-CRM/1.0 customer validation", Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return [];
    const html = (await response.text()).slice(0, 350_000);
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
    pages: pages.map(({ url: pageUrl, title, description, headings, text_excerpt, image_alts, image_urls, emails, phones }) => ({ url: pageUrl, title, description, headings, text_excerpt, image_alts, image_urls, emails, phones })),
  };
}

export async function collectGooglePlaceEvidence(input: {
  company_name: string;
  address?: string | null;
  country?: string | null;
  google_url?: string | null;
}, options: FetchOptions = {}): Promise<GooglePlaceEvidence | undefined> {
  if (!input.google_url && !input.company_name) return undefined;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  const query = [input.company_name, input.address, input.country].filter(Boolean).join(" ");
  if (!apiKey) return { configured: false, query, types: [], reviews: [], emails: [], error: "GOOGLE_MAPS_API_KEY_NOT_CONFIGURED" };

  const request = requestSignal(options, 4500);
  try {
    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("key", apiKey);
    const searchResponse = await fetch(searchUrl, { signal: request.signal });
    const searchPayload = await searchResponse.json() as {
      status?: string;
      error_message?: string;
      results?: Array<{ place_id?: string }>;
    };
    const placeId = searchPayload.results?.[0]?.place_id;
    if (!searchResponse.ok || !placeId) {
      return { configured: true, query, types: [], reviews: [], emails: [], error: searchPayload.error_message || searchPayload.status || "PLACE_NOT_FOUND" };
    }

    const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailsUrl.searchParams.set("place_id", placeId);
    detailsUrl.searchParams.set("fields", "name,formatted_address,business_status,rating,user_ratings_total,types,website,formatted_phone_number,reviews");
    detailsUrl.searchParams.set("key", apiKey);
    const detailsResponse = await fetch(detailsUrl, { signal: request.signal });
    const detailsPayload = await detailsResponse.json() as {
      status?: string;
      error_message?: string;
      result?: {
        name?: string;
        formatted_address?: string;
        business_status?: string;
        rating?: number;
        user_ratings_total?: number;
        types?: string[];
        website?: string;
        formatted_phone_number?: string;
        reviews?: Array<{ text?: string }>;
      };
    };
    const result = detailsPayload.result;
    if (!detailsResponse.ok || !result) {
      return { configured: true, query, types: [], reviews: [], emails: [], error: detailsPayload.error_message || detailsPayload.status || "PLACE_DETAILS_NOT_FOUND" };
    }
    const evidence = {
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
      emails: extractEmails([result.website, result.formatted_address, ...(result.reviews || []).map((review) => review.text || "")].join(" ")),
      reviews: (result.reviews || []).map((review) => review.text || "").filter(Boolean).slice(0, 5),
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
