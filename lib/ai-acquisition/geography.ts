import geography from "../../data/ai-acquisition-geography.json";
import defaultAreas from "../../data/ai-acquisition-default-areas.json";
import chineseNames from "../../data/ai-acquisition-geography-zh.json";
import { ACQUISITION_COUNTRY_SEARCH_AREAS } from "./config";
import type { AcquisitionCountry } from "./config";

export type GeographyScope = { regionCode: string; city: string | null };
export type GeographyScopes = Partial<Record<AcquisitionCountry, GeographyScope[]>>;

type Region = { code: string; name: string; cities: string[] };
const registry = geography as Record<string, Region[]>;
const displayNames = chineseNames as { regions: Record<string, Record<string, string>>; cities: Record<string, Record<string, Record<string, string>>> };

function bilingualName(original: string, chinese?: string) {
  return chinese && chinese !== original ? `${chinese}（${original}）` : original;
}

export function geographyRegionDisplayName(country: string, regionCode: string, original: string) {
  return bilingualName(original, displayNames.regions[country]?.[regionCode]);
}

export function geographyCityDisplayName(country: string, regionCode: string, original: string) {
  return bilingualName(original, displayNames.cities[country]?.[regionCode]?.[original]);
}

export function acquisitionRegions(country: string) {
  return registry[country] || [];
}

export function normalizeGeographyScopes(raw: unknown, countries: readonly AcquisitionCountry[]): GeographyScopes {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("地域条件格式无效");
  const value = raw as Record<string, unknown>;
  const selected = new Set(countries);
  const normalized: GeographyScopes = {};
  let total = 0;
  for (const [country, scopes] of Object.entries(value)) {
    if (!selected.has(country as AcquisitionCountry) || !Array.isArray(scopes) || scopes.length > 8) throw new Error("地域条件必须属于所选国家，且每国最多8处");
    const regions = acquisitionRegions(country);
    const seen = new Set<string>();
    const next: GeographyScope[] = [];
    for (const item of scopes) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("省州与城市条件格式无效");
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.regionCode !== "string" || (candidate.city != null && typeof candidate.city !== "string")) throw new Error("省州与城市条件格式无效");
      const region = regions.find((entry) => entry.code === candidate.regionCode);
      const city = typeof candidate.city === "string" ? candidate.city.trim() : null;
      if (!region || (city && !region.cities.includes(city))) throw new Error("所选省州或城市与国家不匹配，请重新选择");
      const key = `${region.code}\n${city || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({ regionCode: region.code, city });
      total += 1;
      if (total > 16) throw new Error("单任务最多选择16处省州或城市，请拆分任务");
    }
    if (next.length) normalized[country as AcquisitionCountry] = next;
  }
  return normalized;
}

export function geographyScopeLabel(country: AcquisitionCountry, scope: GeographyScope) {
  const region = acquisitionRegions(country).find((entry) => entry.code === scope.regionCode);
  if (!region) return null;
  return scope.city ? `${scope.city}, ${region.name}` : region.name;
}

export function geographyScopeDisplayLabel(country: AcquisitionCountry, scope: GeographyScope) {
  const region = acquisitionRegions(country).find((entry) => entry.code === scope.regionCode);
  if (!region) return null;
  const regionName = geographyRegionDisplayName(country, region.code, region.name);
  return scope.city ? `${geographyCityDisplayName(country, region.code, scope.city)} · ${regionName}` : regionName;
}

export function planGeographyQueries(country: AcquisitionCountry, countryName: string, terms: string[], scopes: GeographyScope[] = []) {
  const areas = scopes.length
    ? scopes.map((scope) => geographyScopeLabel(country, scope)).filter((area): area is string => Boolean(area))
    : ACQUISITION_COUNTRY_SEARCH_AREAS[country] || (defaultAreas as Record<string, string[]>)[country] || [];
  const queries: string[] = [];
  // For a restricted task, never add a nationwide query: that would spend
  // budget on out-of-scope results. Unrestricted tasks retain the baseline.
  for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
    if (!scopes.length) queries.push(`${terms[termIndex]} in ${countryName}`);
    if (areas.length) queries.push(`${terms[termIndex]} in ${areas[termIndex % areas.length]}, ${countryName}`);
  }
  for (let round = 1; round < areas.length; round += 1) {
    for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
      queries.push(`${terms[termIndex]} in ${areas[(termIndex + round) % areas.length]}, ${countryName}`);
    }
  }
  return [...new Set(queries)];
}

export function placeMatchesGeography(country: AcquisitionCountry, scopes: GeographyScope[], components: Array<{longText?: string; shortText?: string; types?: string[]}> | undefined) {
  if (!scopes.length) return true;
  const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const parts = components || [];
  return scopes.some((scope) => {
    const region = acquisitionRegions(country).find((item) => item.code === scope.regionCode);
    if (!region) return false;
    const regionValues = [region.name, region.name.replace(/^State of /i, "")].map(normalized).filter(Boolean);
    if (!regionValues.length) return false;
    const regionMatches = parts.some((component) => component.types?.includes("administrative_area_level_1") && (
      [component.longText, component.shortText].some((value) => value && regionValues.includes(normalized(value)))
      || (["US", "CH", "BE", "ME"].includes(country) && component.shortText?.toUpperCase() === scope.regionCode.toUpperCase())
    ));
    if (!regionMatches) return false;
    if (!scope.city) return true;
    const cityValue = normalized(scope.city);
    if (!cityValue) return false;
    return parts.some((component) => component.types?.some((type) => ["locality", "postal_town", "administrative_area_level_2"].includes(type)) && [component.longText, component.shortText].some((value) => value && normalized(value) === cityValue));
  });
}
