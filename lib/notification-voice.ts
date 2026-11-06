export type VoiceNotice = {
  type: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
};

const handoffPhrases: Record<string, string> = {
  STOCK_ORDER_CREATED: "您有新的备货单待处理",
  PI_CHANGE_REQUESTED: "您有 PI 订单变更待确认",
  PI_CHANGE_APPLIED: "您的 PI 订单变更已确认",
  PI_CHANGE_REJECTED: "您的 PI 订单变更已退回，请处理",
  REGISTRATION_REVIEW: "您有新的账户审核待处理",
  PROTECTION_RENEWAL_REVIEW: "您有客户续期申请待审核",
  CUSTOMER_ADMIN_ASSIGNED: "您有新分配的客户待处理",
  CUSTOMER_HANDOVER: "您有客户交接待处理",
  FOLLOWUP_DUE: "您有客户跟进提醒",
  SYSTEM_ANNOUNCEMENT: "您有新的系统公告，请前往通知中心查看",
};

export function notificationVoiceText(notice: VoiceNotice): string | null {
  const operationDetail = String(notice.content || "").replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
  const hasActorAndAction = /^[\p{L}\p{N} ._-]{1,40}：\s*(?:为|对订单|提交|更新|更正|已确认|确认|撤回|取消|发起|退回)/u.test(operationDetail);
  if (["STOCK_ORDER_CREATED", "STOCK_STATUS_CHANGED", "PI_CHANGE_REQUESTED", "PI_CHANGE_APPLIED", "PI_CHANGE_REJECTED"].includes(notice.type)
    && hasActorAndAction) {
    return operationDetail.slice(0, 220);
  }
  const stockUpdate = notice.type === "STOCK_STATUS_CHANGED" &&
    /备货状态已更新为|更新订单\s+[A-Za-z0-9_-]{1,80}(?:[：:]|\s+的产品备货状态)/.test(notice.content || "");
  const stockStatus = notice.type === "STOCK_STATUS_CHANGED"
    ? notice.content?.match(/备货状态已更新为(缺货异常|待出货|已发货)(?=：|。|$)/)?.[1]
    : null;
  const phrase = notice.type === "STOCK_STATUS_CHANGED"
    ? !stockUpdate ? null
    : stockStatus === "缺货异常" ? "备货单出现缺货异常，请及时处理"
      : stockStatus === "待出货" ? "备货单已待出货，请核对"
        : stockStatus === "已发货" ? "备货单已发货，请跟进客户"
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
