import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseApiCostBudget, reserveApiCostBudget } from "@/lib/api-cost-budget";
import { ACQUISITION_COUNTRY_SEARCH_AREAS, ACQUISITION_FRESH_SEARCH_SCOPES_PER_COUNTRY, localizedSearchTerms, type AcquisitionCountry } from "./config";

export type DiscoveredBusiness = {
  placeId: string; companyName: string; address: string; country: AcquisitionCountry;
  businessStatus: string; types: string[]; googleUrl: string; query: string; matchedTerms: string[];
};
export type DiscoveryControl = "PAUSED" | "CANCELLED" | "BUDGET_LIMITED" | "CONTINUE" | null;

const GOOGLE_TEXT_SEARCH_PRO_FREE_CAP = 5000;
const GOOGLE_TEXT_SEARCH_PRO_UNIT_PRICE = 0.032;
const DISCOVERY_STRATEGY_VERSION = "GOOGLE_TEXT_V2_FULL_PAGE";
const SEARCH_REFRESH_DAYS = 90;
const DISCOVERY_STEP_FRESH_SCOPE_BATCH = 10;

function searchScopeKey(country: AcquisitionCountry, query: string) {
  return `${DISCOVERY_STRATEGY_VERSION}\n${country}\n${query.trim().toLowerCase()}`;
}

function discoveryQueries(country: AcquisitionCountry, countryName: string, terms: string[]) {
  const areas = ACQUISITION_COUNTRY_SEARCH_AREAS[country] || [];
  const queries: string[] = [];
  // Interleave the country baseline with one geographic shard per term, then
  // rotate every term through the remaining areas. Early stopping therefore
  // still covers different industries and different parts of the country.
  for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
    queries.push(`${terms[termIndex]} in ${countryName}`);
    if (areas.length) queries.push(`${terms[termIndex]} in ${areas[termIndex % areas.length]}, ${countryName}`);
  }
  for (let round = 1; round < areas.length; round += 1) {
    for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
      const area = areas[(termIndex + round) % areas.length];
      queries.push(`${terms[termIndex]} in ${area}, ${countryName}`);
    }
  }
  return [...new Set(queries)];
}

