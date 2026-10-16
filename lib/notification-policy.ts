export const NOTIFICATION_TYPES = [
  { type: "STOCK_ORDER_CREATED", label: "新备货单", popup: true, voice: true },
  { type: "STOCK_STATUS_CHANGED", label: "整单备货状态与异常", popup: true, voice: true },
  { type: "STOCK_PROGRESS_ROUTINE", label: "逐项回货与理货数量更新", popup: false, voice: false },
  { type: "PI_CHANGE_REQUESTED", label: "PI 变更待确认", popup: true, voice: true },
  { type: "PI_CHANGE_APPLIED", label: "PI 变更已确认", popup: true, voice: true },
  { type: "PI_CHANGE_REJECTED", label: "PI 变更被退回", popup: true, voice: true },
  { type: "REGISTRATION_REVIEW", label: "新账号待审核", popup: true, voice: true },
  { type: "PROTECTION_RENEWAL_REVIEW", label: "客户保护续期待审核", popup: true, voice: true },
  { type: "CUSTOMER_ADMIN_ASSIGNED", label: "管理员分配客户", popup: true, voice: true },
  { type: "CUSTOMER_HANDOVER", label: "客户交接", popup: true, voice: true },
  { type: "FOLLOWUP_DUE", label: "客户跟进提醒", popup: false, voice: false },
  { type: "SYSTEM_ANNOUNCEMENT", label: "系统公告", popup: true, voice: false },
] as const;

export type NotificationPolicy = { type: string; popup_enabled: boolean; voice_enabled: boolean };

export function notificationPolicyType(notice: { type: string; title?: string | null }) {
  return notice.type === "STOCK_STATUS_CHANGED" && notice.title === "备货进度已更新"
    ? "STOCK_PROGRESS_ROUTINE" : notice.type;
}

export function defaultNotificationPolicy(type: string): NotificationPolicy {
  const item = NOTIFICATION_TYPES.find(candidate => candidate.type === type);
  return { type, popup_enabled: item?.popup ?? false, voice_enabled: item?.voice ?? false };
}
