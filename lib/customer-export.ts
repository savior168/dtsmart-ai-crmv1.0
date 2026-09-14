import { countryInfo } from "@/lib/countries";
import { FOLLOWUP_STAGE_LABELS, type Customer, type CustomerStatus, type FollowupStage } from "@/lib/types";
import { downloadWorkbook, type WorkbookSheet } from "@/lib/xlsx-export";

export type CustomerExportColumn =
  | "company_name"
  | "contact_name"
  | "country"
  | "industry"
  | "ai_score"
  | "status"
  | "followup_status"
  | "protection"
  | "last_contact_time"
  | "owner"
  | "phone"
  | "whatsapp"
  | "email"
  | "website_email"
  | "website_phone"
  | "verified_contacts"
  | "website"
  | "google_url"
  | "social"
  | "source"
  | "updated_at";

export type CustomerWorkbookOptions = {
  columns?: CustomerExportColumn[];
  includeOwner?: boolean;
};

const STAGE_LABELS: Record<CustomerStatus, string> = {
  UNCLAIMED: "待认领",
  CLAIMED: "潜在客户",
  FOLLOWING: "意向客户",
  QUOTE: "报价中",
  DEAL: "已成交",
  RELEASED: "无效客户",
};

export function formatCustomerPhone(value?: string | null) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\+?\d{1,4})\s+(.+)$/);
  if (!match) return raw || "-";
  const prefix = match[1].replace(/\D/g, "");
  const remainder = match[2].replace(/\D/g, "");
  return remainder.startsWith(prefix) ? match[2].trim() : raw;
}

export function customerProtectionText(customer: Customer, now = Date.now()) {
  const createdAt = new Date(customer.created_at).getTime();
  if (!Number.isFinite(createdAt)) return "-";
  const expiresAt = createdAt + 90 * 24 * 60 * 60 * 1000;
  const days = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
  return days <= 0 ? "已到期" : `剩余 ${days} 天`;
}

function dateTime(value?: string | null, empty = "-") {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-");
}

export function customerListText(customer: Customer, key: CustomerExportColumn, now = Date.now()) {
  if (key === "company_name") return customer.company_name || "-";
  if (key === "contact_name") return customer.contact_name || "-";
  if (key === "country") return countryInfo(customer.country).name;
  if (key === "industry") return customer.industry || customer.category || "其他";
  if (key === "ai_score") return customer.ai_score == null ? "未筛选" : `${customer.ai_level || "-"} · ${customer.ai_score}`;
  if (key === "status") return STAGE_LABELS[customer.status] || customer.status;
  if (key === "followup_status") return FOLLOWUP_STAGE_LABELS[customer.followup_status as FollowupStage] || "待联系";
  if (key === "protection") return customerProtectionText(customer, now);
  if (key === "last_contact_time") return dateTime(customer.last_contact_time, "未跟进");
  if (key === "updated_at") return dateTime(customer.updated_at);
  if (key === "owner") return customer.owner?.name || customer.owner_id || "-";
  if (key === "phone") return formatCustomerPhone(customer.phone);
  if (key === "whatsapp") return formatCustomerPhone(customer.whatsapp);
  if (key === "email") return customer.email || "-";
  if (key === "website_email") return customer.website_email || "-";
  if (key === "website_phone") return customer.website_phone || "-";
  if (key === "verified_contacts") return "-";
  if (key === "website") return customer.website || "-";
  if (key === "google_url") return customer.google_url || "-";
  if (key === "social") return [customer.facebook_url, customer.instagram_url, customer.linkedin_url, customer.tiktok_url, ...(customer.other_public_urls || [])].filter(Boolean).join("；") || "-";
  if (key === "source") return customer.source === "EXCEL_IMPORT" ? "Excel导入" : customer.source || "-";
  return "-";
}

export function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("；");
  return String(value ?? "").trim() || "-";
}

function ownerName(customer: Record<string, unknown>) {
  const owner = customer.owner && typeof customer.owner === "object"
    ? (customer.owner as { name?: unknown; email?: unknown }).name || (customer.owner as { email?: unknown }).email
    : customer.owner_name || customer.owner_id;
  return exportText(owner);
}

const CUSTOMER_EXPORT_LABELS: Record<CustomerExportColumn, string> = {
  company_name: "客户名称", contact_name: "联系人", country: "国家/地区", industry: "所属行业", ai_score: "AI评分",
  status: "客户阶段", followup_status: "跟进状态", protection: "保护期剩余", last_contact_time: "最近跟进", owner: "归属人",
  phone: "原始联系方式", whatsapp: "WhatsApp", email: "邮箱", website_email: "官网邮箱", website_phone: "官网电话",
  verified_contacts: "AI采集联系方式", website: "官网", google_url: "Google Maps", social: "社媒渠道", source: "数据来源", updated_at: "更新时间",
};

const DEFAULT_EXPORT_COLUMNS: CustomerExportColumn[] = [
  "company_name", "ai_score", "country", "phone", "verified_contacts", "website", "google_url", "social", "status", "followup_status", "protection", "source", "updated_at",
];

