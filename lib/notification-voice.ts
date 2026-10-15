export type VoiceNotice = {
  type: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
};

const handoffPhrases: Record<string, string> = {
  STOCK_ORDER_CREATED: "您有新的备货单待处理",
  PI_CHANGE_REQUESTED: "您有 PI 订单变更待确认",
  PI_CHANGE_APPLIED: "您的 PI 订单变更已由仓库确认",
  PI_CHANGE_REJECTED: "您的 PI 订单变更被仓库退回，请处理",
  REGISTRATION_REVIEW: "您有新的账户审核待处理",
  PROTECTION_RENEWAL_REVIEW: "您有客户续期申请待审核",
  CUSTOMER_ADMIN_ASSIGNED: "您有新分配的客户待处理",
  CUSTOMER_HANDOVER: "您有客户交接待处理",
};

export function notificationVoiceText(notice: VoiceNotice): string | null {
  const stockUpdate = notice.type === "STOCK_STATUS_CHANGED" &&
    /备货状态已更新为|更新订单\s+[A-Za-z0-9_-]{1,80}(?:[：:]|\s+的产品备货状态)/.test(notice.content || "");
  const stockStatus = notice.type === "STOCK_STATUS_CHANGED"
    ? notice.content?.match(/备货状态已更新为(缺货异常|待出货|已发货)(?=：|。|$)/)?.[1]
    : null;
  const phrase = notice.type === "STOCK_STATUS_CHANGED"
    ? !stockUpdate ? null
    : stockStatus === "缺货异常" ? "备货单出现缺货异常，请销售员及时处理"
      : stockStatus === "待出货" ? "备货单已待出货，请销售员核对"
        : stockStatus === "已发货" ? "备货单已发货，请销售员跟进客户"
          : "您的备货单有新进度，请查看"
    : handoffPhrases[notice.type];
  if (!phrase) return null;
  const metadataNumber = typeof notice.metadata?.order_number === "string"
    ? notice.metadata.order_number : "";
  const number = metadataNumber || (notice.type === "STOCK_ORDER_CREATED"
    ? notice.content?.match(/PI订单\s+([A-Za-z0-9_-]{1,80})/)?.[1] || ""
    : notice.type === "STOCK_STATUS_CHANGED"
      ? notice.content?.match(/订单\s+([A-Za-z0-9_-]{1,80})/)?.[1] || "" : "");
  const safeNumber = /^[A-Za-z0-9_-]{1,80}$/.test(number) ? number : "";
  return safeNumber ? `${phrase}，订单号：${safeNumber}，请及时处理。` : `${phrase}，请及时处理。`;
}
