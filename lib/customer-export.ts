import { countryInfo } from "@/lib/countries";
import { FOLLOWUP_STAGE_LABELS, type Customer, type CustomerStatus, type FollowupStage } from "@/lib/types";

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
  | "website"
  | "google_url"
  | "source"
  | "updated_at";

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
  if (key === "website") return customer.website || "-";
  if (key === "google_url") return customer.google_url || "-";
  if (key === "source") return customer.source === "EXCEL_IMPORT" ? "Excel导入" : customer.source || "-";
  return "-";
}

export function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

// Exports are an audit artifact, not a copy of the visible table.  Keep the
// business-critical fields in one stable order and render structured values as
// readable text instead of leaking JSON into Excel.
export const CUSTOMER_FULL_EXPORT_HEADERS = [
  "客户名称", "联系人", "国家/地区", "地址", "联系电话", "WhatsApp", "原始邮箱", "官网电话", "官网邮箱",
  "官网网址", "Google Maps", "Facebook", "Instagram", "LinkedIn", "TikTok", "其他公开链接",
  "AI核验行业", "原始类别", "AI等级", "AI评分", "目标判断", "分析依据摘要", "经营范围", "业务相关性", "客户价值", "跟进建议", "企业规模", "规模依据",
  "客户阶段", "跟进状态", "当前归属人", "数据来源", "导入批次", "最近联系时间", "创建时间", "更新时间",
] as const;

function exportText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("；");
  return String(value ?? "").trim() || "-";
}

export function fullCustomerExportValues(customer: Record<string, unknown>) {
  const owner = customer.owner && typeof customer.owner === "object"
    ? (customer.owner as { name?: unknown; email?: unknown }).name || (customer.owner as { email?: unknown }).email
    : customer.owner_name || customer.owner_id;
  const target = customer.is_target_customer === true ? "有效目标" : customer.is_target_customer === false ? "无效目标" : "AI未筛选";
  const score = customer.ai_score == null ? "未筛选" : `${exportText(customer.ai_level)} · ${exportText(customer.ai_score)}`;
  return [
    customer.company_name, customer.contact_name, countryInfo(customer.country as string | null | undefined).name, customer.address,
    formatCustomerPhone(customer.phone as string | null | undefined), formatCustomerPhone(customer.whatsapp as string | null | undefined), customer.email, customer.website_phone, customer.website_email,
    customer.website, customer.google_url, customer.facebook_url, customer.instagram_url, customer.linkedin_url, customer.tiktok_url, customer.other_public_urls,
    customer.industry, customer.category, customer.ai_level, score, target, customer.ai_reason, customer.business_scope, customer.business_relevance, customer.customer_value, customer.followup_suggestion, customer.company_scale, customer.company_scale_evidence,
    STAGE_LABELS[(customer.status as CustomerStatus) || "UNCLAIMED"] || customer.status, FOLLOWUP_STAGE_LABELS[(customer.followup_status as FollowupStage) || "WAITING_CONTACT"] || "待联系", owner,
    customer.source === "EXCEL_IMPORT" ? "Excel导入" : customer.source, customer.source_batch, dateTime(customer.last_contact_time as string | null | undefined, "未跟进"), dateTime(customer.created_at as string | null | undefined), dateTime(customer.updated_at as string | null | undefined),
  ].map(exportText);
}
