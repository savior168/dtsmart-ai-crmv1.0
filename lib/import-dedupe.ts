export type CustomerIdentityInput = {
  company_name?: unknown;
  contact_name?: unknown;
  phone?: unknown;
  phone_numbers?: unknown;
  whatsapp?: unknown;
  whatsapp_numbers?: unknown;
  email?: unknown;
  email_addresses?: unknown;
  website?: unknown;
  google_url?: unknown;
};

export type ExistingCustomerOwnership = {
  owner_id?: unknown;
  acquisition_scope?: unknown;
  pool_status?: unknown;
  status?: unknown;
};

export type ExistingCustomerDisposition =
  | "OWN_CUSTOMER"
  | "PUBLIC_POOL_AVAILABLE"
  | "OTHER_OWNED_CUSTOMER"
  | "UNOWNED_REVIEW_REQUIRED";

/** Classifies an already identity-matched customer without changing ownership. */
export function classifyExistingCustomer(customer: ExistingCustomerOwnership, currentUserId: string): ExistingCustomerDisposition {
  const ownerId = String(customer.owner_id ?? "").trim();
  if (ownerId && ownerId === currentUserId) return "OWN_CUSTOMER";
  if (!ownerId && String(customer.acquisition_scope ?? "") === "PUBLIC_POOL" && String(customer.pool_status ?? "") === "AVAILABLE" && String(customer.status ?? "") === "UNCLAIMED") return "PUBLIC_POOL_AVAILABLE";
  if (ownerId) return "OTHER_OWNED_CUSTOMER";
  return "UNOWNED_REVIEW_REQUIRED";
}

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
  return distinct([
    // Phone, whatsapp and email identify a customer globally. Company names
    // are deliberately excluded: spelling differences must never let a second
    // customer master record bypass a real contact match.
    ...normalizeIdentityPhones(row.phone).map((phone) => `phone:${phone}`),
    ...normalizeIdentityPhones(row.phone_numbers).map((phone) => `phone:${phone}`),
    ...normalizeIdentityPhones(row.whatsapp).map((phone) => `phone:${phone}`),
    ...normalizeIdentityPhones(row.whatsapp_numbers).map((phone) => `phone:${phone}`),
    ...normalizeIdentityEmails(row.email).map((email) => `email:${email}`),
    ...normalizeIdentityEmails(row.email_addresses).map((email) => `email:${email}`),
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

function companyNameFingerprint(value: unknown) {
  return normalizeIdentityText(value)
    .replace(/\b(?:ltd|limited|llc|inc|gmbh|sarl|sa|bv|oy|ab|kg|co)\b/gi, "")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[right.length];
}

/**
 * A weak match never blocks a customer record or merges data. It only asks the
 * operator to review likely duplicates before they deliberately continue.
 */
export function potentialCustomerDuplicateReasons(candidate: CustomerIdentityInput, existing: CustomerIdentityInput) {
  const reasons: string[] = [];
  const candidateWebsite = normalizeIdentityUrl(candidate.website);
  const existingWebsite = normalizeIdentityUrl(existing.website);
  if (candidateWebsite && candidateWebsite === existingWebsite) reasons.push("官网一致");
  const candidateGoogle = normalizeGoogleIdentity(candidate.google_url);
  const existingGoogle = normalizeGoogleIdentity(existing.google_url);
  if (candidateGoogle && candidateGoogle === existingGoogle) reasons.push("Google 地图主体一致");
  const left = companyNameFingerprint(candidate.company_name);
  const right = companyNameFingerprint(existing.company_name);
  if (left.length >= 5 && right.length >= 5) {
    const threshold = Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.15));
    if (editDistance(left, right) <= threshold) reasons.push("公司名称高度相似");
  }
  return reasons;
}

export function isPotentialCustomerDuplicate(candidate: CustomerIdentityInput, existing: CustomerIdentityInput) {
  return potentialCustomerDuplicateReasons(candidate, existing).length > 0;
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

/** Batch-import identity avoids treating a shared mailbox as a unique person. */
export function customerImportIdentityKeys(row: CustomerIdentityInput) {
  const company = normalizeIdentityText(row.company_name);
  const contact = normalizeIdentityText(row.contact_name);
  const entity = company || contact;
  return distinct([
    ...normalizeIdentityPhones(row.phone).map((phone) => `phone:${phone}`),
    ...normalizeIdentityPhones(row.whatsapp).map((phone) => `phone:${phone}`),
    ...normalizeIdentityEmails(row.email).map((email) => `email:${email}|${entity}`),
    ...normalizeIdentityEmails(row.email).filter(() => !entity).map((email) => `email:${email}`),
    ...customerFallbackIdentityKeys({ ...row, company_name: entity }),
  ]);
}