async function prioritizeUncoveredQueries(country: AcquisitionCountry, queries: string[]) {
  const admin = createAdminClient();
  const completedAt = new Map<string, number>();
  const keys = queries.map((query) => searchScopeKey(country, query));
  for (let offset = 0; offset < keys.length; offset += 100) {
    const scopeRows = await admin.from("ai_acquisition_search_scopes").select("scope_key,last_completed_at").in("scope_key", keys.slice(offset, offset + 100));
    if (scopeRows.error) throw scopeRows.error;
    for (const row of scopeRows.data || []) {
      const timestamp = row.last_completed_at ? new Date(String(row.last_completed_at)).getTime() : NaN;
      if (Number.isFinite(timestamp)) completedAt.set(String(row.scope_key), timestamp);
    }
  }
  const refreshCutoff=Date.now()-SEARCH_REFRESH_DAYS*24*60*60*1000;
  const candidates=queries.map((query, order) => ({ query, order, completedAt: completedAt.get(searchScopeKey(country, query)) }));
  const recentlyCovered=candidates.filter((item)=>item.completedAt!=null&&item.completedAt>=refreshCutoff).length;
  const prioritized=candidates.filter((item)=>item.completedAt==null||item.completedAt<refreshCutoff)
    .sort((left, right) => {
      if (left.completedAt == null && right.completedAt != null) return -1;
      if (left.completedAt != null && right.completedAt == null) return 1;
      if (left.completedAt != null && right.completedAt != null && left.completedAt !== right.completedAt) return left.completedAt - right.completedAt;
      return left.order - right.order;
    })
    .map((item) => item.query);
  return { queries:prioritized, recentlyCovered };
}

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
  const coveragePlan = await prioritizeUncoveredQueries(input.country, discoveryQueries(input.country, countryName, terms));
  const queries = coveragePlan.queries;
  const results = new Map<string, DiscoveredBusiness>();
  let freshSearchScopes = 0;
  const taskScopeUsage=await createAdminClient().from("ai_acquisition_discovery_checkpoints").select("query_text",{count:"exact",head:true}).eq("task_id",input.acquisitionTaskId).eq("country",input.country).in("status",["RUNNING","PAUSED","COMPLETED","BUDGET_LIMITED"]);
  if(taskScopeUsage.error)throw taskScopeUsage.error;
  const remainingScopeAllowance=Math.max(0,ACQUISITION_FRESH_SEARCH_SCOPES_PER_COUNTRY-Number(taskScopeUsage.count||0));
  const stepScopeLimit=Math.min(DISCOVERY_STEP_FRESH_SCOPE_BATCH,remainingScopeAllowance);
  if(!queries.length&&coveragePlan.recentlyCovered){
    const admin=createAdminClient();
    const summaryQuery=`[覆盖账本] ${countryName}`;
    const summary=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:summaryQuery,next_page:1,next_page_token:null,status:"SKIPPED_RECENT",stop_reason:`ALL_SCOPES_COVERED:${coveragePlan.recentlyCovered}`,result_count:0,results:[],updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
    if(summary.error)throw summary.error;
  }
  // A Text Search request costs the same for any supported page size. Always
  // request the provider maximum so broad country searches do not discard up
  // to 75% of the available candidates while consuming the same API call.
  const perTermLimit = 20;
  for (const query of queries) {
    if (freshSearchScopes >= stepScopeLimit) break;
    const term = query.split(" in ")[0] || query;
    const admin = createAdminClient();
    const existing = await admin.from("ai_acquisition_discovery_checkpoints").select("next_page,next_page_token,status,results").eq("task_id",input.acquisitionTaskId).eq("country",input.country).eq("query_text",query).maybeSingle();
    if(existing.error) throw existing.error;
    const savedResults = Array.isArray(existing.data?.results) ? existing.data.results as DiscoveredBusiness[] : [];
    savedResults.forEach((business)=>business?.placeId&&results.set(business.placeId,{...business,matchedTerms:Array.isArray(business.matchedTerms)&&business.matchedTerms.length?business.matchedTerms:[business.query].filter(Boolean)}));
    if(["COMPLETED","BUDGET_LIMITED","SKIPPED_RECENT","SKIPPED_ACTIVE","REUSED_RECENT","REUSED_ACTIVE"].includes(String(existing.data?.status||""))) continue;
    const scopeKey=searchScopeKey(input.country,query);
    if(!existing.data) {
      const claimed=await admin.rpc("claim_ai_acquisition_search_scope",{p_scope_key:scopeKey,p_task_id:input.acquisitionTaskId,p_country:input.country,p_query_text:query,p_refresh_days:SEARCH_REFRESH_DAYS});
      if(claimed.error)throw claimed.error;
      const claimState=String(claimed.data||"");
      if(claimState==="RECENTLY_COMPLETED"||claimState==="ACTIVE_ELSEWHERE") {
        const status=claimState==="ACTIVE_ELSEWHERE"?"SKIPPED_ACTIVE":"SKIPPED_RECENT";
        const skipped=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:query,next_page:1,next_page_token:null,status,stop_reason:claimState==="ACTIVE_ELSEWHERE"?"ACTIVE_ELSEWHERE":"ALREADY_COVERED",result_count:0,results:[],updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
        if(skipped.error)throw skipped.error;
        continue;
      }
      if(claimState!=="CLAIMED")throw new Error(`ACQUISITION_SEARCH_SCOPE_${claimState||"UNKNOWN"}`);
      freshSearchScopes += 1;
    }
    let pageToken = String(existing.data?.next_page_token||"");
    const firstPage = Math.max(1,Number(existing.data?.next_page||1));
    const queryResults = new Map(savedResults.filter((business)=>business?.placeId).map((business)=>[business.placeId,business]));
    for (let page = firstPage; page <= 3 && results.size < input.limit; page += 1) {
      const control = await admin.from("ai_acquisition_tasks").select("status,cancel_requested").eq("id",input.acquisitionTaskId).single();
      if(control.error) throw control.error;
      if(control.data.cancel_requested) return { businesses:[...results.values()].slice(0,input.limit), control:"CANCELLED" as const };
      if(["PAUSING","PAUSED"].includes(String(control.data.status))) {
        const paused=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:query,next_page:page,next_page_token:pageToken||null,status:"PAUSED",result_count:queryResults.size,results:[...queryResults.values()],updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
        if(paused.error)throw paused.error;
        return { businesses:[...results.values()].slice(0,input.limit), control:"PAUSED" as const };
      }
      const heartbeat=await admin.from("ai_acquisition_tasks").update({executor_heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",input.acquisitionTaskId).eq("status","RUNNING");
      if(heartbeat.error)throw heartbeat.error;
      const used = await currentMonthSkuCalls("PLACES_TEXT_SEARCH_PRO");
      const insideFreeCap = used < GOOGLE_TEXT_SEARCH_PRO_FREE_CAP;
      if (input.costMode === "FREE_ONLY" && !insideFreeCap) {
        const limited=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:query,next_page:page,next_page_token:pageToken||null,status:"BUDGET_LIMITED",stop_reason:"FREE_MODE",result_count:queryResults.size,results:[...queryResults.values()],updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
        if(limited.error)throw limited.error;
        return { businesses:[...results.values()].slice(0,input.limit), control:"BUDGET_LIMITED" as const };
      }
      const effectivePrice = insideFreeCap ? 0 : GOOGLE_TEXT_SEARCH_PRO_UNIT_PRICE;
      const reservation = await reserveApiCostBudget("GOOGLE_PLACES", effectivePrice, { userId: input.userId, taskId: input.screeningTaskId, operation: "AI获客目标商家搜索" });
      if (!reservation.allowed) {
        const limited=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:query,next_page:page,next_page_token:pageToken||null,status:"BUDGET_LIMITED",stop_reason:reservation.period||"BUDGET",result_count:queryResults.size,results:[...queryResults.values()],updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
        if(limited.error)throw limited.error;
        return { businesses:[...results.values()].slice(0,input.limit), control:"BUDGET_LIMITED" as const };
      }
      try {
        const running=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:query,next_page:page,next_page_token:pageToken||null,status:"RUNNING",stop_reason:null,result_count:queryResults.size,results:[...queryResults.values()],updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
        if(running.error)throw running.error;
        const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.businessStatus,places.types,places.googleMapsUri,nextPageToken" },
          body: JSON.stringify({ textQuery: query, pageSize: perTermLimit, languageCode: "en", regionCode: input.country, ...(pageToken ? { pageToken } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
        const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id") || randomUUID();
        const ok = response.ok;
        const payload = await response.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; addressComponents?: Array<{shortText?:string;types?:string[]}>; businessStatus?: string; types?: string[]; googleMapsUri?: string }>; nextPageToken?: string; error?: { message?: string } };
        await createAdminClient().from("api_cost_ledger").insert({
          user_id: input.userId, task_id: input.acquisitionTaskId, provider: "GOOGLE_PLACES", service: "AI获客", operation: "目标商家搜索",
          model_or_sku: "PLACES_TEXT_SEARCH_PRO", request_id: requestId, quantity: 1, unit: "REQUEST",
          amount_usd: ok ? effectivePrice : 0, amount_type: insideFreeCap && ok ? "FREE" : "ESTIMATED",
          pricing_snapshot: { unit_price_usd: GOOGLE_TEXT_SEARCH_PRO_UNIT_PRICE, free_usage_cap: GOOGLE_TEXT_SEARCH_PRO_FREE_CAP, free_cap_source: "GOOGLE_2026_09", inside_recorded_free_cap: insideFreeCap },
          metadata: { http_status: response.status, query, region_code: input.country, page }, occurred_at: new Date().toISOString(),
        });
        if (!ok) throw new Error(payload.error?.message || `GOOGLE_PLACES_${response.status}`);
        const excluded = input.excludedKeywords.map((value) => value.toLowerCase()).filter(Boolean);
        for (const place of payload.places || []) {
          const placeId = String(place.id || "").trim();
          const companyName = String(place.displayName?.text || "").trim();
          const address = String(place.formattedAddress || "").trim();
          const returnedCountry=place.addressComponents?.find((component)=>component.types?.includes("country"))?.shortText?.toUpperCase();
          const searchable = `${companyName} ${address} ${(place.types || []).join(" ")}`.toLowerCase();
          if (!placeId || !companyName || returnedCountry!==input.country || excluded.some((word) => searchable.includes(word))) continue;
          const previous=results.get(placeId);
          if (previous) {
            const business={...previous,matchedTerms:[...new Set([...(previous.matchedTerms||[]),term])]};
            results.set(placeId,business);queryResults.set(placeId,business);
          } else {
            const business={ placeId, companyName, address, country: input.country, businessStatus: String(place.businessStatus || ""), types: place.types || [], googleUrl: place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`, query, matchedTerms:[term] };
            results.set(placeId,business);queryResults.set(placeId,business);
          }
        }
        pageToken = String(payload.nextPageToken || "").trim();
        const completed=!pageToken||page>=3||results.size>=input.limit;
        const stopReason=results.size>=input.limit?"TASK_SAFETY_CEILING":page>=3&&pageToken?"PROVIDER_PAGE_LIMIT":!pageToken?"PROVIDER_EXHAUSTED":null;
        const checkpoint=await admin.from("ai_acquisition_discovery_checkpoints").upsert({task_id:input.acquisitionTaskId,country:input.country,query_text:query,next_page:Math.min(4,page+1),next_page_token:completed?null:pageToken,status:completed?"COMPLETED":"RUNNING",stop_reason:completed?stopReason:null,result_count:queryResults.size,results:[...queryResults.values()],last_request_id:requestId,updated_at:new Date().toISOString()},{onConflict:"task_id,country,query_text"});
        if(checkpoint.error)throw checkpoint.error;
        if(completed) {
          const completedScope=await admin.rpc("complete_ai_acquisition_search_scope",{p_scope_key:scopeKey,p_task_id:input.acquisitionTaskId,p_result_count:queryResults.size});
          if(completedScope.error)throw completedScope.error;
        }
        if (!pageToken) break;
      } finally {
        await releaseApiCostBudget(reservation.reservationId);
      }
    }
  }
  const shouldContinue=stepScopeLimit>0&&freshSearchScopes>=stepScopeLimit&&remainingScopeAllowance>freshSearchScopes&&results.size<input.limit;
  return { businesses:[...results.values()].slice(0, input.limit), control:shouldContinue?"CONTINUE" as const:null };
}

export function discoveryCandidateLooksRelevant(candidate: DiscoveredBusiness, industries: string[], keywords: string[]) {
  const requested = [...industries, ...keywords].flatMap((value) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((value) => value.length >= 3);
  const companyText = candidate.companyName.toLowerCase().replace(/[_-]+/g, " ");
  const targetBusinessSignal = /(?:phone|mobile|smartphone|iphone|ipad|macbook|laptop|computer|electronics|device|screen|battery|accessor|spare|parts?|repair|refurbish|wholesale|supplier|distribut|importer|手机|电脑|电子|维修|配件|批发|经销|进口|翻新)/i.test(companyText);
  const relevantGoogleType = candidate.types.some((value) => /^(?:cell_phone_store|electronics_store|electronics_repair_shop|computer_store|computer_repair_service|wholesaler|supplier|manufacturer|telecommunications_service_provider)$/i.test(value));
  const explicitlyIrrelevantType = candidate.types.some((value) => /^(?:hair_salon|hair_care|finance|courier_service|shipping_service|furniture_store|general_contractor|auto_parts_store|car_repair|restaurant|cafe|pharmacy|lodging|real_estate_agency)$/i.test(value));
  const requestedMatch = requested.some((term) => companyText.includes(term));
  return candidate.businessStatus !== "CLOSED_PERMANENTLY"
    && !(explicitlyIrrelevantType && !targetBusinessSignal)
    && (targetBusinessSignal || requestedMatch || relevantGoogleType);
}
