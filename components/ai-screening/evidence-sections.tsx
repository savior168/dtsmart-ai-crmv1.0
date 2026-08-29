"use client";

import { CheckCircle2, Copy, ExternalLink, Globe2, Languages, Mail, MapPin, MessageCircle, Phone, ShieldCheck } from "lucide-react";

export type EvidenceDisplayItem = {
  id: string;
  channel?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  title?: string | null;
  content?: string | null;
  normalized_fact?: string | null;
  original_excerpt?: string | null;
  media_urls?: string[];
  metadata?: { media_urls?: string[] } | null;
  fetched_at?: string | null;
  evidence_type?: string | null;
  evidence_confidence?: number | null;
  identity_match_label?: string | null;
};

export type VerifiedContactDisplayItem = {
  id: string;
  type: string;
  value_raw: string;
  value_normalized?: string | null;
  source_channel?: string | null;
  exact_source_url?: string | null;
  source_page_title?: string | null;
  captured_at?: string | null;
  verification_status?: string | null;
};

const channelLabels: Record<string, string> = {
  website: "企业官网",
  google_maps: "谷歌地图商家页",
  linkedin: "领英企业页",
  facebook: "脸书商家页",
  instagram: "照片墙商家页",
  tiktok: "短视频商家页",
  youtube: "YouTube企业频道",
  other: "其他公开来源",
};

const contactLabels: Record<string, string> = {
  EMAIL: "邮箱",
  PHONE: "电话",
  WHATSAPP: "WhatsApp",
  WEBSITE: "企业官网",
  GOOGLE_MAPS: "谷歌地图",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  OTHER: "企业官网或公开链接",
};

export type ContactOwnerSnapshot = {
  country?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  google_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  linkedin_url?: string | null;
  tiktok_url?: string | null;
};

function ensureUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function contactLinkHref(contact: VerifiedContactDisplayItem) {
  const type = effectiveContactType(contact);
  const value = contact.value_raw.trim();
  if (!value) return "";
  // Number-like contacts are deliberately copy-only. A user can decide which
  // local calling/messaging client to use without the browser rewriting it.
  if (["EMAIL", "PHONE", "WHATSAPP"].includes(type) && !/^https?:\/\//i.test(value)) return "";
  if (["WEBSITE", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK", "YOUTUBE"].includes(type)) return ensureUrl(value);
  return /^https?:\/\//i.test(value) ? value : "";
}

function contactTypeFromUrl(value?: string | null) {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "";
  if (/google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(raw)) return "GOOGLE_MAPS";
  if (/facebook\.com|fb\.com|fb\.me/.test(raw)) return "FACEBOOK";
  if (/instagram\.com/.test(raw)) return "INSTAGRAM";
  if (/linkedin\.com/.test(raw)) return "LINKEDIN";
  if (/tiktok\.com/.test(raw)) return "TIKTOK";
  if (/youtube\.com|youtu\.be/.test(raw)) return "YOUTUBE";
  if (/^https?:\/\//.test(raw) || /(?:^|\.)[a-z0-9-]+\.[a-z]{2,}(?:\/|$)/.test(raw)) return "WEBSITE";
  return "";
}

function effectiveContactType(contact: VerifiedContactDisplayItem) {
  const stored = String(contact.type || "OTHER").toUpperCase();
  if (["PHONE", "EMAIL", "WHATSAPP", "CONTACT_FORM"].includes(stored)) return stored;
  return contactTypeFromUrl(contact.value_raw) || stored;
}

function canonicalComparable(type: string, value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (type === "EMAIL") return raw.toLowerCase();
  if (["PHONE", "WHATSAPP"].includes(type)) return raw.replace(/^00/, "+").replace(/\D/g, "");
  try {
    const parsed = new URL(ensureUrl(raw));
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}

function sameContact(type: string, left?: string | null, right?: string | null) {
  const a = canonicalComparable(type, left);
  const b = canonicalComparable(type, right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (["PHONE", "WHATSAPP"].includes(type) && a.length >= 7 && b.length >= 7) {
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    return longer.endsWith(shorter) && longer.length - shorter.length <= 3;
  }
  return false;
}

function originalValues(customer: ContactOwnerSnapshot | undefined, type: string) {
  if (!customer) return [];
  if (type === "EMAIL") return [customer.email];
  if (["PHONE", "WHATSAPP"].includes(type)) return [customer.phone, customer.whatsapp];
  if (type === "WEBSITE") return [customer.website];
  if (type === "GOOGLE_MAPS") return [customer.google_url];
  if (type === "FACEBOOK") return [customer.facebook_url];
  if (type === "INSTAGRAM") return [customer.instagram_url];
  if (type === "LINKEDIN") return [customer.linkedin_url];
  if (type === "TIKTOK") return [customer.tiktok_url];
  return [];
}

function contactMatchesOriginal(contact: VerifiedContactDisplayItem, customer?: ContactOwnerSnapshot) {
  const type = effectiveContactType(contact);
  return originalValues(customer, type).some((value) => sameContact(type, contact.value_raw, value));
}

function sourceLabelForContact(contact: VerifiedContactDisplayItem) {
  const type = effectiveContactType(contact);
  const discovery = channelLabels[String(contact.source_channel || "").toLowerCase()] || contact.source_page_title || "已核实公开页面";
  // 社媒主页属于联系方式/公开入口，而不是发现它的页面本身的经营事实。
  // 例如 Google 商家页指向 YouTube 时，应显示为“YouTube（由谷歌地图商家页发现）”。
  if (["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK", "YOUTUBE"].includes(type)) {
    const platform = contactLabels[type] || type;
    return contact.verification_status === "MATCHED_ORIGINAL"
      ? `${platform}（由${discovery}核验）`
      : `${platform}（由${discovery}发现）`;
  }
  return contact.verification_status === "MATCHED_ORIGINAL" ? discovery : `${discovery}发现`;
}

function sourceForOriginalValue(type: string, value: string, evidence: EvidenceDisplayItem[]) {
  const inferredChannel = type === "GOOGLE_MAPS" ? "google_maps" : type === "WEBSITE" ? "website" : "";
  return evidence.find((item) => {
    const channel = effectiveEvidenceChannel(item);
    return channel === inferredChannel && (!item.source_url || sameContact(type, item.source_url, value));
  });
}

export function splitVerifiedContacts(customer: ContactOwnerSnapshot | undefined, contacts: VerifiedContactDisplayItem[], evidence: EvidenceDisplayItem[] = []) {
  const normalized = contacts.map((contact) => ({ ...contact, type: effectiveContactType(contact) }));
  const originals = normalized.filter((contact) => contact.verification_status === "MATCHED_ORIGINAL" || contactMatchesOriginal(contact, customer));
  for (const [type, raw] of [["WEBSITE", customer?.website], ["GOOGLE_MAPS", customer?.google_url]] as const) {
    const value = String(raw || "").trim();
    if (!value || originals.some((item) => sameContact(type, item.value_raw, value))) continue;
    const source = sourceForOriginalValue(type, value, evidence);
    if (!source) continue;
    originals.push({ id: `original-${type}-${value}`, type, value_raw: value, value_normalized: canonicalComparable(type, value), source_channel: type === "WEBSITE" ? "website" : "google_maps", exact_source_url: source.source_url || value, source_page_title: source.title || null, verification_status: "MATCHED_ORIGINAL" });
  }
  const discovered = normalized.filter((contact) => contact.verification_status === "NEW_VERIFIED" && !contactMatchesOriginal(contact, customer));
  return { original: originals, discovered };
}

function displayContactKey(contact: VerifiedContactDisplayItem) {
  const type = effectiveContactType(contact);
  const raw = contact.value_raw.trim();
  const stored = String(contact.value_normalized || "").trim().toLowerCase();
  if (stored) return `${type}|${stored}`;
  if (type === "EMAIL") return `${type}|${raw.toLowerCase()}`;
  if (["PHONE", "WHATSAPP"].includes(type)) return `${type}|${raw.replace(/\D/g, "")}`;
  try {
    const parsed = new URL(ensureUrl(raw));
    parsed.hash = "";
    return `${type}|${parsed.toString().replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return `${type}|${raw.toLowerCase()}`;
  }
}

function groupedContacts(contacts: VerifiedContactDisplayItem[]) {
  const deduped = new Map<string, VerifiedContactDisplayItem>();
  for (const contact of contacts) {
    const raw = contact.value_raw.trim();
    if (!raw) continue;
    if (["PHONE", "WHATSAPP"].includes(contact.type.toUpperCase())
      && (/^(?:\d{1,2}[./-]){2}(?:19|20)\d{2}$/.test(raw) || /^(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}$/.test(raw))) continue;
    if (!deduped.has(displayContactKey(contact))) deduped.set(displayContactKey(contact), contact);
  }
  const groups = new Map<string, VerifiedContactDisplayItem[]>();
  for (const contact of deduped.values()) {
    const type = effectiveContactType(contact);
    groups.set(type, [...(groups.get(type) || []), contact]);
  }
  const order = ["PHONE", "EMAIL", "WHATSAPP", "WEBSITE", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK", "YOUTUBE", "OTHER"];
  return [...groups.entries()].sort(([left], [right]) => {
    const a = order.indexOf(left); const b = order.indexOf(right);
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  });
}

function ContactIcon({ type }: { type: string }) {
  const normalized = type.toUpperCase();
  if (normalized === "EMAIL") return <Mail size={16} />;
  if (normalized === "PHONE") return <Phone size={16} />;
  if (normalized === "GOOGLE_MAPS") return <MapPin size={16} />;
  return <MessageCircle size={16} />;
}

function compactExcerpt(value?: string | null) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 320);
}

function translateTextUrl(value: string) {
  return `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(value)}&op=translate`;
}

function evidenceFact(item: EvidenceDisplayItem) {
  return String(item.normalized_fact || item.content || "").trim();
}

function evidenceMedia(item: EvidenceDisplayItem) {
  return [...new Set([...(item.media_urls || []), ...(item.metadata?.media_urls || [])])]
    .filter((url) => /^https?:\/\//i.test(url));
}

function normalizedSourceUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(ensureUrl(raw));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}

function normalizedDisplayText(value?: string | null) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

type EvidenceSourceGroup = {
  key: string;
  sourceUrl: string;
  title: string;
  items: EvidenceDisplayItem[];
  excerpts: string[];
  mediaUrls: string[];
};

function effectiveEvidenceChannel(item: EvidenceDisplayItem) {
  return contactTypeFromUrl(item.source_url).toLowerCase() || String(item.channel || "other").trim().toLowerCase();
}

function conciseEvidenceFact(item: EvidenceDisplayItem) {
  return evidenceFact(item)
    .replace(/^(?:企业官网|Google商家|谷歌地图商家页|领英企业页|脸书商家页|照片墙商家页|短视频商家页)(?:公开)?(?:业务文字|公开说明或评论|经营信息)?明确(?:显示|列出)[：:]\s*/u, "")
    .replace(/^中文提炼[：:]\s*/u, "")
    .replace(/[。；;]+$/u, "")
    .trim();
}

export function groupEvidenceByChannel(items: EvidenceDisplayItem[]) {
  const groups = new Map<string, { key: string; label: string; items: EvidenceDisplayItem[]; sources: Map<string, EvidenceSourceGroup> }>();
  for (const item of items) {
    const channel = effectiveEvidenceChannel(item);
    const label = channelLabels[channel] || item.source_type || "其他公开来源";
    const key = channel || label;
    const current = groups.get(key) || { key, label, items: [], sources: new Map<string, EvidenceSourceGroup>() };
    const sourceUrl = item.source_url && /^https?:\/\//i.test(item.source_url) ? item.source_url : "";
    const sourceKey = normalizedSourceUrl(sourceUrl) || `${key}|no-source`;
    const source = current.sources.get(sourceKey) || {
      key: sourceKey,
      sourceUrl,
      title: String(item.title || item.source_type || label).trim(),
      items: [],
      excerpts: [],
      mediaUrls: [],
    };
    const factKey = normalizedDisplayText(conciseEvidenceFact(item));
    if (factKey && !source.items.some((currentItem) => normalizedDisplayText(conciseEvidenceFact(currentItem)) === factKey)) {
      source.items.push(item);
      current.items.push(item);
    }
    const excerpt = compactExcerpt(item.original_excerpt);
    if (excerpt && !source.excerpts.some((currentExcerpt) => normalizedDisplayText(currentExcerpt) === normalizedDisplayText(excerpt))) {
      source.excerpts.push(excerpt);
    }
    source.mediaUrls.push(...evidenceMedia(item));
    current.sources.set(sourceKey, source);
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items,
    sources: [...group.sources.values()].map((source) => ({
      ...source,
      excerpts: source.excerpts.slice(0, 2),
      mediaUrls: [...new Set(source.mediaUrls)].slice(0, 8),
    })),
  }));
}

function ContactGroupList({ contacts, emptyText }: { contacts: VerifiedContactDisplayItem[]; emptyText: string }) {
  const groups = groupedContacts(contacts);
  return <div className="grid gap-2.5 lg:grid-cols-2">
    {groups.map(([type, values]) => <article key={type} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2"><p className="flex items-center gap-2 font-semibold text-slate-800"><ContactIcon type={type}/>{contactLabels[type] || type}<span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{values.length}</span></p><span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 size={12}/>已核验</span></div>
      <div className="flex flex-wrap gap-1.5">{values.map((contact) => {
        const href = contactLinkHref(contact); const label = sourceLabelForContact(contact);
        return <div key={contact.id} title={`来源：${label}`} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white py-1 pl-2 pr-1 text-slate-700">
          {href ? <a href={href} target="_blank" rel="noreferrer" className="min-w-0 break-all font-medium text-blue-700 hover:underline">{contact.value_raw}</a> : <span className="min-w-0 break-all font-medium">{contact.value_raw}</span>}
          <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">{label}</span>
          {href ? <ExternalLink size={11} className="shrink-0 text-blue-500"/> : null}
          <button type="button" aria-label={`复制${contactLabels[type] || "联系方式"}`} title="复制" onClick={() => void navigator.clipboard.writeText(contact.value_raw)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Copy size={12}/></button>
          {contact.exact_source_url && normalizedSourceUrl(contact.exact_source_url) !== normalizedSourceUrl(href) ? <a href={contact.exact_source_url} target="_blank" rel="noreferrer" title="核对发现来源" className="shrink-0 rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Globe2 size={12}/></a> : null}
        </div>;
      })}</div>
    </article>)}
    {!groups.length ? <div className="col-span-full rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">{emptyText}</div> : null}
  </div>;
}

export function VerifiedContactsSection({ contacts, customer, evidence = [], preferredValue }: { contacts: VerifiedContactDisplayItem[]; customer?: ContactOwnerSnapshot; evidence?: EvidenceDisplayItem[]; preferredValue?: string | null }) {
  const classified = splitVerifiedContacts(customer, contacts, evidence);
  const verifiedPreferred = contacts.find((item) => item.value_raw === preferredValue);
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-emerald-600" />AI已核验的联系方式</h3><p className="mt-1 text-sm text-slate-500">原始联系方式会标注核验来源；仅将不同的新联系方式写回扩展字段，号码统一按国际格式去重。</p></div>
      {verifiedPreferred ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">推荐优先：{verifiedPreferred.value_raw}</span> : null}
    </div>
    <div className="space-y-4 p-4">
      <div><h4 className="mb-2 text-sm font-semibold text-slate-800">1. 已核验的原有资料</h4><ContactGroupList contacts={classified.original} emptyText="本次分析尚未核验到原有联系方式"/></div>
      <div className="border-t border-slate-100 pt-4"><h4 className="mb-2 text-sm font-semibold text-slate-800">2. AI新发现并已核验</h4><ContactGroupList contacts={classified.discovered} emptyText="本次未发现与原始资料不同的新联系方式或社媒链接"/></div>
    </div>
  </section>;
}

export function GroupedEvidenceSection({ evidence, compact = false }: { evidence: EvidenceDisplayItem[]; compact?: boolean }) {
  const allGroups = groupEvidenceByChannel(evidence);
  const groups = compact ? allGroups.slice(0, 3) : allGroups;
  const factCount = allGroups.reduce((sum, group) => sum + group.items.length, 0);
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div><h3 className="font-semibold">可核验的中文分析依据</h3><p className="mt-1 text-sm text-slate-500">同一渠道的事实已合并；关键原文与中文提炼对照展示，来源页面可直接核验。</p></div>
      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{allGroups.length} 个来源 · {factCount} 条事实</span>
    </div>
    <div className="space-y-3 p-5">
      {groups.map((group) => {
        const confidence = Math.max(...group.items.map((item) => Number(item.evidence_confidence || 0)), 0);
        const evidenceTypes = [...new Set(group.items.map((item) => item.evidence_type || "中性"))];
        return <article key={group.key} className="overflow-hidden rounded-xl border border-slate-200">
          <header className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3"><div><b className="text-sm text-slate-900">{group.label}</b><span className="ml-2 text-xs text-slate-500">主体核验：{group.items[0]?.identity_match_label || "主体一致"}</span></div><span className="rounded bg-white px-2 py-1 text-xs text-slate-600">{evidenceTypes.join(" / ")} · 最高可信度 {confidence}%</span></header>
          <div className="space-y-3 p-4">
            {group.sources.map((source, sourceIndex) => {
              const sourceItems = compact ? source.items.slice(0, 3) : source.items;
              const sourceMedia = compact ? source.mediaUrls.slice(0, 3) : source.mediaUrls;
              return <section key={source.key} className="rounded-lg border border-slate-100 bg-slate-50/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-slate-600">{group.sources.length > 1 ? `来源 ${sourceIndex + 1}：` : "来源："}{source.title}</b>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">打开来源核验<ExternalLink size={12} /></a> : null}</div>
                <ol className="space-y-2.5">
                  {sourceItems.map((item) => <li key={item.id} className="flex gap-2 text-sm leading-6 text-slate-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"/><p>{conciseEvidenceFact(item)}</p></li>)}
                </ol>
                {!compact && source.excerpts.length ? <details className="group mt-3 rounded-md border border-slate-200 bg-white text-xs text-slate-600">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"><span>查看原文与中文对照</span><span className="text-slate-400 transition group-open:rotate-180">⌄</span></summary>
                  <div className="border-t border-slate-100 p-3">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-md bg-blue-50/70 p-3"><b className="text-blue-800">中文提炼</b><ul className="mt-2 space-y-1.5 leading-5">{sourceItems.map((item) => <li key={`${item.id}-translation`}>• {conciseEvidenceFact(item)}</li>)}</ul></div>
                      <div className="rounded-md bg-slate-50 p-3"><b className="text-slate-700">来源原文</b><p className="mt-2 break-words leading-5">{source.excerpts.join(" … ")}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" title="打开原始证据页面" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-blue-700 hover:border-blue-300"><Globe2 size={12}/>打开原始页面</a> : null}
                      <a href={translateTextUrl(source.excerpts.join(" … "))} target="_blank" rel="noreferrer" title="将此段原文翻译为中文" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-blue-700 hover:border-blue-300"><Languages size={12}/>翻译中文</a>
                    </div>
                  </div>
                </details> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {sourceMedia.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700">关键原图/视频 {index + 1}<ExternalLink size={12} /></a>)}
                </div>
              </section>;
            })}
          </div>
        </article>;
      })}
      {!groups.length ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">当前没有可展示的有效公开依据</div> : null}
    </div>
  </section>;
}
