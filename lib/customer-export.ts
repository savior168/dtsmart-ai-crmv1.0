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

type ContactKind = "PHONE" | "WHATSAPP" | "EMAIL";
type VerifiedContact = { type?: unknown; value_raw?: unknown; verification_status?: unknown; exact_source_url?: unknown };
type ExportDisplayColumn = CustomerExportColumn | "original_phone" | "original_email" | "ai_phone" | "ai_email" | "ai_whatsapp" | "facebook" | "instagram" | "linkedin" | "tiktok" | "other_social";

const EXPORT_DISPLAY_LABELS: Record<ExportDisplayColumn, string> = {
  ...CUSTOMER_EXPORT_LABELS,
  original_phone: "原始电话",
  original_email: "原始邮箱号",
  ai_phone: "AI采集电话",
  ai_email: "AI采集邮箱号",
  ai_whatsapp: "AI采集WhatsApp",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  other_social: "其他社媒链接",
};

function contactKey(kind: ContactKind, value: string) {
  return kind === "EMAIL" ? value.toLowerCase() : value.replace(/\D/g, "") || value.toLowerCase();
}

function verifiedContactEntries(customer: Record<string, unknown>, kind: ContactKind) {
  const entries: Array<{ value: string; sourceUrl: string | null }> = [];
  const seen = new Set<string>();
  const add = (value: unknown, sourceUrl?: unknown) => {
    const raw = String(value || "").trim();
    if (!raw || seen.has(contactKey(kind, raw))) return;
    seen.add(contactKey(kind, raw));
    const exact = String(sourceUrl || "").trim();
    entries.push({ value: kind === "EMAIL" ? raw : formatCustomerPhone(raw), sourceUrl: /^https?:\/\//i.test(exact) ? exact : null });
  };
  const contacts = Array.isArray(customer.verified_contacts) ? customer.verified_contacts as VerifiedContact[] : [];
  for (const item of contacts) {
    if (String(item.type || "").toUpperCase() !== kind || !["NEW_VERIFIED", "CONFLICTING_VERIFIED"].includes(String(item.verification_status || ""))) continue;
    add(item.value_raw, item.exact_source_url);
  }
  // Compatibility fields are legacy collected values. They remain visible,
  // but are deliberately not linked because no exact evidence page was saved.
  if (kind === "PHONE") add(customer.website_phone);
  if (kind === "EMAIL") add(customer.website_email);
  return entries;
}

function verifiedContactText(customer: Record<string, unknown>, kind: ContactKind) {
  return verifiedContactEntries(customer, kind).map((entry) => entry.value).join("\n") || "-";
}

function verifiedContactSource(customer: Record<string, unknown>, kind: ContactKind) {
  const entries = verifiedContactEntries(customer, kind);
  // One spreadsheet cell can have one link. Only attach it when every value
  // in that cell is verified on the same exact source page.
  const sources = [...new Set(entries.map((entry) => entry.sourceUrl).filter((value): value is string => Boolean(value)))];
  return sources.length === 1 && entries.every((entry) => entry.sourceUrl === sources[0]) ? sources[0] : null;
}

function expandExportColumns(columns: CustomerExportColumn[]) {
  return columns.flatMap((key): ExportDisplayColumn[] => {
    if (key === "phone") return ["original_phone", "original_email"];
    if (key === "verified_contacts") return ["ai_phone", "ai_email", "ai_whatsapp"];
    if (key === "social") return ["facebook", "instagram", "linkedin", "tiktok", "other_social"];
    // The default list renders email inside original contacts and official
    // contacts inside AI-collected contacts. Avoid duplicate export columns.
    if (["email", "website_phone", "website_email"].includes(key)) return [];
    return [key];
  }).filter((key, index, all) => all.indexOf(key) === index);
}

function exportColumnText(customer: Record<string, unknown>, key: CustomerExportColumn) {
  if (key === "company_name") return exportText(customer.company_name);
  if (key === "contact_name") return exportText(customer.contact_name);
  if (key === "country") return countryInfo(customer.country as string | null | undefined).name;
  if (key === "industry") return exportText(customer.industry || customer.category);
  if (key === "ai_score") return customer.ai_score == null ? "未筛选" : `${exportText(customer.ai_level || "-")} · ${exportText(customer.ai_score)}`;
  if (key === "status") return STAGE_LABELS[(customer.status as CustomerStatus) || "UNCLAIMED"] || exportText(customer.status);
  if (key === "followup_status") return FOLLOWUP_STAGE_LABELS[(customer.followup_status as FollowupStage) || "WAITING_CONTACT"] || "待联系";
  if (key === "protection") return customerProtectionText(customer as Customer);
  if (key === "last_contact_time") return dateTime(customer.last_contact_time as string | null | undefined, "未跟进");
  if (key === "owner") return ownerName(customer);
  if (key === "phone") return formatCustomerPhone(customer.phone as string | null | undefined);
  if (key === "whatsapp") return formatCustomerPhone(customer.whatsapp as string | null | undefined);
  if (key === "email") return exportText(customer.email);
  if (key === "website_email") return exportText(customer.website_email);
  if (key === "website_phone") return formatCustomerPhone(customer.website_phone as string | null | undefined);
  if (key === "verified_contacts") return "-";
  if (key === "website") return exportText(customer.website);
  if (key === "google_url") return exportText(customer.google_url);
  if (key === "social") return "-";
  if (key === "source") return customer.source === "EXCEL_IMPORT" ? "Excel导入" : exportText(customer.source);
  if (key === "updated_at") return dateTime(customer.updated_at as string | null | undefined);
  return "-";
}

function exportDisplayText(customer: Record<string, unknown>, key: ExportDisplayColumn) {
  if (key === "original_phone") return formatCustomerPhone(customer.phone as string | null | undefined);
  if (key === "original_email") return exportText(customer.email);
  if (key === "ai_phone") return verifiedContactText(customer, "PHONE");
  if (key === "ai_email") return verifiedContactText(customer, "EMAIL");
  if (key === "ai_whatsapp") return verifiedContactText(customer, "WHATSAPP");
  if (key === "facebook") return exportText(customer.facebook_url);
  if (key === "instagram") return exportText(customer.instagram_url);
  if (key === "linkedin") return exportText(customer.linkedin_url);
  if (key === "tiktok") return exportText(customer.tiktok_url);
  if (key === "other_social") return exportText(customer.other_public_urls);
  return exportColumnText(customer, key);
}

function hasAiEvidence(customer: Record<string, unknown>) {
  return [customer.ai_reason, customer.business_scope, customer.business_relevance, customer.customer_value, customer.followup_suggestion, customer.company_scale, customer.company_scale_evidence].some((value) => String(value || "").trim());
}

export function buildCustomerWorkbookSheets(customers: Array<Record<string, unknown>>, options: CustomerWorkbookOptions = {}): WorkbookSheet[] {
  const rows = customers.filter((customer) => Boolean(customer.id || customer.company_name));
  if (!rows.length) return [];
  const configured = options.columns?.length ? options.columns : DEFAULT_EXPORT_COLUMNS;
  const visibleColumns = configured.filter((key, index, all) => key !== "last_contact_time" && (options.includeOwner !== false || key !== "owner") && all.indexOf(key) === index);
  const exportColumns = expandExportColumns(visibleColumns);
  const scoreIndex = exportColumns.indexOf("ai_score");
  const headers = [
    ...exportColumns.flatMap((key) => key === "ai_score" ? [EXPORT_DISPLAY_LABELS[key], "AI依据"] : [EXPORT_DISPLAY_LABELS[key]]),
  ];
  const evidenceColumn = scoreIndex < 0 ? -1 : scoreIndex + 1;
  const evidenceRows = rows.filter(hasAiEvidence);
  const evidenceRowById = new Map(evidenceRows.map((customer, index) => [String(customer.id || customer.company_name), index + 2]));
  const mainRows = rows.map((customer) => exportColumns.flatMap((key) => {
    if (key !== "ai_score") return [exportDisplayText(customer, key)];
    const evidenceRow = evidenceRowById.get(String(customer.id || customer.company_name));
    return [exportDisplayText(customer, key), evidenceRow ? "查看依据" : "-"];
  }));
  const hyperlinkColumns = exportColumns.flatMap((key, index) => {
    const offset = exportColumns.slice(0, index).filter((item) => item === "ai_score").length;
    return ["website", "google_url", "facebook", "instagram", "linkedin", "tiktok", "other_social"].includes(key) ? [index + offset] : [];
  });
  const aiContactSourceColumns = exportColumns.flatMap((key, index) => {
    if (!["ai_phone", "ai_email", "ai_whatsapp"].includes(key)) return [];
    const offset = exportColumns.slice(0, index).filter((item) => item === "ai_score").length;
    return [{ key, column: index + offset }];
  });
  return [
    {
      name: "客户清单",
      widths: headers.map((header) => header === "客户名称" ? 28 : ["AI采集电话", "AI采集邮箱号", "AI采集WhatsApp"].includes(header) ? 30 : header === "AI依据" ? 14 : 20),
      wrapColumns: headers.map((header, index) => ["AI采集电话", "AI采集邮箱号", "AI采集WhatsApp", "其他社媒链接"].includes(header) ? index : -1).filter((index) => index >= 0),
      hyperlinkColumns,
      externalHyperlinks: rows.flatMap((customer, row) => aiContactSourceColumns.flatMap(({ key, column }) => {
        const kind = key === "ai_phone" ? "PHONE" : key === "ai_email" ? "EMAIL" : "WHATSAPP";
        const target = verifiedContactSource(customer, kind);
        return target ? [{ row: row + 1, column, target, tooltip: "打开该联系方式的来源核验页" }] : [];
      })),
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
