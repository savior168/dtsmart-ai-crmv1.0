export type CustomerContactChannels = {
  phone?: unknown;
  phone_numbers?: unknown;
  email?: unknown;
  email_addresses?: unknown;
  wechat?: unknown;
  wechat_numbers?: unknown;
  whatsapp?: unknown;
  whatsapp_numbers?: unknown;
};

export function hasCustomerContactMethod(value: CustomerContactChannels) {
  return [value.phone, value.email, value.wechat, value.whatsapp, value.phone_numbers, value.email_addresses, value.wechat_numbers, value.whatsapp_numbers]
    .some((channel) => Array.isArray(channel) ? channel.some((entry) => String(entry ?? "").trim()) : String(channel ?? "").trim().length > 0);
}

export function customerStageContactError(stage: unknown, value: CustomerContactChannels) {
  const normalized = String(stage ?? "").trim().toUpperCase();
  const isFollowing = normalized === "FOLLOWING" || normalized === "意向客户";
  const isDeal = normalized === "DEAL" || normalized === "已成交" || normalized === "已成交客户";
  if ((!isFollowing && !isDeal) || hasCustomerContactMethod(value)) return null;
  const label = isFollowing ? "意向客户" : "已成交客户";
  return `${label}至少填写电话、邮箱、微信或 WhatsApp 其中一项`;
}

