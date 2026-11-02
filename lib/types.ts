import type { CustomerGrade } from "@/lib/customers/customer-grade";

export type CustomerStatus = "UNCLAIMED" | "CLAIMED" | "FOLLOWING" | "QUOTE" | "DEAL" | "RELEASED";
export type AiStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type Customer = {
  id: string;
  company_name: string;
  contact_name: string | null;
  country: string | null;
  phone: string | null;
  phone_numbers?: string[] | null;
  whatsapp: string | null;
  whatsapp_numbers?: string[] | null;
  wechat?: string | null;
  wechat_numbers?: string[] | null;
  email: string | null;
  email_addresses?: string[] | null;
  tax_number?: string | null;
  manual_grade?: CustomerGrade | null;
  website: string | null;
  google_url: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  linkedin_url?: string | null;
  tiktok_url?: string | null;
  other_public_urls?: string[] | null;
  store_name?: string | null;
  product_image?: string | null;
  store_score?: number | null;
  review_count?: number | null;
  address: string | null;
  tally_requirements?: string | null;
  forwarder_address?: string | null;
  shipping_address?: string | null;
  forwarder_addresses?: string[] | null;
  shipping_addresses?: string[] | null;
  shipping_contact_entries?: import("@/lib/customers/address-list").ShippingContact[] | null;
  forwarder_contact_entries?: import("@/lib/customers/address-list").ShippingContact[] | null;
  other_address?: string | null;
  industry: string | null;
  business_scope?: string | null;
  company_scale?: string | null;
  company_scale_evidence?: string | null;
  category: string | null;
  source: string | null;
  source_batch?: string | null;
  source_batch_id?: string | null;
  source_stage_label?: string | null;
  source_grade_label?: string | null;
  tags: string[];
  rating?: number | null;
  ai_score: number | null;
  ai_level: string | null;
  ai_reason: string | null;
  is_target_customer?: boolean | null;
  ai_screening_done?: boolean | null;
  ai_status?: AiStatus | null;
  website_email?: string | null;
  website_phone?: string | null;
  verified_contacts?: Array<{ type?: string | null; value_raw?: string | null; source_channel?: string | null; exact_source_url?: string | null; verification_status?: string | null }> | null;
  business_relevance?: string | null;
  customer_value?: string | null;
  followup_suggestion?: string | null;
  notes?: string | null;
  status: CustomerStatus;
  followup_status?: FollowupStage | null;
  owner_id: string | null;
  owner_user_id?: string | null;
  department_id?: string | null;
  created_by?: string | null;
  creator?: { name: string | null; email: string } | null;
  last_contact_time?: string | null;
  next_followup_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at: string | null;
  owner?: { name: string | null; email: string } | null;
};

export const CUSTOMER_STATUSES: CustomerStatus[] = ["UNCLAIMED", "CLAIMED", "FOLLOWING", "DEAL", "RELEASED"];
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  UNCLAIMED: "待认领", CLAIMED: "潜在客户", FOLLOWING: "意向客户", QUOTE: "意向客户", DEAL: "已成交客户", RELEASED: "历史释放状态",
};

export type FollowupStage = "WAITING_CONTACT" | "FOLLOWUP_REQUIRED" | "WAITING_REPLY" | "PAUSED" | "NO_FOLLOWUP" | "CONTACTED" | "FOLLOWING" | "WAITING_CONFIRMATION" | "WAITING_PAYMENT" | "COMPLETED";
export const FOLLOWUP_STAGES: FollowupStage[] = ["WAITING_CONTACT", "FOLLOWUP_REQUIRED", "WAITING_REPLY", "PAUSED", "NO_FOLLOWUP"];
export const FOLLOWUP_STAGE_LABELS: Record<FollowupStage, string> = { WAITING_CONTACT: "待联系", FOLLOWUP_REQUIRED: "待跟进", WAITING_REPLY: "待客户回复", PAUSED: "暂缓跟进", NO_FOLLOWUP: "无需跟进", CONTACTED: "待跟进", FOLLOWING: "待跟进", WAITING_CONFIRMATION: "待跟进", WAITING_PAYMENT: "无需跟进", COMPLETED: "无需跟进" };
export const AI_LEVELS = ["A", "B", "C", "D"] as const;
export const AI_INDUSTRIES = ["手机维修店", "手机配件批发商", "手机配件零售商", "手机进口商", "电脑维修店", "电脑配件批发商", "其他"] as const;

