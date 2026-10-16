type ToastCandidate = { id: string; read_at: string | null; dismissed_at: string | null; deliver_at: string };
type ToastMessage = { type: string; title?: string; content?: string | null; action_status?: string; metadata?: Record<string, unknown> | null };

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
  const stockSubject = orderNumber ? `订单 ${orderNumber}` : "备货单";
  const subjectSuffix = orderNumber ? " " : "";
  if (item.type === "STOCK_ORDER_CREATED") return `销售员提交了新备货单${order}，请及时安排备货。`;
  if (item.type === "STOCK_STATUS_CHANGED") {
    if (item.title === "PI备货单已撤回" || content.includes("已撤回，请勿继续备货"))
      return `销售员撤回了 PI 备货单${order}，请停止备货并核对。`;
    if (item.title === "订单已取消") return `销售员取消了${stockSubject}，请及时核对。`;
    const actor = (content.match(/^([\p{L}\p{N} ._-]{1,40})\s+(?:更新|更正|已确认)/u)?.[1] || "仓库员").trim();
    const actorName = /^[A-Za-z0-9]/.test(actor) ? `${actor} ` : actor;
    if (item.title === "备货单已确认") return `${actorName}确认了${orderNumber ? `${stockSubject} 的备货单` : "备货单"}，请查看。`;
    if (content.includes("缺货异常")) return `${actorName}报告了${stockSubject}${subjectSuffix}的缺货异常，请及时处理。`;
    if (content.includes("已取消")) return `${actorName}取消了${stockSubject}，请及时核对。`;
    if (content.includes("更正")) return `${actorName}更正了${stockSubject}${subjectSuffix}的备货进度，请核对。`;
    return `${actorName}更新了${stockSubject}${subjectSuffix}的备货状态，请查看。`;
  }
  if (item.type === "PI_CHANGE_REQUESTED") return `销售员提交了 PI 变更请求${order}，请及时确认。`;
  if (item.type === "PI_CHANGE_APPLIED") return `仓库员确认了 PI 变更${order}，请核对。`;
  if (item.type === "PI_CHANGE_REJECTED") return `仓库员退回了 PI 变更${order}，请及时处理。`;
  if (item.type === "REGISTRATION_REVIEW") return "新用户提交了账号申请，请管理员及时审核。";
  if (item.type === "SYSTEM_ANNOUNCEMENT") return "管理员发布了系统公告，请查看。";
  if (item.type === "CUSTOMER_ADMIN_ASSIGNED") {
    const count = content.match(/分配了\s*(\d+)\s*个客户/)?.[1];
    return `管理员向您分配了${count ? ` ${count} 个` : "新"}客户，请及时跟进。`;
  }
  const concise = content.length > 90 ? `${content.slice(0, 89)}…` : content;
  const prompt = item.action_status === "PENDING" ? "请及时处理。" : "请查看详情。";
  return concise ? `${concise.replace(/[。！；;\s]+$/, "")}。${prompt}` : prompt;
}
