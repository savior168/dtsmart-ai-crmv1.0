export type WebsiteEvidence = {
  url: string;
  reachable: boolean;
  title?: string;
  description?: string;
  headings: string[];
  text_excerpt?: string;
  image_alts: string[];
  image_urls: string[];
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
  reviews: string[];
  error?: string;
};

export type CustomerEvidence = {
  website?: WebsiteEvidence;
  google_place?: GooglePlaceEvidence;
};

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

export async function collectWebsiteEvidence(url?: string | null): Promise<WebsiteEvidence | undefined> {
  const normalized = normalizeUrl(url);
  if (!normalized) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(normalized, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 DTSmart-AI-CRM/1.0 customer validation",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], error: `HTTP ${response.status}` };
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
    };
  } catch (error) {
    return { url: normalized, reachable: false, headings: [], image_alts: [], image_urls: [], error: error instanceof Error ? error.message : "website fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectGooglePlaceEvidence(input: {
  company_name: string;
  address?: string | null;
  country?: string | null;
  google_url?: string | null;
}): Promise<GooglePlaceEvidence | undefined> {
  if (!input.google_url && !input.company_name) return undefined;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  const query = [input.company_name, input.address, input.country].filter(Boolean).join(" ");
  if (!apiKey) return { configured: false, query, types: [], reviews: [], error: "GOOGLE_MAPS_API_KEY_NOT_CONFIGURED" };

  try {
    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("key", apiKey);
    const searchResponse = await fetch(searchUrl);
    const searchPayload = await searchResponse.json() as {
      status?: string;
      error_message?: string;
      results?: Array<{ place_id?: string }>;
    };
    const placeId = searchPayload.results?.[0]?.place_id;
    if (!searchResponse.ok || !placeId) {
      return { configured: true, query, types: [], reviews: [], error: searchPayload.error_message || searchPayload.status || "PLACE_NOT_FOUND" };
    }

    const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailsUrl.searchParams.set("place_id", placeId);
    detailsUrl.searchParams.set("fields", "name,formatted_address,business_status,rating,user_ratings_total,types,website,formatted_phone_number,reviews");
    detailsUrl.searchParams.set("key", apiKey);
    const detailsResponse = await fetch(detailsUrl);
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
      return { configured: true, query, types: [], reviews: [], error: detailsPayload.error_message || detailsPayload.status || "PLACE_DETAILS_NOT_FOUND" };
    }
    return {
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
      reviews: (result.reviews || []).map((review) => review.text || "").filter(Boolean).slice(0, 5),
    };
  } catch (error) {
    return { configured: true, query, types: [], reviews: [], error: error instanceof Error ? error.message : "google place fetch failed" };
  }
}

export async function collectCustomerEvidence(input: {
  customer_name: string;
  country?: string | null;
  website?: string | null;
  google_url?: string | null;
  address?: string | null;
}): Promise<CustomerEvidence> {
  const [website, google_place] = await Promise.all([
    collectWebsiteEvidence(input.website),
    collectGooglePlaceEvidence({
      company_name: input.customer_name,
      country: input.country,
      address: input.address,
      google_url: input.google_url,
    }),
  ]);
  return { website, google_place };
}
