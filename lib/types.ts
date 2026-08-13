export type CustomerStatus = "UNCLAIMED" | "CLAIMED" | "FOLLOWING" | "QUOTE" | "DEAL" | "RELEASED";

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
  address: string | null;
  industry: string | null;
  category: string | null;
  source: string | null;
  tags: string[];
  ai_score: number | null;
  ai_level: string | null;
  ai_reason: string | null;
  status: CustomerStatus;
  owner_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

export const CUSTOMER_STATUSES: CustomerStatus[] = ["UNCLAIMED", "CLAIMED", "FOLLOWING", "QUOTE", "DEAL", "RELEASED"];

export const AI_LEVELS = ["S", "A", "B", "C", "D"] as const;

export const AI_INDUSTRIES = [
  "手机维修店",
  "手机配件批发商",
  "手机配件零售商",
  "手机进口商",
  "电脑维修店",
  "电脑配件批发商",
  "其他",
] as const;

export type FollowupType = "EMAIL" | "WHATSAPP" | "PHONE" | "LINKEDIN" | "OTHER";

export type Followup = {
  id: string;
  customer_id: string;
  user_id: string;
  type: FollowupType;
  content: string;
  attachment: string | null;
  next_follow_date: string | null;
  created_at: string;
  creator?: { name: string | null; email: string } | null;
};

export const FOLLOWUP_TYPES: FollowupType[] = ["EMAIL", "WHATSAPP", "PHONE", "LINKEDIN", "OTHER"];
