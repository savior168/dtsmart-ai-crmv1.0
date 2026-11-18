import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { normalizeAcquisitionCountries } from "@/lib/ai-acquisition/config";
import { acquisitionRegions, geographyCityDisplayName, geographyRegionDisplayName, geographyScopeDisplayLabel, normalizeGeographyScopes } from "@/lib/ai-acquisition/geography";
import { geographyScopeKey } from "@/lib/ai-acquisition/geography-labels-client";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("ai.acquisition.create");
    const country = request.nextUrl.searchParams.get("country") || "";
    if (normalizeAcquisitionCountries([country])[0] !== country) return NextResponse.json({ error: "目标国家无效" }, { status: 400 });
    const regionCode = request.nextUrl.searchParams.get("region");
    const regions = acquisitionRegions(country);
    if (regionCode) {
      const region = regions.find((item) => item.code === regionCode);
      if (!region) return NextResponse.json({ error: "省州不属于该国家" }, { status: 400 });
      return NextResponse.json({ region: { code: region.code, name: region.name, displayName: geographyRegionDisplayName(country, region.code, region.name) }, cities: region.cities.map((name) => ({ name, displayName: geographyCityDisplayName(country, region.code, name) })) });
    }
    return NextResponse.json({ regions: regions.map(({ code, name }) => ({ code, name, displayName: geographyRegionDisplayName(country, code, name) })), source: "GeoNames CC BY 4.0" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "地域选项加载失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录已失效" : message === "FORBIDDEN" ? "没有创建获客任务权限" : "地域选项加载失败" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission("ai.acquisition.create");
    const body = await request.json();
    const countries = normalizeAcquisitionCountries(body?.countries);
    if (countries.length > 8) return NextResponse.json({ error: "目标国家最多选择8个" }, { status: 400 });
    const scopes = normalizeGeographyScopes(body?.geography_scopes, countries);
    const labels: Record<string, string> = {};
    for (const [country, selected] of Object.entries(scopes)) {
      for (const scope of selected || []) {
        const label = geographyScopeDisplayLabel(country as keyof typeof scopes, scope);
        if (label) labels[geographyScopeKey(country, scope)] = label;
      }
    }
    return NextResponse.json({ labels }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "地域名称加载失败";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "登录已失效" : message === "FORBIDDEN" ? "没有创建获客任务权限" : "地域名称加载失败" }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
