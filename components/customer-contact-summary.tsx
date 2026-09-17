"use client";

import { ChevronDown, Mail, Phone } from "lucide-react";
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
  const collapseThreshold = 2;
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
  for (const [label, value, type] of [["官网核验电话", customer.website_phone, "PHONE"], ["官网核验邮箱", customer.website_email, "EMAIL"]] as const) {
    if (!value || collected.some((item) => contactKey(item.type, item.value, customer.country) === contactKey(type, value, customer.country))) continue;
    collected.push({ label, value, type, icon: iconFor(type), source: "verified", channelLabel: "官网", sourceUrl: null });
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
    const tone = item.source === "conflict" ? "bg-amber-50 text-amber-700" : item.source === "original" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700";
    const badge = item.source === "conflict" ? "待核对" : item.source === "original" ? originalSourceLabel(customer.source) : `AI采集·${item.channelLabel || "公开来源"}`;
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
    const kindLabel = item.type === "EMAIL" ? "邮箱" : item.type === "WHATSAPP" ? "WhatsApp" : "电话";
    return <div key={key} title={`${item.label}：${item.value}${item.capturedAt?`\n采集时间：${new Date(item.capturedAt).toLocaleString("zh-CN",{hour12:false})}`:""}${item.sourceUrl ? `\n点击打开来源核验` : ""}`} className="rounded-md bg-slate-50/80 px-2 py-1.5"><span className="flex min-w-0 items-start gap-1.5 text-xs text-slate-700"><span className={item.source === "verified" ? "mt-0.5 shrink-0 text-emerald-600" : item.source === "conflict" ? "mt-0.5 shrink-0 text-amber-600" : item.type === "PHONE" ? "mt-0.5 shrink-0 text-blue-600" : "mt-0.5 shrink-0 text-slate-400"}>{item.icon}</span><span className="mt-0.5 shrink-0 text-[10px] text-slate-400">{kindLabel}</span>{text}</span>{item.source === "original"&&source === "original" ? null : <span className="ml-5 mt-1 flex flex-wrap gap-1"><span className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${tone}`}>{badge}</span>{item.source === "original" && item.verifiedBy ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] leading-none text-emerald-700">AI核验·{item.verifiedBy}</span> : null}</span>}</div>;
  };
  const renderGroups = () => {
    const groups = new Map<string, { label:string; hint:string; badge:string; rank:number; items:DisplayContact[] }>();
    for (const item of contacts) {
      const group = sourceGroup(item, customer.source);
      const current = groups.get(group.key) || { label:group.label, hint:group.hint, badge:group.badge, rank:group.rank, items:[] };
      current.items.push(item);
      groups.set(group.key, current);
    }
    const kindRank:Record<ContactKind,number> = { PHONE:0, WHATSAPP:1, EMAIL:2 };
    return <div className="space-y-3">{[...groups.values()].sort((a,b)=>a.rank-b.rank).map((group) => <section key={group.label}><span title={group.hint} className="flex items-center justify-between gap-2"><b className="text-[11px] font-medium text-slate-700">{group.label}（{group.items.length}）</b><small className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{group.badge}</small></span><div className="mt-1 space-y-1">{group.items.sort((a,b)=>kindRank[a.type]-kindRank[b.type]).map((item,index)=>renderContact(item,index))}</div></section>)}</div>;
  };
  if (source !== "original" && contacts.length <= collapseThreshold) return <div className="min-w-[180px]">{renderGroups()}</div>;
  // Combined and AI-collected contacts stay compact in every customer view;
  // one or two values stay visible; longer lists collapse to protect row height.
  if (source !== "original") {
    const originalCount = source === "all" ? originalContacts.length : 0;
    const aiCount = source === "ai" ? contacts.length : verifiedContacts.length + (originalSourceKind(customer.source) === "AI采集" ? originalContacts.length : 0);
    const sourceCounts = [
      originalCount && originalSourceKind(customer.source) !== "AI采集" ? { label: originalSourceKind(customer.source), count: originalCount, tone: "bg-slate-100 text-slate-600" } : null,
      aiCount ? { label: "AI采集", count: aiCount, tone: "bg-emerald-50 text-emerald-700" } : null,
    ].filter(Boolean) as Array<{label:string;count:number;tone:string}>;
    return <div className="min-w-[180px]"><button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="w-full cursor-pointer rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50/60"><span className="flex items-center justify-between gap-2"><span className="font-medium text-slate-800">{contacts.length} 个联系方式</span><ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}/></span><span className="mt-1.5 flex flex-wrap items-center gap-1">{sourceCounts.map((item) => <span key={item.label} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${item.tone}`}>{item.label} {item.count}</span>)}</span></button>{expanded ? <div className="mt-2 rounded-lg border border-slate-100 bg-white p-2.5 shadow-sm">{renderGroups()}</div> : null}</div>;
  }
  return <div className="space-y-1">{contacts.map((item, index) => renderContact(item, index))}</div>;
}
