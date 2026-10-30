"use client";

import { Check, ChevronDown, Copy, Mail, Phone, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { normalizePhoneInternational, formatPhoneInternational } from "@/lib/contacts/phone-normalization";
import { splitStoredContactValues } from "@/lib/contacts/stored-values";
import { manualContactValues } from "@/lib/contacts/manual-contact-list";
import { ContactChannelIcon } from "@/components/contact-channel-icon";

type VerifiedContact = { type?: string | null; value_raw?: string | null; source_channel?: string | null; exact_source_url?: string | null; verification_status?: string | null; captured_at?: string | null };
type ContactCustomer = { source?: string | null; country?: string | null; phone?: string | null; phone_numbers?: string[] | null; whatsapp?: string | null; whatsapp_numbers?: string[] | null; wechat?: string | null; wechat_numbers?: string[] | null; email?: string | null; email_addresses?: string[] | null; website?: string | null; google_url?: string | null; website_phone?: string | null; website_email?: string | null; verified_contacts?: VerifiedContact[] | null };
type ContactKind = "PHONE" | "EMAIL" | "WHATSAPP" | "WECHAT";
type DisplayContact = { label: string; value: string; type: ContactKind; icon: ReactNode; source: "original" | "verified" | "conflict"; channelLabel?: string | null; verifiedBy?: string | null; sourceUrl?: string | null; capturedAt?: string | null };

function contactKey(type: ContactKind, value: string, country?: string | null) {
  if (type === "EMAIL" || type === "WECHAT") return `${type}:${value.trim().toLowerCase()}`;
  return `${type}:${normalizePhoneInternational(value, country).replace(/\D/g, "") || value.replace(/\D/g, "")}`;
}
function WhatsAppIcon() {
  return <span aria-label="WhatsApp" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#25D366] text-white"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-none" stroke="currentColor" strokeWidth="2.2"><path d="M20 11.7a8 8 0 0 1-11.8 7L4 20l1.3-4.1A8 8 0 1 1 20 11.7Z"/><path d="M9.2 8.2c.2-.5.4-.5.7-.5h.4c.2 0 .4.1.5.4l.6 1.5c.1.3.1.5-.1.7l-.5.6c.5 1 1.2 1.7 2.2 2.2l.6-.5c.2-.2.4-.2.7-.1l1.5.6c.3.1.4.3.4.5v.4c0 .3 0 .5-.5.7-.5.2-1.2.3-2.1 0-1-.4-2.2-1.3-3.2-2.3-1-1-1.8-2.2-2.3-3.2-.3-.9-.2-1.6 0-2.1Z"/></svg></span>;
}
function iconFor(type: ContactKind) { return type === "EMAIL" ? <Mail size={14}/> : type === "WHATSAPP" ? <WhatsAppIcon/> : <Phone size={14}/>; }
function contactSourceLabel(channel: string) {
  return ({ website: "官网", google_maps: "Google Maps", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok" } as Record<string, string>)[channel] || "其他公开来源";
}
function originalSourceLabel(source?: string | null) {
  const normalized = String(source || "").toUpperCase();
  if (["EXCEL_IMPORT", "BATCH_IMPORT", "CSV", "IMPORT"].includes(normalized)) return "Excel导入";
  if (["MANUAL_CREATE", "ADMIN_MANUAL", "PRIVATE_CREATE"].includes(normalized)) return "手工录入";
  if (["AI_ACQUISITION", "GOOGLE_MAPS", "FACEBOOK", "INSTAGRAM", "LINKEDIN"].includes(normalized)) return "AI获客采集";
  return "原始资料";
}
function ConflictMarker() {
  const label = "来源存在冲突，待人工核对";
  return <span role="img" aria-label={label} title={label} tabIndex={0} className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-200"><TriangleAlert size={11}/></span>;
}
function sourceGroup(item: DisplayContact, customerSource?: string | null) {
  const verifiedChannel = item.verifiedBy || item.channelLabel || "";
  if (item.source === "conflict") return { key: "conflict", label: "待核对联系方式", hint: "来源存在冲突，请复核后使用", badge: "待复核", rank: 5 };
  if (verifiedChannel === "官网") return { key: "website", label: "企业官网", hint: "企业自有网站公开的第一方联系方式", badge: "优先", rank: 0 };
  if (verifiedChannel === "Google Maps") return { key: "google", label: "Google Maps", hint: "已匹配商家资料中的联系方式", badge: "可信", rank: 1 };
  if (["Facebook", "Instagram", "LinkedIn", "TikTok"].includes(verifiedChannel)) return { key: "social", label: "官方社媒", hint: "已匹配企业社媒主页中的联系方式", badge: "辅助", rank: 2 };
  if (item.source === "original") return { key: "original", label: originalSourceLabel(customerSource), hint: "客户进入系统时保存的联系方式", badge: "原始", rank: 3 };
  return { key: "public", label: item.channelLabel || "其他公开来源", hint: "其他已核验公开页面中的联系方式", badge: "补充", rank: 4 };
}

/** One presentation rule for original and AI-collected contacts in every customer view. */
export function CustomerContactSummary({ customer, source, display = "all", expandedByDefault = false }: { customer: ContactCustomer; source: "original" | "ai" | "all"; display?: "all" | "phone" | "email"; expandedByDefault?: boolean }) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [copiedKey, setCopiedKey] = useState("");
  const collapseThreshold = 1;
  const originals: DisplayContact[] = [
    ...manualContactValues(customer.phone, customer.phone_numbers).map((value) => ({ label: "电话", value, type: "PHONE" as const, icon: <Phone size={14} className="text-blue-600"/>, source: "original" as const })),
    ...manualContactValues(customer.whatsapp, customer.whatsapp_numbers).map((value) => ({ label: "WhatsApp", value, type: "WHATSAPP" as const, icon: iconFor("WHATSAPP"), source: "original" as const })),
    ...manualContactValues(customer.wechat, customer.wechat_numbers).map((value) => ({ label: "微信", value, type: "WECHAT" as const, icon: <ContactChannelIcon kind="wechat" size={14}/>, source: "original" as const })),
    ...manualContactValues(customer.email, customer.email_addresses).map((value) => ({ label: "邮箱", value, type: "EMAIL" as const, icon: iconFor("EMAIL"), source: "original" as const })),
  ];
  const originalKeys = new Set(originals.filter((item) => item.value !== "未提供").map((item) => contactKey(item.type, item.value, customer.country)));
  const collected: DisplayContact[] = (customer.verified_contacts || [])
    .filter((item) => ["NEW_VERIFIED", "SOURCE_CONFIRMED", "MATCHED_ORIGINAL", "CONFLICTING_VERIFIED"].includes(String(item.verification_status || "")) && ["PHONE", "EMAIL", "WHATSAPP"].includes(String(item.type || "").toUpperCase()) && String(item.value_raw || "").trim())
    .map((item) => {
      const type = String(item.type).toUpperCase() as ContactKind;
      const channel = String(item.source_channel || "").toLowerCase();
      // A verification link must be the exact page where this value was
      // collected. Never substitute the website or Maps home page here.
      const sourceUrl = String(item.exact_source_url || "").trim() || null;
      const channelLabel = contactSourceLabel(channel);
      return { label: `${channelLabel}核验${type === "EMAIL" ? "邮箱" : type === "WHATSAPP" ? "WhatsApp" : "电话"}`, value: String(item.value_raw).trim(), type, icon: iconFor(type), source: item.verification_status === "CONFLICTING_VERIFIED" ? "conflict" : "verified", channelLabel, sourceUrl, capturedAt:item.captured_at };
    });
  for (const [label, storedValue, type] of [["官网核验电话", customer.website_phone, "PHONE"], ["官网核验邮箱", customer.website_email, "EMAIL"]] as const) {
    for (const value of splitStoredContactValues(storedValue, type, customer.country)) {
      if (collected.some((item) => contactKey(item.type, item.value, customer.country) === contactKey(type, value, customer.country))) continue;
      collected.push({ label, value, type, icon: iconFor(type), source: "verified", channelLabel: "官网", sourceUrl: null });
    }
  }
  const originalContacts = originals.filter((item) => item.value !== "未提供").map((item) => {
    const verifiedMatch = collected.find((candidate) => contactKey(candidate.type, candidate.value, customer.country) === contactKey(item.type, item.value, customer.country));
    return verifiedMatch ? { ...item, verifiedBy: verifiedMatch.channelLabel || "公开来源", sourceUrl: verifiedMatch.sourceUrl, capturedAt: verifiedMatch.capturedAt } : item;
  });
  const uniqueCollected = collected.filter((item, index, all) => all.findIndex((candidate) => contactKey(candidate.type, candidate.value, customer.country) === contactKey(item.type, item.value, customer.country)) === index);
  const verifiedContacts = uniqueCollected.filter((item) => !originalKeys.has(contactKey(item.type, item.value, customer.country)));
  const allContacts = source === "original" ? originalContacts : source === "ai" ? uniqueCollected : [...originalContacts, ...verifiedContacts];
  const contacts = display === "phone" ? allContacts.filter((item) => item.type !== "EMAIL") : display === "email" ? allContacts.filter((item) => item.type === "EMAIL") : allContacts;
  if (!contacts.length) {
    const emptyLabel = display === "phone" ? "暂无已核验电话" : display === "email" ? "暂无已核验邮箱" : "暂无可联系信息";
    return <span className="text-slate-400" title={emptyLabel} aria-label={emptyLabel}>—</span>;
  }
  const copyContact = (value: string, key: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => current === key ? "" : current), 1400);
    }).catch(() => undefined);
  };
  const renderContact = (item: DisplayContact, index: number) => {
    const muted = false;
    const key = `${item.label}:${item.value}:${index}`;
    const sourceTooltip = item.source === "conflict"
      ? "来源存在冲突，待人工核对"
      : item.source === "original"
        ? `数据来源：${originalSourceLabel(customer.source)}${item.verifiedBy ? `\nAI核验来源：${item.verifiedBy}` : ""}`
        : `AI采集来源：${item.channelLabel || "其他公开来源"}`;
    const display = muted || item.type === "EMAIL" || item.type === "WECHAT" ? item.value : formatPhoneInternational(item.value, customer.country);
    const whatsappDigits = item.type === "WHATSAPP" && !muted ? normalizePhoneInternational(item.value, customer.country).replace(/\D/g, "") : "";
    const sourceHref = item.source !== "original" ? item.sourceUrl : null;
    // A verified WhatsApp number has two different useful destinations: the
    // conversation itself and the exact page that proves the number belongs to
    // this company. Keep both available without making the source link replace
    // the conversation action.
    const canStartWhatsApp = Boolean(whatsappDigits) && item.source !== "conflict";
    const valueClass = item.type === "EMAIL" ? "break-all whitespace-normal" : "whitespace-nowrap";
    const text = canStartWhatsApp
      ? <span className="flex min-w-0 flex-1 items-start gap-1.5"><a href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noreferrer" title="打开 WhatsApp 对话" className="min-w-0 whitespace-nowrap leading-5 text-[#128C7E] hover:underline">{display}</a>{sourceHref ? <a href={sourceHref} target="_blank" rel="noreferrer" title={`打开来源核验：${item.label}`} className="shrink-0 text-[11px] leading-5 text-blue-700 hover:underline">核验</a> : null}</span>
      : sourceHref
        ? <a href={sourceHref} target="_blank" rel="noreferrer" title={`打开来源核验：${item.label}`} className={`min-w-0 flex-1 leading-5 text-blue-700 hover:underline ${valueClass}`}>{display}</a>
        : <span className={`min-w-0 flex-1 leading-5 ${valueClass}`}>{display}{item.source !== "original" ? <small className="ml-1 text-[10px] text-amber-700">来源页未留存</small> : null}</span>;
    return <div key={key} title={`${item.label}：${item.value}\n${sourceTooltip}${item.capturedAt?`\n采集时间：${new Date(item.capturedAt).toLocaleString("zh-CN",{hour12:false})}`:""}${item.sourceUrl ? `\n点击打开来源核验` : ""}`} className="rounded bg-slate-50/80 px-1.5 py-1"><span className="flex min-w-0 items-start gap-1 text-xs text-slate-700"><span className="mt-0.5 shrink-0">{item.icon}</span>{text}<small className="shrink-0 rounded bg-white px-1 text-[10px] text-slate-500">{item.source === "original" ? "原始" : sourceGroup(item, customer.source).label}</small><button type="button" onClick={() => copyContact(item.value, key)} aria-label={`复制${item.label}`} title={copiedKey === key ? "已复制" : `复制${item.label}`} className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-blue-600">{copiedKey === key ? <Check size={12} className="text-emerald-600"/> : <Copy size={12}/>}</button>{item.source === "conflict" ? <ConflictMarker/> : null}</span></div>;
  };
  const kindRank:Record<ContactKind,number> = { PHONE:0, WHATSAPP:1, WECHAT:2, EMAIL:3 };
  const orderedContacts = [...contacts].sort((a,b) => {
    const channelDifference = kindRank[a.type] - kindRank[b.type];
    if (channelDifference) return channelDifference;
    const sourceDifference = sourceGroup(a, customer.source).rank - sourceGroup(b, customer.source).rank;
    return sourceDifference;
  });
  const renderGroups = (items = orderedContacts) => {
    const groups = new Map<ContactKind, DisplayContact[]>();
    for (const item of items) {
      groups.set(item.type, [...(groups.get(item.type) || []), item]);
    }
    const labels:Record<ContactKind,string> = { PHONE:"电话", WHATSAPP:"WhatsApp", WECHAT:"微信", EMAIL:"邮箱" };
    return <div className="space-y-2">{[...groups.entries()].sort((a,b)=>kindRank[a[0]]-kindRank[b[0]]).map(([kind, entries]) => <section key={kind}><span className="flex items-center gap-1.5"><ContactChannelIcon kind={kind.toLowerCase() as Lowercase<ContactKind>} size={13}/><b className="text-[11px] font-medium text-slate-700">{labels[kind]}（{entries.length}）</b></span><div className="mt-0.5 space-y-0.5">{entries.map((item,index)=>renderContact(item,index))}</div></section>)}</div>;
  };
  const renderPreviewContact = (item: DisplayContact, index: number) => {
    const formattedValue = item.type === "EMAIL" || item.type === "WECHAT" ? item.value : formatPhoneInternational(item.value, customer.country);
    const isNumber = item.type === "PHONE" || item.type === "WHATSAPP";
    const source = sourceGroup(item, customer.source);
    const key = `preview:${item.type}:${item.value}:${index}`;
    const whatsappDigits = item.type === "WHATSAPP" ? normalizePhoneInternational(item.value, customer.country).replace(/\D/g, "") : "";
    const canStartWhatsApp = Boolean(whatsappDigits) && item.source !== "conflict";
    const valueClass = isNumber ? "whitespace-nowrap" : "min-w-0 flex-1 truncate";
    const value = canStartWhatsApp ? <a href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noreferrer" title="打开 WhatsApp 对话" className={`${valueClass} text-[#128C7E] hover:underline`}>{formattedValue}</a> : <span className={valueClass}>{formattedValue}</span>;
    return <span key={key} title={`${item.label}：${item.value}\n来源：${source.label}${item.sourceUrl ? "\n展开后可打开核验页面" : ""}`} className={`inline-flex items-center gap-1 text-xs text-blue-700 ${isNumber ? "shrink-0" : "min-w-0 flex-1 overflow-hidden"}`}><span className={item.type === "EMAIL" ? "shrink-0 text-emerald-600" : item.type === "WHATSAPP" ? "shrink-0" : "shrink-0 text-emerald-600"}>{item.icon}</span>{value}<button type="button" onClick={() => copyContact(item.value, key)} aria-label={`复制${item.label}`} title={copiedKey === key ? "已复制" : `复制${item.label}`} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-blue-600">{copiedKey === key ? <Check size={11} className="text-emerald-600"/> : <Copy size={11}/>}</button>{item.source === "conflict" ? <ConflictMarker/> : null}</span>;
  };
  if (display === "phone" && contacts.length > collapseThreshold) {
    return <div className="w-full min-w-0 max-w-[310px] rounded-md bg-slate-50/70 px-1.5 py-1"><div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">{renderPreviewContact(orderedContacts[0],0)}<button type="button" aria-expanded={expanded} aria-label={expanded ? "收起其余联系方式" : `展开其余${contacts.length-1}项联系方式及来源`} onClick={() => setExpanded((current) => !current)} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-blue-700 hover:underline">{expanded ? "收起" : `另${contacts.length-1}项`}<ChevronDown size={13} className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}/></button></div>{expanded ? <div className="mt-1 border-t border-slate-100 pt-1">{renderGroups()}</div> : null}</div>;
  }
  if (source !== "original" && contacts.length <= collapseThreshold) return <div className="min-w-[180px] space-y-1">{orderedContacts.map((item,index)=>renderContact(item,index))}</div>;
  // Email keeps its compact preview. Mixed contact summaries may wrap complete
  // phone numbers instead of turning them into indistinguishable prefixes.
  // Every remaining value plus its source evidence stays behind the expander.
  if (source !== "original") {
    const firstNumber = orderedContacts.find((item) => item.type !== "EMAIL");
    const previewContacts = display === "email" ? orderedContacts.slice(0,1) : orderedContacts.filter((item) => item.type === "EMAIL" || item === firstNumber).slice(0,2);
    return <div className="w-full min-w-0 max-w-[310px] rounded-md bg-slate-50/70 px-1.5 py-1"><div className={`flex min-w-0 items-center gap-1 ${display === "email" ? "h-5" : "min-h-5 flex-wrap"}`}><b className="shrink-0 text-xs font-medium text-slate-800">{contacts.length} 个</b><span className={`flex min-w-0 flex-1 items-center gap-1 ${display === "email" ? "overflow-hidden" : "flex-wrap basis-[180px]"}`}>{previewContacts.map(renderPreviewContact)}</span><button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="flex shrink-0 items-center gap-0.5 text-[11px] text-blue-700 hover:underline">{expanded ? "收起" : "展开"}<ChevronDown size={13} className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}/></button></div>{expanded ? <div className="mt-1 border-t border-slate-100 pt-1">{renderGroups()}</div> : null}</div>;
  }
  return <div className="space-y-1">{contacts.map((item, index) => renderContact(item, index))}</div>;
}
