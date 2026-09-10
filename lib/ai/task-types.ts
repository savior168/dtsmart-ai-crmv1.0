export const AI_TASK_STATUSES = ["QUEUED", "RUNNING", "PAUSING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

export const AI_STRATEGIES = ["SMART", "DEEP"] as const;
export type AiStrategy = (typeof AI_STRATEGIES)[number];

export const AI_COST_MODES = ["ADAPTIVE", "FREE_ONLY"] as const;
export type AiCostMode = (typeof AI_COST_MODES)[number];

export const AI_EXECUTION_MODES = ["AUTO", "LOCAL_ONLY", "VERCEL_ONLY"] as const;
export type AiExecutionMode = (typeof AI_EXECUTION_MODES)[number];

export const AI_EXECUTION_MODE_LABELS: Record<AiExecutionMode, string> = {
  AUTO: "自动调度（推荐）",
  LOCAL_ONLY: "仅本地执行",
  VERCEL_ONLY: "仅云端执行",
};

export const AI_COST_MODE_LABELS: Record<AiCostMode, string> = {
  ADAPTIVE: "智能分析（高性价比）",
  FREE_ONLY: "快速分析（完全免费）",
};

export const AI_STRATEGY_LABELS: Record<AiStrategy, string> = {
  SMART: "智能分析",
  DEEP: "深度分析",
};

export const AI_CHANNEL_ORDER = ["website", "google_maps", "linkedin", "facebook", "instagram", "tiktok", "other"] as const;
export type AiChannel = (typeof AI_CHANNEL_ORDER)[number];

export const AI_CHANNEL_LABELS: Record<AiChannel, string> = {
  website: "客户官网",
  google_maps: "Google商家主页",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  other: "其他公开渠道",
};

export type AiTaskFilters = {
  search?: string;
  country?: string;
  source_channel?: string;
  source_batch?: string;
  date_from?: string;
  date_to?: string;
};
