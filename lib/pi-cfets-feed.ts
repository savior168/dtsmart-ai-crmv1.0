import { isRecentRateDate, type ReferenceRate } from "./pi-rate-sources";

// SAFE republishes CFETS' PBOC-authorized daily central parities in this fixed order.
// The first 10 columns are CNY per 100 foreign units; the remaining 15 are foreign units per 100 CNY.
const DIRECT = ["USD", "EUR", "JPY", "HKD", "GBP", "AUD", "NZD", "SGD", "CHF", "CAD"] as const;
const INDIRECT = ["MOP", "MYR", "RUB", "ZAR", "KRW", "AED", "SAR", "HUF", "PLN", "DKK", "SEK", "NOK", "TRY", "MXN", "THB"] as const;
const CURRENCIES = [...DIRECT, ...INDIRECT];

export function parseCfetsSafeHtml(html: string, now = Date.now()): Record<string, ReferenceRate> {
  if (!html.includes("人民币汇率中间价列表")) throw new Error("中国外汇交易中心汇率页面格式不正确");
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of withoutComments.matchAll(/<tr\b[^>]*class=["'][^"']*\bfirst\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => cell[1].replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim());
    if (cells.length !== 26 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) || !isRecentRateDate(cells[0], now)) continue;
    const values = cells.slice(1).map(Number);
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) continue;
    const rates: Record<string, ReferenceRate> = {};
    CURRENCIES.forEach((currency, index) => {
      rates[currency] = {
        cny: index < DIRECT.length ? values[index] / 100 : 100 / values[index],
        date: cells[0], source: "CFETS",
      };
    });
    return rates;
  }
  throw new Error("中国外汇交易中心没有近期完整的人民币汇率中间价");
}
