export type CustomerIdentityInput = {
  company_name?: unknown;
  phone?: unknown;
  email?: unknown;
  website?: unknown;
  google_url?: unknown;
};

export function normalizeIdentityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeIdentityPhone(value: unknown) {
  return normalizeIdentityText(value).replace(/[^0-9]/g, "").replace(/^00/, "");
}

function distinct(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeIdentityPhones(value: unknown) {
  const raw = normalizeIdentityText(value);
  if (!raw) return [];
  return distinct(raw.split(/[,，;；|\n]+/).map(normalizeIdentityPhone));
}

export function normalizeIdentityEmails(value: unknown) {
  const raw = normalizeIdentityText(value);
  if (!raw) return [];
  const matched = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  return distinct((matched?.length ? matched : raw.split(/[,，;；|\s]+/)).map(normalizeIdentityText));
}

export function normalizeIdentityUrl(value: unknown) {
  const raw = normalizeIdentityText(value);
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = decodeURIComponent(parsed.pathname)
      .replace(/\/{2,}/g, "/")
      .replace(/\/(?:index\.(?:html?|php))$/i, "")
      .replace(/\/$/, "")
      .toLowerCase();
    if (!path) path = "/";
    const mapsQuery = /google\.[^/]+$/.test(host) && path.startsWith("/maps")
      ? normalizeIdentityText(parsed.searchParams.get("query"))
      : "";
    return `${host}${path}${mapsQuery ? `?query=${mapsQuery}` : ""}`;
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[?#]/)[0]
      .replace(/\/$/, "")
      .toLowerCase();
  }
}

export function normalizeGoogleIdentity(value: unknown) {
  const raw = normalizeIdentityText(value);
  if (!raw) return "";
  const decoded = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
  const hexPlace = decoded.match(/(?:!1s|\/place\/)(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
  if (hexPlace) return `place:${hexPlace.toLowerCase()}`;
  const semanticPlace = decoded.match(/(?:!16s|\/)(\/g\/[a-z0-9_-]+)/i)?.[1];
  if (semanticPlace) return `place:${semanticPlace.toLowerCase()}`;
  const placeId = decoded.match(/(?:place_id:|place_id=)([a-z0-9_-]+)/i)?.[1];
  if (placeId) return `place:${placeId.toLowerCase()}`;
  return normalizeIdentityUrl(raw);
}

export function customerPrimaryIdentityKeys(row: CustomerIdentityInput) {
  const name = normalizeIdentityText(row.company_name);
  if (!name) return [];
  return distinct([
    ...normalizeIdentityPhones(row.phone).map((phone) => `phone:${name}|${phone}`),
    ...normalizeIdentityEmails(row.email).map((email) => `email:${name}|${email}`),
  ]);
}

export function customerFallbackIdentityKeys(row: CustomerIdentityInput) {
  const name = normalizeIdentityText(row.company_name);
  if (!name) return [];
  const website = normalizeIdentityUrl(row.website);
  const google = normalizeGoogleIdentity(row.google_url);
  return distinct([
    website ? `website:${name}|${website}` : "",
    google ? `google:${name}|${google}` : "",
  ]);
}

/**
 * Lookup is deliberately conservative: phone/email win when supplied. URL
 * identity is only a fallback for rows without either strong contact key, so
 * two branches sharing a corporate website are not automatically merged.
 */
export function customerLookupIdentityKeys(row: CustomerIdentityInput) {
  const primary = customerPrimaryIdentityKeys(row);
  return primary.length ? primary : customerFallbackIdentityKeys(row);
}

/** Index every usable key so a later sparse row can match an earlier rich row. */
export function customerIndexIdentityKeys(row: CustomerIdentityInput) {
  return distinct([...customerPrimaryIdentityKeys(row), ...customerFallbackIdentityKeys(row)]);
}

/** Backwards-compatible alias used by import preview and conflict snapshots. */
export function customerIdentityKeys(row: CustomerIdentityInput) {
  return customerLookupIdentityKeys(row);
}
