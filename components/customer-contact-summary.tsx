"use client";

import { ChevronDown, Mail, Phone, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { normalizePhoneInternational, formatPhoneInternational } from "@/lib/contacts/phone-normalization";

type VerifiedContact = { type?: string | null; value_raw?: string | null; source_channel?: string | null; exact_source_url?: string | null; verification_status?: string | null; captured_at?: string | null };
type ContactCustomer = { source?: string | null; country?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; website?: string | null; google_url?: string | null; website_phone?: string | null; website_email?: string | null; verified_contacts?: VerifiedContact[] | null };
type ContactKind = "PHONE" | "EMAIL" | "WHATSAPP";
type DisplayContact = { label: string; value: string; type: ContactKind; icon: ReactNode; source: "original" | "verified" | "conflict"; channelLabel?: string | null; verifiedBy?: string | null; sourceUrl?: string | null; capturedAt?: string | null };

function contactKey(type: ContactKind, value: string, country?: string | null) {
  if (type === "EMAIL") return `${type}:${value.trim().toLowerCase()}`;
  return `${type}:${normalizePhoneInternational(value, country).replace(/\D/g, "") || value.replace(/\D/g, "")}`;
}
function WhatsAppIcon() {
  return <span aria-label="WhatsApp" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#25D366] text-white"><Phone size={9} strokeWidth={2.5}/></span>;
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
function originalSourceKind(source?: string | null) {
  const label = originalSourceLabel(source);
  return label === "Excel导入" ? "导入" : label === "手工录入" ? "录入" : label === "AI获客采集" ? "AI采集" : "原始";
}
function ConflictMarker() {
  const label = "来源存在冲突，待人工核对";
  return <span role="img" aria-label={label} title={label} tabIndex={0} className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-200"><TriangleAlert size={11}/></span>;
}
function splitStoredContactValues(value: string | null | undefined, type: "PHONE" | "EMAIL", country?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const chunks = raw
    .split(/[,;|\r\n]+|(?=\s+\d+\s*[:：]\s*)/)
    .map((item) => item.replace(/^\s*\d+\s*[:：]\s*/, "").trim())
    .filter(Boolean);
  const unique = new Map<string,string>();
  for (const chunk of chunks) {
    const normalized = type === "EMAIL" ? chunk.toLowerCase() : normalizePhoneInternational(chunk, country);
    if (!normalized || (type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))) continue;
    if (!unique.has(normalized)) unique.set(normalized, type === "PHONE" ? normalized : chunk);
  }
  return [...unique.values()];
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
export function CustomerContactSummary({ customer, source }: { customer: ContactCustomer; source: "original" | "ai" | "all" }) {
  const [expanded, setExpanded] = useState(false);
  const collapseThreshold = 1;
  const originals: DisplayContact[] = [
    { label: "电话", value: customer.phone || "未提供", type: "PHONE", icon: <Phone size={14} className="text-blue-600"/>, source: "original" },
    { label: "WhatsApp", value: customer.whatsapp || "未提供", type: "WHATSAPP", icon: iconFor("WHATSAPP"), source: "original" },
    { label: "邮箱", value: customer.email || "未提供", type: "EMAIL", icon: iconFor("EMAIL"), source: "original" },
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
  const contacts = source === "original" ? originalContacts : source === "ai" ? uniqueCollected : [...originalContacts, ...verifiedContacts];
  if (!contacts.length) return <span className="text-slate-400">—</span>;
  const renderContact = (item: DisplayContact, index: number) => {
    const muted = false;
    const key = `${item.label}:${item.value}:${index}`;
    const sourceTooltip = item.source === "conflict"
      ? "来源存在冲突，待人工核对"
      : item.source === "original"
        ? `数据来源：${originalSourceLabel(customer.source)}${item.verifiedBy ? `\nAI核验来源：${item.verifiedBy}` : ""}`
        : `AI采集来源：${item.channelLabel || "其他公开来源"}`;
    const display = muted || item.type === "EMAIL" ? item.value : formatPhoneInternational(item.value, customer.country);
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
    return <div key={key} title={`${item.label}：${item.value}\n${sourceTooltip}${item.capturedAt?`\n采集时间：${new Date(item.capturedAt).toLocaleString("zh-CN",{hour12:false})}`:""}${item.sourceUrl ? `\n点击打开来源核验` : ""}`} className="rounded bg-slate-50/80 px-1.5 py-1"><span className="flex min-w-0 items-start gap-1 text-xs text-slate-700"><span className={item.source === "verified" ? "mt-0.5 shrink-0 text-emerald-600" : item.source === "conflict" ? "mt-0.5 shrink-0 text-amber-600" : item.type === "PHONE" ? "mt-0.5 shrink-0 text-blue-600" : "mt-0.5 shrink-0 text-slate-400"}>{item.icon}</span>{text}{item.source === "conflict" ? <ConflictMarker/> : null}</span></div>;
  };
  const kindRank:Record<ContactKind,number> = { PHONE:0, WHATSAPP:1, EMAIL:2 };
  const orderedContacts = [...contacts].sort((a,b) => {
    const sourceDifference = sourceGroup(a, customer.source).rank - sourceGroup(b, customer.source).rank;
    return sourceDifference || kindRank[a.type] - kindRank[b.type];
  });
  const renderGroups = (items = orderedContacts) => {
    const groups = new Map<string, { label:string; hint:string; badge:string; rank:number; items:DisplayContact[] }>();
    for (const item of items) {
      const group = sourceGroup(item, customer.source);
      const current = groups.get(group.key) || { label:group.label, hint:group.hint, badge:group.badge, rank:group.rank, items:[] };
      current.items.push(item);
      groups.set(group.key, current);
    }
    return <div className="space-y-2">{[...groups.values()].sort((a,b)=>a.rank-b.rank).map((group) => <section key={group.label}><span title={group.hint} className="flex items-center justify-between gap-2"><b className="text-[11px] font-medium text-slate-700">{group.label}（{group.items.length}）</b><small className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{group.badge}</small></span><div className="mt-0.5 space-y-0.5">{group.items.sort((a,b)=>kindRank[a.type]-kindRank[b.type]).map((item,index)=>renderContact(item,index))}</div></section>)}</div>;
  };
  if (source !== "original" && contacts.length <= collapseThreshold) return <div className="min-w-[180px] space-y-1">{orderedContacts.map((item,index)=>renderContact(item,index))}</div>;
  // Combined and AI-collected contacts stay compact in every customer view;
  // A single value stays directly actionable. Multiple values collapse to one
  // summary row so the table height remains stable until the user asks to see
  // every value and its verification source.
  if (source !== "original") {
    const originalCount = source === "all" ? originalContacts.length : 0;
    const aiCount = source === "ai" ? contacts.length : verifiedContacts.length + (originalSourceKind(customer.source) === "AI采集" ? originalContacts.length : 0);
    const sourceCounts = [
      originalCount && originalSourceKind(customer.source) !== "AI采集" ? { label: originalSourceKind(customer.source), count: originalCount, tone: "bg-slate-100 text-slate-600" } : null,
      aiCount ? { label: "AI采集", count: aiCount, tone: "bg-emerald-50 text-emerald-700" } : null,
    ].filter(Boolean) as Array<{label:string;count:number;tone:string}>;
    return <div className="min-w-[190px] rounded-lg border border-slate-100 bg-slate-50/70 px-1.5 py-1"><button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="flex w-full cursor-pointer items-center gap-1.5 text-left"><b className="shrink-0 text-xs font-medium text-slate-800">{contacts.length} 个</b><span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{sourceCounts.map((item) => <span key={item.label} className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${item.tone}`}>{item.label} {item.count}</span>)}</span><span className="flex shrink-0 items-center gap-0.5 text-[11px] text-blue-700">{expanded ? "收起" : "展开"}<ChevronDown size={13} className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}/></span></button>{expanded ? <div className="mt-1 border-t border-slate-100 pt-1">{renderGroups()}</div> : null}</div>;
  }
  return <div className="space-y-1">{contacts.map((item, index) => renderContact(item, index))}</div>;
}
