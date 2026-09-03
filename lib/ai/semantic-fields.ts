/**
 * Semantic customer field mapping for heterogeneous import/channel payloads.
 *
 * Keep this layer read-only: AI screening may consume any recognized alias,
 * but it must never rename or overwrite the original source field.
 */
export const AI_FIELD_MAPPING_VERSION = "2026.08.24.2";

export const AI_CUSTOMER_FIELD_CANDIDATES = {
  id: ["id"],
  owner_id: ["owner_id"],
  company_name: ["company_name", "customer_name", "store_name", "shop_name", "name"],
  contact_name: ["contact_name", "primary_contact_name", "contact", "联系人"],
  country: ["country", "country_code", "region", "国家", "国家地区"],
  phone: ["phone", "primary_phone_raw", "full_phone", "完整号码", "联系电话"],
  whatsapp: ["whatsapp", "whatsapp_phone", "WhatsApp"],
  email: ["email", "primary_email_raw", "邮箱"],
  website_email: ["website_email", "discovered_email", "官网邮箱"],
  website_phone: ["website_phone", "discovered_phone", "官网电话"],
  website: ["website", "website_url", "store_url", "官网网址", "商家官网网址"],
  google_url: ["google_url", "google_maps_url", "google_maps_link", "谷歌网址", "Google Maps"],
  google_place_id: ["google_maps_place_id", "google_place_id", "place_id"],
  address: ["address", "store_address", "formatted_address", "商店地址", "地址"],
  industry: ["industry", "store_type", "category", "行业", "商店类型"],
  business_scope: ["business_scope", "经营范围", "主营业务"],
  company_scale: ["company_scale", "企业规模"],
  company_scale_evidence: ["company_scale_evidence", "企业规模依据"],
  category: ["category", "customer_type", "store_category", "分类"],
  source: ["source", "source_type", "source_channel", "数据来源"],
  source_channel: ["source_channel", "entry_channel"],
  source_batch: ["source_batch", "source_reference", "import_batch", "batch_name"],
  source_batch_id: ["source_batch_id", "import_task_id"],
  tags: ["tags", "keywords", "标签"],
  linkedin_url: ["linkedin_url", "linkedin", "linkedin_page"],
  facebook_url: ["facebook_url", "facebook", "facebook_page"],
  instagram_url: ["instagram_url", "instagram", "instagram_page"],
  tiktok_url: ["tiktok_url", "tiktok", "tiktok_page"],
  other_public_urls: ["other_public_urls", "public_urls", "social_urls"],
  created_at: ["created_at", "entered_at", "imported_at"],
} as const;

type CustomerSemanticKey = keyof typeof AI_CUSTOMER_FIELD_CANDIDATES;
type LooseRow = Record<string, unknown>;

function present(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function semanticValue(row: LooseRow, key: CustomerSemanticKey) {
  for (const candidate of AI_CUSTOMER_FIELD_CANDIDATES[key]) {
    if (candidate in row && present(row[candidate])) return row[candidate];
  }
  return null;
}

function text(row: LooseRow, key: CustomerSemanticKey) {
  const value = semanticValue(row, key);
  return value == null ? null : String(value).trim() || null;
}

function textArray(row: LooseRow, key: CustomerSemanticKey) {
  const value = semanticValue(row, key);
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (!present(value)) return [];
  return String(value).split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

export function mapCustomerForAi(row: LooseRow) {
  return {
    id: text(row, "id") || "",
    owner_id: text(row, "owner_id"),
    company_name: text(row, "company_name") || "未命名客户",
    contact_name: text(row, "contact_name"),
    country: text(row, "country"),
    phone: text(row, "phone"),
    whatsapp: text(row, "whatsapp"),
    email: text(row, "email"),
    website_email: text(row, "website_email"),
    website_phone: text(row, "website_phone"),
    website: text(row, "website"),
    google_url: text(row, "google_url"),
    google_place_id: text(row, "google_place_id"),
    address: text(row, "address"),
    industry: text(row, "industry"),
    business_scope: text(row, "business_scope"),
    company_scale: text(row, "company_scale"),
    company_scale_evidence: text(row, "company_scale_evidence"),
    category: text(row, "category"),
    source: text(row, "source"),
    source_channel: text(row, "source_channel"),
    source_batch: text(row, "source_batch"),
    source_batch_id: text(row, "source_batch_id"),
    tags: textArray(row, "tags"),
    linkedin_url: text(row, "linkedin_url"),
    facebook_url: text(row, "facebook_url"),
    instagram_url: text(row, "instagram_url"),
    tiktok_url: text(row, "tiktok_url"),
    other_public_urls: textArray(row, "other_public_urls"),
    created_at: text(row, "created_at"),
  };
}

export type AiMappedCustomer = ReturnType<typeof mapCustomerForAi>;

