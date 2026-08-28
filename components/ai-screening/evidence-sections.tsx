"use client";

import { CheckCircle2, Copy, ExternalLink, Mail, MapPin, MessageCircle, Phone, ShieldCheck } from "lucide-react";

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
};

function ensureUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function contactLinkHref(contact: VerifiedContactDisplayItem) {
  const type = contact.type.toUpperCase();
  const value = contact.value_raw.trim();
  if (!value) return "";
  // Number-like contacts are deliberately copy-only. A user can decide which
  // local calling/messaging client to use without the browser rewriting it.
  if (["EMAIL", "PHONE", "WHATSAPP"].includes(type) && !/^https?:\/\//i.test(value)) return "";
  if (["WEBSITE", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK"].includes(type)) return ensureUrl(value);
  return /^https?:\/\//i.test(value) ? value : "";
}

function displayContactKey(contact: VerifiedContactDisplayItem) {
  const type = contact.type.toUpperCase();
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
    const type = contact.type.toUpperCase();
    groups.set(type, [...(groups.get(type) || []), contact]);
  }
  const order = ["PHONE", "EMAIL", "WHATSAPP", "WEBSITE", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK"];
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

function evidenceFact(item: EvidenceDisplayItem) {
  return String(item.normalized_fact || item.content || "").trim();
}

function evidenceMedia(item: EvidenceDisplayItem) {
  return [...new Set([...(item.media_urls || []), ...(item.metadata?.media_urls || [])])]
    .filter((url) => /^https?:\/\//i.test(url));
}

export function groupEvidenceByChannel(items: EvidenceDisplayItem[]) {
  const groups = new Map<string, { key: string; label: string; items: EvidenceDisplayItem[]; sourceUrls: string[]; mediaUrls: string[] }>();
  for (const item of items) {
    const channel = String(item.channel || "").trim();
    const label = item.source_type || channelLabels[channel] || "其他公开来源";
    const key = channel || label;
    const current = groups.get(key) || { key, label, items: [], sourceUrls: [], mediaUrls: [] };
    current.items.push(item);
    if (item.source_url && /^https?:\/\//i.test(item.source_url)) current.sourceUrls.push(item.source_url);
    current.mediaUrls.push(...evidenceMedia(item));
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    sourceUrls: [...new Set(group.sourceUrls)],
    mediaUrls: [...new Set(group.mediaUrls)].slice(0, 8),
  }));
}

export function VerifiedContactsSection({ contacts, preferredValue }: { contacts: VerifiedContactDisplayItem[]; preferredValue?: string | null }) {
  const groups = groupedContacts(contacts);
  const verifiedPreferred = contacts.find((item) => item.value_raw === preferredValue);
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-emerald-600" />AI新发现并已核实的联系方式</h3><p className="mt-1 text-sm text-slate-500">同类信息已合并去重；号码和邮箱可复制，商家与社媒链接可直接打开。</p></div>
      {verifiedPreferred ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">推荐优先：{verifiedPreferred.value_raw}</span> : null}
    </div>
    <div className="grid gap-3 p-4 lg:grid-cols-2">
      {groups.map(([type, values]) => <article key={type} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-sm">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-semibold text-slate-800"><ContactIcon type={type} />{contactLabels[type] || type}<span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{values.length}</span></p>
          <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 size={12} />已核验</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {values.map((contact) => {
            const href = contactLinkHref(contact);
            const label = channelLabels[contact.source_channel || ""] || contact.source_page_title || "已核实公开页面";
            return <div key={contact.id} title={`来源：${label}`} className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white py-1.5 pl-2.5 pr-1.5 text-slate-700 shadow-[0_1px_1px_rgba(15,23,42,0.03)] transition hover:border-blue-300 hover:bg-blue-50/50">
              {href ? <a href={href} target="_blank" rel="noreferrer" className="min-w-0 break-all font-medium text-blue-700 hover:underline">{contact.value_raw}</a> : <span className="min-w-0 break-all font-medium">{contact.value_raw}</span>}
              {href ? <ExternalLink size={12} className="shrink-0 text-blue-500" /> : null}
              <button type="button" aria-label={`复制${contactLabels[type] || "联系方式"}`} title="复制" onClick={() => void navigator.clipboard.writeText(contact.value_raw)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-blue-600"><Copy size={13} /></button>
              {contact.exact_source_url && contact.exact_source_url !== href ? <a href={contact.exact_source_url} target="_blank" rel="noreferrer" title="核对来源页面" aria-label="核对来源页面" className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-blue-600"><ExternalLink size={13} /></a> : null}
            </div>;
          })}
        </div>
      </article>)}
      {!groups.length ? <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">本次未发现经过主体核验的新联系方式</div> : null}
    </div>
  </section>;
}

export function GroupedEvidenceSection({ evidence, compact = false }: { evidence: EvidenceDisplayItem[]; compact?: boolean }) {
  const allGroups = groupEvidenceByChannel(evidence);
  const groups = compact ? allGroups.slice(0, 3) : allGroups;
  const factCount = evidence.filter((item) => evidenceFact(item)).length;
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
          <div className="p-4">
            <ol className="space-y-3">
              {(compact ? group.items.slice(0, 3) : group.items).map((item, index) => { const excerpt = compactExcerpt(item.original_excerpt); return <li key={item.id} className="grid grid-cols-[24px_1fr] gap-2 text-sm leading-6 text-slate-700"><span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-700">{index + 1}</span><div><p><span className="font-medium text-slate-500">中文提炼：</span>{evidenceFact(item)}</p>{!compact && excerpt ? <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"><span className="font-medium">来源原文：</span>{excerpt}</p> : null}</div></li>; })}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              {group.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700">核对来源{group.sourceUrls.length > 1 ? ` ${index + 1}` : ""}<ExternalLink size={12} /></a>)}
              {(compact ? group.mediaUrls.slice(0, 3) : group.mediaUrls).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700">关键原图/视频 {index + 1}<ExternalLink size={12} /></a>)}
            </div>
          </div>
        </article>;
      })}
      {!groups.length ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">当前没有可展示的有效公开依据</div> : null}
    </div>
  </section>;
}
