export type CustomerStatus = "UNCLAIMED" | "CLAIMED" | "FOLLOWING" | "QUOTE" | "DEAL" | "RELEASED";
export type AiStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type Customer = {
  id: string;
  company_name: string;
  contact_name: string | null;
  country: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  google_url: string | null;
  store_name?: string | null;
  product_image?: string | null;
  store_score?: number | null;
  review_count?: number | null;
  address: string | null;
  industry: string | null;
  category: string | null;
  source: string | null;
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
  business_relevance?: string | null;
  customer_value?: string | null;
  followup_suggestion?: string | null;
  notes?: string | null;
  status: CustomerStatus;
  owner_id: string | null;
  owner_user_id?: string | null;
  department_id?: string | null;
  created_by?: string | null;
  last_contact_time?: string | null;
  next_followup_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at: string | null;
  owner?: { name: string | null; email: string } | null;
};

export const CUSTOMER_STATUSES: CustomerStatus[] = ["UNCLAIMED", "CLAIMED", "FOLLOWING", "QUOTE", "DEAL", "RELEASED"];
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  UNCLAIMED: "新客户", CLAIMED: "待开发", FOLLOWING: "跟进中", QUOTE: "报价中", DEAL: "已成交", RELEASED: "已释放",
};
export const AI_LEVELS = ["A", "B", "C", "D"] as const;
export const AI_INDUSTRIES = ["手机维修店", "手机配件批发商", "手机配件零售商", "手机进口商", "电脑维修店", "电脑配件批发商", "其他"] as const;

export type FollowupType = "EMAIL" | "WHATSAPP" | "PHONE" | "LINKEDIN" | "OTHER";
export type Followup = { id: string; customer_id: string; user_id: string; type: FollowupType; content: string; attachment: string | null; next_follow_date: string | null; created_at: string; creator?: { name: string | null; email: string } | null };
export const FOLLOWUP_TYPES: FollowupType[] = ["EMAIL", "WHATSAPP", "PHONE", "LINKEDIN", "OTHER"];
export const FOLLOWUP_TYPE_LABELS: Record<FollowupType, string> = { EMAIL: "邮件", WHATSAPP: "WhatsApp", PHONE: "电话", LINKEDIN: "LinkedIn", OTHER: "其他" };
