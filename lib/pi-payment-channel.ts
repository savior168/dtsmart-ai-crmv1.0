export const PI_PAYMENT_CHANNELS = [
  "T/T Bank Transfer", "Alipay", "PayPal", "Wise Transfer", "Payoneer Transfer",
] as const;

export type PiPaymentChannel = typeof PI_PAYMENT_CHANNELS[number] | "OTHER";

export function piPaymentChannel(method: string): PiPaymentChannel {
  return PI_PAYMENT_CHANNELS.find((channel) => channel === method) || "OTHER";
}
