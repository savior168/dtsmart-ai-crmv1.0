export type PiUnitPriceSource = "CNY" | "PAYMENT";

export const roundPiMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const FX_SCALE = BigInt(1_000_000_000_000);

function amountCents(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

function roundRatio(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function centsText(cents: bigint) {
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}

export function linkedPiUnitPrices(amount: string, source: PiUnitPriceSource, paymentPerCny: number) {
  if (amount === "") return { cny: "", payment: "" };
  const cents = amountCents(amount);
  if (cents === null || !Number.isFinite(paymentPerCny) || paymentPerCny <= 0) {
    return { cny: source === "CNY" ? amount : "", payment: source === "PAYMENT" ? amount : "" };
  }
  const rate = BigInt(Math.round(paymentPerCny * Number(FX_SCALE)));
  if (rate <= BigInt(0)) return { cny: source === "CNY" ? amount : "", payment: source === "PAYMENT" ? amount : "" };
  return source === "CNY"
    ? { cny: amount, payment: centsText(roundRatio(cents * rate, FX_SCALE)) }
    : { cny: centsText(roundRatio(cents * FX_SCALE, rate)), payment: amount };
}
