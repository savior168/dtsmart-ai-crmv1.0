import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseApiCostBudget, reserveApiCostBudget } from "@/lib/api-cost-budget";
import { localizedSearchTerms, type AcquisitionCountry } from "./config";

export type DiscoveredBusiness = {
  placeId: string; companyName: string; address: string; country: AcquisitionCountry;
  businessStatus: string; types: string[]; googleUrl: string; query: string;
};

const GOOGLE_TEXT_SEARCH_PRO_FREE_CAP = 5000;
const GOOGLE_TEXT_SEARCH_PRO_UNIT_PRICE = 0.032;

async function currentMonthSkuCalls(sku: string) {
  const admin = createAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count, error } = await admin.from("api_cost_ledger").select("id", { count: "exact", head: true }).eq("provider", "GOOGLE_PLACES").eq("model_or_sku", sku).gte("occurred_at", monthStart);
  if (error) throw error;
  return Number(count || 0);
}

export async function discoverBusinesses(input: {
  acquisitionTaskId: string; screeningTaskId: string; userId: string; costMode: "FREE_ONLY" | "ADAPTIVE";
  country: AcquisitionCountry; industries: string[]; keywords: string[]; excludedKeywords: string[]; limit: number;
}) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY_NOT_CONFIGURED");
  const countryName = new Intl.DisplayNames(["en"], { type: "region" }).of(input.country) || input.country;
  const terms = localizedSearchTerms(input.country, input.industries, input.keywords);
  const results = new Map<string, DiscoveredBusiness>();
  const perTermLimit = Math.min(20, Math.max(5, Math.ceil(input.limit / Math.max(1, terms.length))));
  for (const term of terms) {
    const used = await currentMonthSkuCalls("PLACES_TEXT_SEARCH_PRO");
    const insideFreeCap = used < GOOGLE_TEXT_SEARCH_PRO_FREE_CAP;
    if (input.costMode === "FREE_ONLY" && !insideFreeCap) break;
    const effectivePrice = insideFreeCap ? 0 : GOOGLE_TEXT_SEARCH_PRO_UNIT_PRICE;
    const reservation = await reserveApiCostBudget("GOOGLE_PLACES", effectivePrice, { userId: input.userId, taskId: input.screeningTaskId, operation: "AI获客目标商家搜索" });
    if (!reservation.allowed) break;
    const query = `${term} in ${countryName}`;
    let response: Response | null = null;
    try {
      response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.types,places.googleMapsUri" },
        body: JSON.stringify({ textQuery: query, pageSize: perTermLimit, languageCode: "en", regionCode: input.country }),
        signal: AbortSignal.timeout(15_000),
      });
      const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id") || randomUUID();
      const ok = response.ok;
      const payload = await response.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; businessStatus?: string; types?: string[]; googleMapsUri?: string }>; error?: { message?: string } };
      await createAdminClient().from("api_cost_ledger").insert({
        user_id: input.userId, task_id: input.acquisitionTaskId, provider: "GOOGLE_PLACES", service: "AI获客", operation: "目标商家搜索",
        model_or_sku: "PLACES_TEXT_SEARCH_PRO", request_id: requestId, quantity: 1, unit: "REQUEST",
        amount_usd: ok ? effectivePrice : 0, amount_type: insideFreeCap && ok ? "FREE" : "ESTIMATED",
        pricing_snapshot: { unit_price_usd: GOOGLE_TEXT_SEARCH_PRO_UNIT_PRICE, free_usage_cap: GOOGLE_TEXT_SEARCH_PRO_FREE_CAP, free_cap_source: "GOOGLE_2026_09", inside_recorded_free_cap: insideFreeCap },
        metadata: { http_status: response.status, query, region_code: input.country }, occurred_at: new Date().toISOString(),
      });
      if (!ok) throw new Error(payload.error?.message || `GOOGLE_PLACES_${response.status}`);
      const excluded = input.excludedKeywords.map((value) => value.toLowerCase()).filter(Boolean);
      for (const place of payload.places || []) {
        const placeId = String(place.id || "").trim();
        const companyName = String(place.displayName?.text || "").trim();
        const address = String(place.formattedAddress || "").trim();
        const searchable = `${companyName} ${address} ${(place.types || []).join(" ")}`.toLowerCase();
        if (!placeId || !companyName || excluded.some((word) => searchable.includes(word))) continue;
        if (!results.has(placeId)) results.set(placeId, { placeId, companyName, address, country: input.country, businessStatus: String(place.businessStatus || ""), types: place.types || [], googleUrl: place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`, query });
      }
    } finally {
      await releaseApiCostBudget(reservation.reservationId);
    }
  }
  return [...results.values()].slice(0, input.limit);
}

export function discoveryCandidateLooksRelevant(candidate: DiscoveredBusiness, industries: string[], keywords: string[]) {
  const text = `${candidate.companyName} ${candidate.types.join(" ")}`.toLowerCase().replace(/[_-]+/g, " ");
  const requested = [...industries, ...keywords].flatMap((value) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((value) => value.length >= 3);
  const directType = candidate.types.some((value) => !/^(?:establishment|point_of_interest|store|service)$/i.test(value));
  return candidate.businessStatus !== "CLOSED_PERMANENTLY" && (requested.some((term) => text.includes(term)) || directType);
}
