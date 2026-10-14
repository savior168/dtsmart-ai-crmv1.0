import { QUOTE_CURRENCIES } from "@/lib/currencies";
import { parseEcbFeed } from "@/lib/pi-ecb-feed";
export { businessRate } from "@/lib/pi-exchange-rate-math";

export type RateRule = {
  currency: string;
  adjustment_mode: "OFFSET" | "PERCENT" | "FIXED";
  adjustment_value: number;
  manual_reference_cny: number | null;
  updated_at: string;
};

export async function loadEcbReferenceRates() {
  const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
    next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("欧洲央行参考汇率暂不可用");
  const xml = await response.text();
  const { date, perEuro } = parseEcbFeed(xml);
  const rates: Record<string, number> = {};
  for (const [currency] of QUOTE_CURRENCIES) {
    if (perEuro[currency]) rates[currency] = perEuro.CNY / perEuro[currency];
  }
  return { date, rates };
}
