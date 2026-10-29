import { parseCfetsSafeHtml } from "@/lib/pi-cfets-feed";
import { BAIDU_DISCOUNT_CURRENCIES, parseBaiduFinScopeReferenceRate, parseFrankfurterCnyRates, type BaiduDiscountCurrency, type ReferenceRate } from "@/lib/pi-rate-sources";
export { businessRate, businessRateForCurrency, roundReferenceRateToTwoDecimals } from "@/lib/pi-exchange-rate-math";

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

export async function loadBaiduFinScopeReferenceRates(currencies: readonly BaiduDiscountCurrency[] = BAIDU_DISCOUNT_CURRENCIES, fresh = false): Promise<Record<string, ReferenceRate>> {
  const results = await Promise.allSettled(currencies.map(async (currency) => {
    const url = new URL("https://finance.pae.baidu.com/vapi/v1/exchangebycode");
    url.searchParams.set("from_code", currency);
    url.searchParams.set("to_code", "CNY");
    url.searchParams.set("finClientType", "pc");
    const response = await fetch(url, fresh ? { cache: "no-store", signal: AbortSignal.timeout(8000) } : { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("百度实时汇率暂不可用");
    return [currency, parseBaiduFinScopeReferenceRate(await response.json(), currency)] as const;
  }));
  return Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
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
