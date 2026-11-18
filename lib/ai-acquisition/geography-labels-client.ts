import type { GeographyScope } from "./geography";

export type GeographyDisplayLabels = Record<string, string>;

export function geographyScopeKey(country: string, scope: GeographyScope) {
  return JSON.stringify([country, scope.regionCode, scope.city]);
}

export function selectedGeographyDisplayLabel(country: string, scope: GeographyScope, labels: GeographyDisplayLabels) {
  return labels[geographyScopeKey(country, scope)] || (scope.city ? `${scope.city} · ${scope.regionCode}` : scope.regionCode);
}
