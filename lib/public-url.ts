export type PublicChannel = "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube" | "x" | "whatsapp" | "google_maps";

function parsedHttpUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function publicChannelForUrl(value: unknown): PublicChannel | null {
  const parsed = parsedHttpUrl(value);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host.endsWith(".fb.com")) return "facebook";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (["youtube.com", "youtu.be"].includes(host) || host.endsWith(".youtube.com")) return "youtube";
  if (["x.com", "twitter.com"].includes(host) || host.endsWith(".x.com") || host.endsWith(".twitter.com")) return "x";
  if (["wa.me", "whatsapp.com"].includes(host) || host.endsWith(".whatsapp.com")) return "whatsapp";
  if ((host === "google.com" || host.endsWith(".google.com") || host === "goo.gl" || host.endsWith(".goo.gl"))
      && /(?:\/maps(?:\/|$)|maps\.app\.goo\.gl)/i.test(parsed.href)) return "google_maps";
  return null;
}

/** Return only a real company-controlled website, never a social/profile URL. */
export function officialWebsiteUrl(value: unknown) {
  const parsed = parsedHttpUrl(value);
  if (!parsed || publicChannelForUrl(parsed.href)) return null;
  return String(value).trim();
}

export function assertOfficialWebsiteUrl(value: unknown, label = "官网网址") {
  const text = String(value || "").trim();
  if (!text) return;
  if (!officialWebsiteUrl(text)) throw new Error(`${label}不能填写社媒主页或地图链接，请填写企业独立官网；社媒请放入对应公开渠道字段`);
}
