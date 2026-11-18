import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { reserveApiCostBudget, releaseApiCostBudget } from "@/lib/api-cost-budget";
import { placeMatchesGeography, type GeographyScope } from "@/lib/ai-acquisition/geography";

export const runtime = "nodejs";

// One preview-only, read-only provider probe. The unique ledger marker is
// inserted before the request, so concurrent calls cannot exceed one request.
const MARKER_REQUEST_ID = "AI_GEO_READONLY_PROBE_20261117_CLAIM";
const QUERY = "Handyreparatur in Munich, Bavaria, Germany";
const SCOPE: GeographyScope = { regionCode: "02", city: "Munich" };
const MAX_REQUEST_COST_USD = 0.032;

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await requireAdmin();
    return new Response('<!doctype html><html lang="zh"><meta charset="utf-8"><title>一次性地域探测</title><main style="max-width:600px;margin:60px auto;font:16px sans-serif;line-height:1.7"><h1>一次性只读地域探测</h1><p>目标：德国巴伐利亚州慕尼黑 · 手机维修。点击后最多执行一次 Google Places 请求，潜在费用上限 0.032 美元；不创建客户或任务。</p><form method="post"><button type="submit" style="padding:10px 18px">执行已授权的单次探测</button></form></main></html>', { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "仅系统管理员可访问" }, { status: 403 });
  }
}

export async function POST() {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { user } = await requireAdmin();
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Google Places 未配置" }, { status: 503 });
    const reservation = await reserveApiCostBudget("GOOGLE_PLACES", MAX_REQUEST_COST_USD, { userId: user.id, operation: "只读地域获客验收" });
    if (!reservation.allowed) return NextResponse.json({ error: "现有 Google 费用上限不允许本次探测" }, { status: 429 });
    try {
      const admin = createAdminClient();
      const marker = await admin.from("api_cost_ledger").insert({
        user_id: user.id, provider: "GOOGLE_PLACES", service: "AI获客验收", operation: "一次性只读地域探测占位",
        model_or_sku: "PROBE_RESERVATION", request_id: MARKER_REQUEST_ID, quantity: 0, amount_usd: 0,
        amount_type: "FREE", metadata: { country: "DE", region_code: SCOPE.regionCode, city: SCOPE.city },
      });
      if (marker.error?.code === "23505") return NextResponse.json({ error: "本次一次性探测已执行或已被领取" }, { status: 409 });
      if (marker.error) throw marker.error;

      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id,places.addressComponents,places.displayName" },
        body: JSON.stringify({ textQuery: QUERY, pageSize: 20, languageCode: "de", regionCode: "DE" }),
        signal: AbortSignal.timeout(15_000),
      });
      const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id") || randomUUID();
      const recorded = await admin.from("api_cost_ledger").insert({
        user_id: user.id, provider: "GOOGLE_PLACES", service: "AI获客验收", operation: "只读地域探测",
        model_or_sku: "PLACES_TEXT_SEARCH_PRO", request_id: requestId, quantity: 1,
        amount_usd: MAX_REQUEST_COST_USD, amount_type: "ESTIMATED",
        pricing_snapshot: { max_per_request_usd: MAX_REQUEST_COST_USD, actual_billing_may_be_lower: true },
        metadata: { country: "DE", region_code: SCOPE.regionCode, city: SCOPE.city, http_status: response.status },
      });
      if (recorded.error) throw recorded.error;
      if (!response.ok) return NextResponse.json({ error: `Google Places 请求失败 (${response.status})，不会重试`, requestId }, { status: 502 });
      const payload = await response.json() as { places?: Array<{ id?: string; addressComponents?: Array<{ shortText?: string; longText?: string; types?: string[] }> }> };
      const places = payload.places || [];
      const inCountry = places.filter((place) => place.addressComponents?.some((part) => part.types?.includes("country") && part.shortText?.toUpperCase() === "DE"));
      const matched = inCountry.filter((place) => placeMatchesGeography("DE", [SCOPE], place.addressComponents));
      return NextResponse.json({ query: QUERY, returned: places.length, in_country: inCountry.length, in_selected_region_and_city: matched.length, out_of_scope_or_unverifiable: places.length - matched.length, estimated_max_cost_usd: MAX_REQUEST_COST_USD, requestId });
    } finally {
      await releaseApiCostBudget(reservation.reservationId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "探测失败";
    return NextResponse.json({ error: message === "FORBIDDEN" ? "仅系统管理员可执行" : message === "UNAUTHORIZED" ? "请先登录" : "探测失败，未执行自动重试" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}
