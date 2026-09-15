import type { CustomerExportColumn } from "@/lib/customer-export";

export type CustomerListColumn = CustomerExportColumn;

export const CUSTOMER_LIST_COLUMNS: Array<{ key: CustomerListColumn; label: string }> = [
  { key: "company_name", label: "客户名称" },
  { key: "contact_name", label: "联系人" },
  { key: "country", label: "国家/地区" },
  { key: "ai_score", label: "AI评分" },
  { key: "status", label: "客户阶段" },
  { key: "followup_status", label: "跟进状态" },
  { key: "protection", label: "保护期剩余" },
  { key: "last_contact_time", label: "最近跟进" },
  { key: "owner", label: "归属人" },
  { key: "phone", label: "原始联系方式" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "邮箱" },
  { key: "website_email", label: "官网邮箱" },
  { key: "website_phone", label: "官网电话" },
  { key: "verified_contacts", label: "AI采集联系方式" },
  { key: "website", label: "官网" },
  { key: "google_url", label: "Google Maps" },
  { key: "social", label: "社媒渠道" },
  { key: "source", label: "数据来源" },
  { key: "source_batch", label: "来源批次" },
  { key: "updated_at", label: "更新时间" },
];

export const CUSTOMER_LIST_DEFAULT_COLUMNS: CustomerListColumn[] = [
  "company_name",
  "ai_score",
  "country",
  "phone",
  "verified_contacts",
  "website",
  "google_url",
  "social",
  "status",
  "followup_status",
  "last_contact_time",
  "protection",
  "source",
  "updated_at",
];

export const CUSTOMER_LIST_COLUMN_STORAGE_KEY = "customer-columns-v12";

const columnKeys = new Set<CustomerListColumn>(CUSTOMER_LIST_COLUMNS.map((column) => column.key));

export function normalizeCustomerListColumns(value: unknown, includeOwner = false): CustomerListColumn[] {
  const saved = Array.isArray(value)
    ? value.filter((key): key is CustomerListColumn => typeof key === "string" && columnKeys.has(key as CustomerListColumn))
    : [];
  // 行业已经作为客户名称下的“AI核验/原始类别”说明展示；列表再单列展示会重复。
  // 同时清理旧版浏览器保存的字段偏好，确保刷新后也不会继续出现重复列。
  const normalized = (saved.length ? saved : [...CUSTOMER_LIST_DEFAULT_COLUMNS]).filter((key) => key !== "industry");
  const withoutOwner = includeOwner ? normalized : normalized.filter((key) => key !== "owner");
  if (!withoutOwner.includes("protection")) withoutOwner.splice(Math.min(5, withoutOwner.length), 0, "protection");
  if (includeOwner && !withoutOwner.includes("owner")) withoutOwner.push("owner");
  return withoutOwner;
}

export function customerListSortField(key: CustomerListColumn) {
  if (key === "owner") return "owner_id";
  if (key === "protection") return "updated_at";
  if (key === "followup_status") return "followup_status";
  return key;
}
