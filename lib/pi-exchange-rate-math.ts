export type AdjustmentMode = "OFFSET" | "PERCENT" | "FIXED";

import { BAIDU_DISCOUNT_CURRENCIES } from "./pi-rate-sources";

export function roundReferenceRateToTwoDecimals(reference: number) {
  return Number((Math.round((reference + Number.EPSILON) * 100) / 100).toFixed(2));
}

export function businessRateForCurrency(
  currency: string,
  reference: number | null,
  rule?: { adjustment_mode: AdjustmentMode; adjustment_value: number },
) {
  if ((BAIDU_DISCOUNT_CURRENCIES as readonly string[]).includes(currency)) {
    const effectiveRule = rule ?? { adjustment_mode: "OFFSET" as const, adjustment_value: -0.1 };
    if (effectiveRule.adjustment_mode === "FIXED") return businessRate(reference, effectiveRule);
    if (reference == null || !Number.isFinite(reference) || reference <= 0) return null;
    return businessRate(roundReferenceRateToTwoDecimals(reference), effectiveRule);
  }
  return businessRate(reference, rule);
}

export function paymentPerCny(cnyPerPayment: number) {
  return Number.isFinite(cnyPerPayment) && cnyPerPayment > 0
    ? Math.round((1 / cnyPerPayment) * 1e12) / 1e12 : 0;
}

export function cnyPerPayment(paymentPerCnyRate: number) {
  return Number.isFinite(paymentPerCnyRate) && paymentPerCnyRate > 0
    ? Number((1 / paymentPerCnyRate).toPrecision(12)) : 0;
}

export function businessRate(reference: number | null, rule?: { adjustment_mode: AdjustmentMode; adjustment_value: number }) {
  if (rule?.adjustment_mode === "FIXED") return rule.adjustment_value > 0 ? rule.adjustment_value : null;
  if (reference == null || !Number.isFinite(reference) || reference <= 0) return null;
  const calculated = rule?.adjustment_mode === "PERCENT"
    ? reference * (1 + rule.adjustment_value / 100)
    : reference + (rule?.adjustment_value || 0);
  return calculated > 0 && Number.isFinite(calculated) ? Number(calculated.toPrecision(12)) : null;
}
