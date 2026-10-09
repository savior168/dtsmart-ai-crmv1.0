import { publicChannelForUrl, type PublicChannel } from "@/lib/public-url";

function parsedExportUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || /[\s\\]/.test(raw)) return null;
  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : /^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#].*)?$/u.test(raw) ? `https://${raw}` : "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

// Legacy Google Maps URLs can point directly at maps.google.com with a CID
// query and no /maps path. Keep this compatibility rule in the export path;
// customer master data and website validation are not rewritten here.
export function exportPublicChannelForUrl(value: unknown): PublicChannel | null {
  const url = parsedExportUrl(value);
  if (!url) return null;
  const channel = publicChannelForUrl(url.href);
  if (channel) return channel;
  return url.hostname.toLowerCase() === "maps.google.com" ? "google_maps" : null;
}

export function exportOfficialWebsiteText(value: unknown) {
  const url = parsedExportUrl(value);
  return url && !exportPublicChannelForUrl(url.href) ? String(value).trim() : null;
}

/** Recover a public channel historically saved in the website field for XLSX export only. */
export function legacyWebsiteExportPatch(customer: Record<string, unknown>, rawWebsite: unknown) {
  const value = String(rawWebsite || "").trim();
  const channel = exportPublicChannelForUrl(value);
  if (!channel) return {};

  const field = ({
    google_maps: "google_url",
    facebook: "facebook_url",
    instagram: "instagram_url",
    linkedin: "linkedin_url",
    tiktok: "tiktok_url",
  } as Partial<Record<PublicChannel, string>>)[channel];
  if (field && !String(customer[field] || "").trim()) return { website: null, [field]: value };
  if (field && String(customer[field] || "").trim() === value) return { website: null };

  const existing = Array.isArray(customer.other_public_urls)
    ? customer.other_public_urls.filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
    : [];
  return {
    website: null,
    other_public_urls: existing.includes(value) ? existing : [...existing, value],
  };
}
