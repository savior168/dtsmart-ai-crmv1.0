"use client";

import { Globe2 } from "lucide-react";

type SocialKind = "facebook" | "instagram" | "linkedin" | "tiktok" | "other";
type SocialCustomer = {
  facebook_url?: string | null;
  instagram_url?: string | null;
  linkedin_url?: string | null;
  tiktok_url?: string | null;
  other_public_urls?: string[] | null;
};

function PlatformIcon({ kind }: { kind: SocialKind }) {
  if (kind === "facebook") return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#fff" d="M13.5 20v-7h2.35l.35-2.73H13.5V8.53c0-.8.22-1.34 1.37-1.34h1.46V4.76c-.25-.03-1.12-.11-2.12-.11-2.1 0-3.54 1.28-3.54 3.65v1.97H8.3V13h2.37v7h2.83Z"/></svg>;
  if (kind === "instagram") return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4"><defs><linearGradient id="instagram-gradient" x1="0" x2="1" y1="1" y2="0"><stop stopColor="#FEDA75"/><stop offset=".5" stopColor="#D62976"/><stop offset="1" stopColor="#4F5BD5"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="url(#instagram-gradient)"/><rect x="6.3" y="6.3" width="11.4" height="11.4" rx="3.3" fill="none" stroke="#fff" strokeWidth="1.7"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="#fff" strokeWidth="1.7"/><circle cx="16.9" cy="7.2" r="1" fill="#fff"/></svg>;
  if (kind === "linkedin") return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4"><rect width="24" height="24" rx="4" fill="#0A66C2"/><path fill="#fff" d="M6.3 9.1h2.6V18H6.3V9.1Zm1.3-4.2a1.52 1.52 0 1 1 0 3.04 1.52 1.52 0 0 1 0-3.04ZM10.5 9.1H13v1.21h.04c.35-.66 1.2-1.36 2.47-1.36 2.64 0 3.13 1.74 3.13 4V18h-2.6v-4.48c0-1.07-.02-2.44-1.49-2.44-1.49 0-1.72 1.16-1.72 2.36V18h-2.6V9.1Z"/></svg>;
  if (kind === "tiktok") return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4"><rect width="24" height="24" rx="5" fill="#111827"/><path fill="#fff" d="M14.5 5c.35 1.87 1.47 3.05 3.2 3.31v2.3a6.45 6.45 0 0 1-3.19-1.06v4.87a4.4 4.4 0 1 1-3.78-4.35v2.36a2.1 2.1 0 1 0 1.47 2V5h2.3Z"/></svg>;
  return <Globe2 size={14} strokeWidth={2.2}/>;
}

/** Compact, shared social-link presentation for all customer lists and details. */
export function CustomerSocialSummary({ customer }: { customer: SocialCustomer }) {
  const links: Array<[SocialKind, string, string | null | undefined]> = [
    ["facebook", "Facebook", customer.facebook_url], ["instagram", "Instagram", customer.instagram_url], ["linkedin", "LinkedIn", customer.linkedin_url], ["tiktok", "TikTok", customer.tiktok_url],
    ...(customer.other_public_urls || []).map((url) => ["other", "公开链接", url] as [SocialKind, string, string]),
  ];
  const visible = links.filter(([, , url]) => Boolean(String(url || "").trim()));
  if (!visible.length) return null;
  return <div className="flex flex-wrap gap-1.5">{visible.map(([kind, label, raw], index) => {
    const text = String(raw).trim();
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    return <a key={`${kind}:${text}:${index}`} href={url} target="_blank" rel="noreferrer" title={`打开${label}`} aria-label={`打开${label}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"><PlatformIcon kind={kind}/></a>;
  })}</div>;
}
