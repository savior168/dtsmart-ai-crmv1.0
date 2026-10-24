export const SYSTEM_ANNOUNCEMENT_TYPES = [
  { value: "GENERAL", label: "一般通知" },
  { value: "MAINTENANCE", label: "系统维护" },
  { value: "INCIDENT", label: "故障修复" },
  { value: "UPGRADE", label: "功能升级" },
  { value: "OPTIMIZATION", label: "体验优化" },
  { value: "SECURITY", label: "安全提醒" },
  { value: "POLICY", label: "规则/流程调整" },
] as const;

export const SYSTEM_ANNOUNCEMENT_PRIORITIES = [
  { value: "STANDARD", label: "普通" },
  { value: "IMPORTANT", label: "重要" },
  { value: "URGENT", label: "紧急" },
] as const;

export type SystemAnnouncementType = (typeof SYSTEM_ANNOUNCEMENT_TYPES)[number]["value"];
export type SystemAnnouncementPriority = (typeof SYSTEM_ANNOUNCEMENT_PRIORITIES)[number]["value"];

export function systemAnnouncementPriorityRank(value: unknown) {
  if (value === "URGENT") return 2;
  if (value === "IMPORTANT") return 1;
  return 0;
}

export function systemAnnouncementTypeLabel(value: unknown) {
  return SYSTEM_ANNOUNCEMENT_TYPES.find(item => item.value === value)?.label || "一般通知";
}