export type FollowupType = "EMAIL" | "WHATSAPP" | "PHONE" | "LINKEDIN" | "OTHER";
export type Followup = { id: string; customer_id: string; user_id: string; type: FollowupType; stage?: FollowupStage | null; outcome?: "CONTACT_ONLY" | "INTEREST" | "NO_INTEREST"; content: string; attachment: string | null; next_follow_date: string | null; created_at: string; creator?: { name: string | null; email: string } | null };
export const FOLLOWUP_TYPES: FollowupType[] = ["EMAIL", "WHATSAPP", "PHONE", "LINKEDIN", "OTHER"];
export const FOLLOWUP_TYPE_LABELS: Record<FollowupType, string> = { EMAIL: "邮件", WHATSAPP: "WhatsApp", PHONE: "电话", LINKEDIN: "LinkedIn", OTHER: "其他" };

export type QuoteStatus = "DRAFT" | "GENERATED" | "SENT" | "CONFIRMED" | "SUPERSEDED" | "EXPIRED" | "CANCELLED";
export type SalesOrderStatus = "DRAFT" | "CONFIRMED" | "STOCK_DRAFT" | "WAITING_STOCK" | "PREPARING" | "RECEIVED" | "SORTING" | "READY_TO_SHIP" | "SHIPPED" | "READY" | "SHORTAGE" | "CANCELLED";
export type StockOrderStatus = "DRAFT" | "WAITING" | "PREPARING" | "RECEIVED" | "SORTING" | "READY_TO_SHIP" | "SHIPPED" | "READY" | "SHORTAGE" | "CANCELLED";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "草稿", GENERATED: "待发送", SENT: "已发送", CONFIRMED: "客户已确认", SUPERSEDED: "已被新版本替代", EXPIRED: "已过期", CANCELLED: "已取消",
};
export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: "PI草稿", CONFIRMED: "订单已确认", STOCK_DRAFT: "待完善备货信息", WAITING_STOCK: "待仓库接单", PREPARING: "采购中", RECEIVED: "已回齐待理货", SORTING: "理货中", READY_TO_SHIP: "已理货待交货代", SHIPPED: "已交货代", READY: "已备齐（历史）", SHORTAGE: "缺货异常", CANCELLED: "已取消",
};
export const STOCK_STATUS_LABELS: Record<StockOrderStatus, string> = {
  DRAFT: "待完善备货信息", WAITING: "待仓库接单", PREPARING: "采购中", RECEIVED: "已回齐待理货", SORTING: "理货中", READY_TO_SHIP: "已理货待交货代", SHIPPED: "已交货代", READY: "已备齐（历史）", SHORTAGE: "缺货异常", CANCELLED: "已取消",
};

export type QuoteItem = {
  id?: string;
  product_id?: string | null;
  product_sku_snapshot?: string | null;
  supplier_code_snapshot?: string | null;
  product_type_snapshot?: string | null;
  product_specifications_snapshot?: Record<string, string> | null;
  product_color_snapshot?: string | null;
  line_number: number;
  item_name: string;
  brand: string;
  model: string;
  quality: string;
  description: string;
  description_zh?: string | null;
  quantity: number;
  unit_price: number;
  procurement_cost: number;
  unit_cost_cny?: number | null;
  suggested_unit_price?: number | null;
  exchange_rate_snapshot?: number | null;
  pricing_rule_snapshot?: Record<string, unknown> | null;
  preparation_requirement?: string | null;
};

