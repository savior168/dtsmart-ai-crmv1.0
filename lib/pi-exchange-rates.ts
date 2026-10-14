import { parseCfetsSafeHtml } from "@/lib/pi-cfets-feed";
import { parseFrankfurterCnyRates, type ReferenceRate } from "@/lib/pi-rate-sources";
export { businessRate } from "@/lib/pi-exchange-rate-math";

export type RateRule = {
  currency: string;
  adjustment_mode: "OFFSET" | "PERCENT" | "FIXED";
  adjustment_value: number;
  manual_reference_cny: number | null;
  updated_at: string;
};

export async function loadCfetsReferenceRates() {
  const response = await fetch("https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do", {
    next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("中国外汇交易中心参考汇率暂不可用");
  return parseCfetsSafeHtml(await response.text());
}

export async function loadReferenceRates(): Promise<Record<string, ReferenceRate>> {
  const [cfets, blended] = await Promise.allSettled([
    loadCfetsReferenceRates(),
    fetch("https://api.frankfurter.dev/v2/rates?base=CNY", {
      next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000),
    }).then(async (response) => {
      if (!response.ok) throw new Error("汇总参考汇率暂不可用");
      return parseFrankfurterCnyRates(await response.json());
    }),
  ]);
  const rates: Record<string, ReferenceRate> = blended.status === "fulfilled" ? blended.value : {};
  if (cfets.status === "fulfilled") {
    for (const [currency, rate] of Object.entries(cfets.value)) rates[currency] = rate;
  }
  return rates;
}
