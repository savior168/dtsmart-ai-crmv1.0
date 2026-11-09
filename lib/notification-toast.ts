type ToastCandidate = { id: string; read_at: string | null; dismissed_at: string | null; deliver_at: string };
type ToastMessage = { type: string; title?: string; content?: string | null; action_status?: string; metadata?: Record<string, unknown> | null };

export type AnnouncementTone = "information" | "warning" | "critical" | "success";

/** Use the published title, not arbitrary body words, to avoid elevating a release note into an incident. */
export function announcementTone(notice: { type: string; title?: string | null }): AnnouncementTone {
  if (notice.type !== "SYSTEM_ANNOUNCEMENT") return "information";
  const title = notice.title || "";
  if (/^系统故障通知|^服务暂停通知/.test(title)) return "critical";
  if (/^系统维护中/.test(title)) return "warning";
  if (/^服务恢复通知/.test(title)) return "success";
  return "information";
}

const stockStageLabels: Record<string, string> = {
  DRAFT: "待完善备货信息", WAITING: "待仓库接单", PREPARING: "采购中",
  RECEIVED: "已回齐待理货", SORTING: "理货中", READY_TO_SHIP: "已理货待交货代",
  SHIPPED: "已交货代", READY: "已备齐（历史）", SHORTAGE: "缺货异常", CANCELLED: "已取消",
};

export function notificationDisplayContent(content: string | null | undefined) {
  return (content || "—").replace(/\b(DRAFT|WAITING|PREPARING|RECEIVED|SORTING|READY_TO_SHIP|SHIPPED|SHORTAGE|CANCELLED|READY)\b/g,
    (status) => stockStageLabels[status] || status);
}

export function shouldShowNotificationToast(item: ToastCandidate, shown: ReadonlySet<string>, sessionStartedAt: string | null) {
  if (!sessionStartedAt) return false;
  const deliveredAt = Date.parse(item.deliver_at);
  const startedAt = Date.parse(sessionStartedAt);
  return Number.isFinite(deliveredAt) && Number.isFinite(startedAt) && deliveredAt > startedAt
    && !item.read_at && !item.dismissed_at && !shown.has(item.id);
}

export function notificationToastStorageKey(userEmail: string) {
  return `dtsmart-notification-toasts:${userEmail}`;
}

export function notificationToastSessionKey(userEmail: string) {
  return `dtsmart-notification-session-start:${userEmail}`;
}

export function notificationToastSummary(item: ToastMessage) {
  const content = String(item.content || "").replace(/\s+/g, " ").trim();
  const orderNumber = typeof item.metadata?.order_number === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(item.metadata.order_number)
    ? item.metadata.order_number : content.match(/订单\s+([A-Za-z0-9_-]{1,80})/)?.[1];
  const order = orderNumber ? ` ${orderNumber}` : "";
  if (item.type === "STOCK_ORDER_CREATED") return content || `收到新备货单${order}，请及时安排备货。`;
  if (item.type === "STOCK_STATUS_CHANGED") {
    // The database/API supplies the actor, business order number, and operation detail.
    // Do not replace that audit context with a generic “仓库员更新状态” summary.
    if (content) return content;
    if (item.title === "PI备货单已撤回") return `PI 备货单${order}已撤回，请停止备货并核对。`;
    return `备货单${order}有更新，请查看详情。`;
  }
  if (["PI_CHANGE_REQUESTED", "PI_CHANGE_APPLIED", "PI_CHANGE_REJECTED"].includes(item.type)) {
    if (content) return content;
    if (item.type === "PI_CHANGE_REQUESTED") return `PI 订单变更${order}待确认。`;
    if (item.type === "PI_CHANGE_APPLIED") return `PI 订单变更${order}已同步备货单，请核对。`;
    return `PI 订单变更${order}已退回，请处理。`;
  }
  if (item.type === "REGISTRATION_REVIEW") return "新用户提交了账号申请，请管理员及时审核。";
  if (item.type === "SYSTEM_ANNOUNCEMENT") return content.length > 150 ? `${content.slice(0, 149)}…` : content || "请查看公告详情。";
  if (item.type === "CUSTOMER_ADMIN_ASSIGNED") {
    const count = content.match(/分配了\s*(\d+)\s*个客户/)?.[1];
    return `管理员向您分配了${count ? ` ${count} 个` : "新"}客户，请及时跟进。`;
  }
  const concise = content.length > 90 ? `${content.slice(0, 89)}…` : content;
  const prompt = item.action_status === "PENDING" ? "请及时处理。" : "请查看详情。";
  return concise ? `${concise.replace(/[。！；;\s]+$/, "")}。${prompt}` : prompt;
}
