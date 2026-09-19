"use client";

import { CustomerSocialSummary } from "@/components/customer-social-summary";
import { CustomerPublicLink } from "@/components/ui/customer-public-link";

type PublicChannelCustomer = {
  google_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  linkedin_url?: string | null;
  tiktok_url?: string | null;
  other_public_urls?: string[] | null;
};

/** Third-party public channels only. The company website remains a separate first-party field. */
export function CustomerPublicChannels({ customer }: { customer: PublicChannelCustomer }) {
  const hasMap = Boolean(String(customer.google_url || "").trim());
  const hasSocial = Boolean(customer.facebook_url || customer.instagram_url || customer.linkedin_url || customer.tiktok_url || customer.other_public_urls?.length);
  if (!hasMap && !hasSocial) return <span className="text-slate-400" title="暂无公开渠道" aria-label="暂无公开渠道">—</span>;
  return <div className="flex flex-wrap items-center gap-1.5">{hasMap ? <CustomerPublicLink value={customer.google_url} kind="map" iconOnly/> : null}{hasSocial ? <CustomerSocialSummary customer={customer}/> : null}</div>;
}
