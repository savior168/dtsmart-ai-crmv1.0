import { linkedPiUnitPrices } from "./pi-line-currency.ts";

export type PiFeeSource = "CNY" | "PAYMENT";
export type PiFeeInput = { source: PiFeeSource; amount: number };
export type PiFeesInput = {
  shipping?: PiFeeInput;
  last_balance: PiFeeInput;
  discount: PiFeeInput;
  other: PiFeeInput;
  paypal_rate_percent: number;
  show_dual_currency_prices?: boolean;
  price_display_mode?: "PAYMENT_ONLY" | "CNY_ONLY" | "DUAL";
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function convertFee(input: PiFeeInput, paymentPerCny: number) {
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 999999999999 ||
      roundMoney(input.amount) !== input.amount || !["CNY", "PAYMENT"].includes(input.source)) {
    throw new Error("附加费用须为非负且最多两位小数的金额");
  }
  const pair = linkedPiUnitPrices(input.amount.toFixed(2), input.source, paymentPerCny);
  return { cny: Number(pair.cny), payment: Number(pair.payment) };
}

/** Match the invoice's per-line converted subtotal; payment fees are rounded per component. */
export function calculatePiFees(
  subtotalCny: number,
  subtotalPayment: number,
  shippingCny: number,
  paymentPerCny: number,
  paymentMethod: string,
  input: PiFeesInput,
) {
  if (![subtotalCny, subtotalPayment, shippingCny, paymentPerCny].every(Number.isFinite) ||
      Math.min(subtotalCny, subtotalPayment, shippingCny) < 0 || paymentPerCny <= 0) {
    throw new Error("PI产品、运费或汇率不正确");
  }
  const lastBalance = convertFee(input.last_balance, paymentPerCny);
  const discount = convertFee(input.discount, paymentPerCny);
  const other = convertFee(input.other, paymentPerCny);
  const shipping = input.shipping ? convertFee(input.shipping, paymentPerCny) : { cny: shippingCny, payment: roundMoney(shippingCny * paymentPerCny) };
  if (Math.abs(shipping.cny - shippingCny) > 0.001) throw new Error("运费双币种换算不一致");
  const shippingPayment = shipping.payment;
  const grossCny = roundMoney(subtotalCny + shippingCny + lastBalance.cny + other.cny);
  const grossPayment = roundMoney(subtotalPayment + shippingPayment + lastBalance.payment + other.payment);
  if (discount.cny > grossCny || discount.payment > grossPayment) {
    throw new Error("折扣不得超过产品、运费、未付尾款和其他费用之和");
  }
  const baseCny = roundMoney(grossCny - discount.cny);
  const basePayment = roundMoney(grossPayment - discount.payment);
  const paypalRatePercent = paymentMethod === "PayPal" ? input.paypal_rate_percent : 0;
  if (!Number.isFinite(paypalRatePercent) || paypalRatePercent < 0 || paypalRatePercent > 100 ||
      Math.round(paypalRatePercent * 10000) !== paypalRatePercent * 10000) {
    throw new Error("PayPal 手续费百分比须在 0% 至 100% 之间，最多四位小数");
  }
  const paypalFee = {
    cny: roundMoney(baseCny * paypalRatePercent / 100),
    payment: roundMoney(basePayment * paypalRatePercent / 100),
  };
  return {
    lastBalance, discount, other, paypalRatePercent, paypalFee, shippingPayment,
    totalCny: roundMoney(baseCny + paypalFee.cny),
    totalPayment: roundMoney(basePayment + paypalFee.payment),
  };
}