type VerifiedContact = { type?: unknown; value_raw?: unknown; verification_status?: unknown };
type ContactCopyKind = "PHONE" | "WHATSAPP" | "EMAIL";

const COPY_CONTACT_HEADERS: Array<[ContactCopyKind, string]> = [
  ["PHONE", "电话（复制）"],
  ["WHATSAPP", "WhatsApp（复制）"],
  ["EMAIL", "邮箱（复制）"],
];

function contactCopyValues(customer: Record<string, unknown>, kind: ContactCopyKind) {
  const values: string[] = [];
  const add = (value: unknown) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const display = kind === "EMAIL" ? raw : formatCustomerPhone(raw);
    const key = kind === "EMAIL" ? raw.toLowerCase() : raw.replace(/\D/g, "") || raw.toLowerCase();
    if (!values.some((item) => (kind === "EMAIL" ? item.toLowerCase() : item.replace(/\D/g, "") || item.toLowerCase()) === key)) values.push(display);
  };
  if (kind === "PHONE") { add(customer.phone); add(customer.website_phone); }
  if (kind === "WHATSAPP") add(customer.whatsapp);
  if (kind === "EMAIL") { add(customer.email); add(customer.website_email); }
  const contacts = Array.isArray(customer.verified_contacts) ? customer.verified_contacts as VerifiedContact[] : [];
  for (const item of contacts) {
    if (String(item.type || "").toUpperCase() !== kind || !["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(String(item.verification_status || ""))) continue;
    add(item.value_raw);
  }
  return values.join("\n") || "-";
}

function originalContactsText(customer: Record<string, unknown>) {
  const contacts = [
    customer.phone ? `电话：${formatCustomerPhone(String(customer.phone))}` : "",
    customer.whatsapp ? `WhatsApp：${formatCustomerPhone(String(customer.whatsapp))}` : "",
    customer.email ? `邮箱：${exportText(customer.email)}` : "",
  ].filter(Boolean);
  return contacts.join("\n") || "-";
}

function verifiedContactsText(customer: Record<string, unknown>) {
  const contacts = Array.isArray(customer.verified_contacts) ? customer.verified_contacts as VerifiedContact[] : [];
  const grouped: Record<"PHONE" | "WHATSAPP" | "EMAIL", string[]> = { PHONE: [], WHATSAPP: [], EMAIL: [] };
  const seen = new Set<string>();
  for (const item of contacts) {
    const type = String(item.type || "").toUpperCase();
    const value = String(item.value_raw || "").trim();
    if (!value || !["PHONE", "WHATSAPP", "EMAIL"].includes(type) || !["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(String(item.verification_status || ""))) continue;
    const key = `${type}:${value.toLowerCase()}`;
    if (!seen.has(key)) grouped[type as keyof typeof grouped].push(type === "EMAIL" ? value : formatCustomerPhone(value));
    seen.add(key);
  }
  for (const [type, value] of [["PHONE", customer.website_phone], ["EMAIL", customer.website_email]] as const) {
    const text = String(value || "").trim();
    const key = `${type}:${text.toLowerCase()}`;
    if (text && !seen.has(key)) grouped[type].push(type === "EMAIL" ? text : formatCustomerPhone(text));
  }
  const labels: Array<[keyof typeof grouped, string]> = [["PHONE", "电话"], ["WHATSAPP", "WhatsApp"], ["EMAIL", "邮箱"]];
  return labels.filter(([type]) => grouped[type].length).map(([type, label]) => `${label}：${grouped[type].join("；")}`).join("\n") || "-";
}

function exportColumnText(customer: Record<string, unknown>, key: CustomerExportColumn) {
  if (key === "company_name") return exportText(customer.company_name);
  if (key === "contact_name") return exportText(customer.contact_name);
  if (key === "country") return countryInfo(customer.country as string | null | undefined).name;
  if (key === "industry") return exportText(customer.industry || customer.category);
  // Keep the score as a score. The AI grade is deliberately not exported.
  if (key === "ai_score") return customer.ai_score == null ? "未分析" : exportText(customer.ai_score);
  if (key === "status") return STAGE_LABELS[(customer.status as CustomerStatus) || "UNCLAIMED"] || exportText(customer.status);
  if (key === "followup_status") return FOLLOWUP_STAGE_LABELS[(customer.followup_status as FollowupStage) || "WAITING_CONTACT"] || "待联系";
  if (key === "protection") return customerProtectionText(customer as Customer);
  if (key === "last_contact_time") return dateTime(customer.last_contact_time as string | null | undefined, "未跟进");
  if (key === "owner") return ownerName(customer);
  if (key === "phone") return originalContactsText(customer);
  if (key === "whatsapp") return formatCustomerPhone(customer.whatsapp as string | null | undefined);
  if (key === "email") return exportText(customer.email);
  if (key === "website_email") return exportText(customer.website_email);
  if (key === "website_phone") return formatCustomerPhone(customer.website_phone as string | null | undefined);
  if (key === "verified_contacts") return verifiedContactsText(customer);
  if (key === "website") return exportText(customer.website);
  if (key === "google_url") return exportText(customer.google_url);
  if (key === "social") return exportText([customer.facebook_url, customer.instagram_url, customer.linkedin_url, customer.tiktok_url, ...(Array.isArray(customer.other_public_urls) ? customer.other_public_urls : [])]);
  if (key === "source") return customer.source === "EXCEL_IMPORT" ? "Excel导入" : exportText(customer.source);
  if (key === "updated_at") return dateTime(customer.updated_at as string | null | undefined);
  return "-";
}

function hasAiEvidence(customer: Record<string, unknown>) {
  return [customer.ai_reason, customer.business_scope, customer.business_relevance, customer.customer_value, customer.followup_suggestion, customer.company_scale, customer.company_scale_evidence].some((value) => String(value || "").trim());
}

export function buildCustomerWorkbookSheets(customers: Array<Record<string, unknown>>, options: CustomerWorkbookOptions = {}): WorkbookSheet[] {
  const rows = customers.filter((customer) => Boolean(customer.id || customer.company_name));
  if (!rows.length) return [];
  const configured = options.columns?.length ? options.columns : DEFAULT_EXPORT_COLUMNS;
  const visibleColumns = configured.filter((key, index, all) => key !== "last_contact_time" && (options.includeOwner !== false || key !== "owner") && all.indexOf(key) === index);
  const scoreIndex = visibleColumns.indexOf("ai_score");
  const headers = [
    ...visibleColumns.flatMap((key) => key === "ai_score" ? [CUSTOMER_EXPORT_LABELS[key], "AI依据"] : [CUSTOMER_EXPORT_LABELS[key]]),
    ...COPY_CONTACT_HEADERS.map(([, label]) => label),
  ];
  const evidenceColumn = scoreIndex < 0 ? -1 : scoreIndex + 1;
  const evidenceRows = rows.filter(hasAiEvidence);
  const evidenceRowById = new Map(evidenceRows.map((customer, index) => [String(customer.id || customer.company_name), index + 2]));
  const mainRows = rows.map((customer) => [
    ...visibleColumns.flatMap((key) => {
    if (key !== "ai_score") return [exportColumnText(customer, key)];
    const evidenceRow = evidenceRowById.get(String(customer.id || customer.company_name));
    return [exportColumnText(customer, key), evidenceRow ? "查看依据" : "-"];
    }),
    ...COPY_CONTACT_HEADERS.map(([kind]) => contactCopyValues(customer, kind)),
  ]);
  const hyperlinkColumns = visibleColumns.flatMap((key, index) => {
    const offset = visibleColumns.slice(0, index).filter((item) => item === "ai_score").length;
    return ["website", "google_url"].includes(key) ? [index + offset] : [];
  });
  return [
    {
      name: "客户清单",
      widths: headers.map((header) => header === "客户名称" ? 28 : ["原始联系方式", "AI采集联系方式"].includes(header) ? 42 : header.endsWith("（复制）") ? 28 : header === "AI依据" ? 14 : 20),
      wrapColumns: headers.map((header, index) => ["原始联系方式", "AI采集联系方式", "社媒渠道"].includes(header) || header.endsWith("（复制）") ? index : -1).filter((index) => index >= 0),
      hyperlinkColumns,
      internalHyperlinks: evidenceColumn < 0 ? [] : rows.flatMap((customer, index) => {
        const evidenceRow = evidenceRowById.get(String(customer.id || customer.company_name));
        return evidenceRow ? [{ row: index + 1, column: evidenceColumn, target: `#'AI分析依据'!A${evidenceRow}` }] : [];
      }),
      rows: [
        headers,
        ...mainRows,
      ],
    },
    {
      name: "AI分析依据",
      widths: [26, 18, 52, 52, 52, 52, 52, 18, 52, 18],
      wrapColumns: [2, 3, 4, 5, 6, 8],
      rows: [
        ["客户名称", "AI核验行业", "分析依据摘要", "经营范围", "业务相关性", "客户价值", "跟进建议", "企业规模", "规模依据", "原始类别"],
        ...evidenceRows.map((customer) => [
          exportText(customer.company_name), exportText(customer.industry), exportText(customer.ai_reason), exportText(customer.business_scope), exportText(customer.business_relevance),
          exportText(customer.customer_value), exportText(customer.followup_suggestion), exportText(customer.company_scale), exportText(customer.company_scale_evidence), exportText(customer.category),
        ]),
      ],
    },
  ];
}

export function downloadCustomerWorkbook(customers: Array<Record<string, unknown>>, fileName: string, options: CustomerWorkbookOptions = {}) {
  const sheets = buildCustomerWorkbookSheets(customers, options);
  if (!sheets.length) return;
  const date = new Date().toISOString().slice(0, 10);
  downloadWorkbook(`${fileName}-${date}.xlsx`, sheets);
}
