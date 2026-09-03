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
