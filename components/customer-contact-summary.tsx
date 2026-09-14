"use client";

import { CheckCircle2, Copy, Mail, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { normalizePhoneInternational, formatPhoneInternational } from "@/lib/contacts/phone-normalization";

type VerifiedContact = { type?: string | null; value_raw?: string | null; source_channel?: string | null; exact_source_url?: string | null; verification_status?: string | null };
type ContactCustomer = { country?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; website_phone?: string | null; website_email?: string | null; verified_contacts?: VerifiedContact[] | null };
type ContactKind = "PHONE" | "EMAIL" | "WHATSAPP";
type DisplayContact = { label: string; value: string; type: ContactKind; icon: ReactNode; source: "original" | "verified" | "conflict"; sourceUrl?: string | null };

function contactKey(type: ContactKind, value: string, country?: string | null) {
  if (type === "EMAIL") return `${type}:${value.trim().toLowerCase()}`;
  return `${type}:${normalizePhoneInternational(value, country).replace(/\D/g, "") || value.replace(/\D/g, "")}`;
}
function iconFor(type: ContactKind) { return type === "EMAIL" ? <Mail size={14}/> : type === "WHATSAPP" ? <span className="text-[11px] font-bold leading-none text-[#25D366]">WA</span> : <Phone size={14}/>; }

/** One presentation rule for original and AI-collected contacts in every customer view. */
export function CustomerContactSummary({ customer, source }: { customer: ContactCustomer; source: "original" | "ai" }) {
  const [copied, setCopied] = useState("");
  const originals: DisplayContact[] = [
    { label: "原始电话", value: customer.phone || "未提供", type: "PHONE", icon: iconFor("PHONE"), source: "original" },
    { label: "原始 WhatsApp", value: customer.whatsapp || "未提供", type: "WHATSAPP", icon: iconFor("WHATSAPP"), source: "original" },
    { label: "原始邮箱", value: customer.email || "未提供", type: "EMAIL", icon: iconFor("EMAIL"), source: "original" },
  ];
  const originalKeys = new Set(originals.filter((item) => item.value !== "未提供").map((item) => contactKey(item.type, item.value, customer.country)));
  const collected: DisplayContact[] = (customer.verified_contacts || [])
    .filter((item) => ["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(String(item.verification_status || "")) && ["PHONE", "EMAIL", "WHATSAPP"].includes(String(item.type || "").toUpperCase()) && String(item.value_raw || "").trim())
    .map((item) => {
      const type = String(item.type).toUpperCase() as ContactKind;
      const channel = String(item.source_channel || "").toLowerCase();
      return { label: `${channel === "website" ? "官网" : channel === "google_maps" ? "Google Maps" : "公开来源"}核验${type === "EMAIL" ? "邮箱" : type === "WHATSAPP" ? "WhatsApp" : "电话"}`, value: String(item.value_raw).trim(), type, icon: iconFor(type), source: item.verification_status === "CONFLICTING_VERIFIED" ? "conflict" : "verified", sourceUrl: item.exact_source_url };
    });
  for (const [label, value, type] of [["官网核验电话", customer.website_phone, "PHONE"], ["官网核验邮箱", customer.website_email, "EMAIL"]] as const) {
    if (!value || collected.some((item) => contactKey(item.type, item.value, customer.country) === contactKey(type, value, customer.country))) continue;
    collected.push({ label, value, type, icon: iconFor(type), source: "verified" });
  }
  const contacts = (source === "original" ? originals : collected).filter((item, index, all) => source === "original" || (!originalKeys.has(contactKey(item.type, item.value, customer.country)) && all.findIndex((candidate) => contactKey(candidate.type, candidate.value, customer.country) === contactKey(item.type, item.value, customer.country)) === index));
  if (!contacts.length) return <span className="text-slate-400">—</span>;
  return <div className="space-y-1">{contacts.map((item, index) => {
    const muted = item.value === "未提供";
    const key = `${item.label}:${item.value}:${index}`;
    const tone = item.source === "original" ? "bg-slate-100 text-slate-500" : item.source === "conflict" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
    const badge = item.source === "original" ? "原始" : item.source === "conflict" ? "待核对" : "已核验";
    const display = muted || item.type === "EMAIL" ? item.value : formatPhoneInternational(item.value, customer.country);
    const whatsappDigits = item.type === "WHATSAPP" && !muted ? normalizePhoneInternational(item.value, customer.country).replace(/\D/g, "") : "";
    return <span key={key} title={`${item.label}：${item.value}${item.sourceUrl ? `\n来源：${item.sourceUrl}` : ""}`} className={`flex min-w-0 items-center gap-1.5 text-xs ${muted ? "text-slate-400" : "text-slate-700"}`}><span className={item.source === "verified" ? "shrink-0 text-emerald-600" : item.source === "conflict" ? "shrink-0 text-amber-600" : "shrink-0 text-slate-400"}>{item.icon}</span><span className={`shrink-0 rounded px-1 py-0.5 text-[10px] leading-none ${tone}`}>{badge}</span>{whatsappDigits ? <a href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noreferrer" title="打开 WhatsApp Web 对话" className="min-w-0 flex-1 truncate text-[#128C7E] hover:underline">{display}</a> : <span className="min-w-0 flex-1 truncate">{display}</span>}<button type="button" disabled={muted} onClick={() => { void navigator.clipboard?.writeText(item.value).then(() => { setCopied(key); window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1400); }).catch(() => undefined); }} aria-label={`复制${item.label}`} title={copied === key ? "已复制" : `复制${item.label}`} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-30">{copied === key ? <CheckCircle2 size={13} className="text-emerald-600"/> : <Copy size={13}/>}</button></span>;
  })}</div>;
}
