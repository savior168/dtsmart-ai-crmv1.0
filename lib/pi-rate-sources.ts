export type ReferenceRate = {
  cny: number;
  date: string;
  source: "CFETS" | "AGGREGATED" | "BAIDU_FINSCOPE";
  updatedAt?: string;
};

export const BAIDU_DISCOUNT_CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD"] as const;
export type BaiduDiscountCurrency = (typeof BAIDU_DISCOUNT_CURRENCIES)[number];

type BaiduExchangePayload = {
  ResultCode?: number | string;
  Result?: {
    from_currency?: { code?: unknown };
    to_currency?: { code?: unknown; num?: unknown };
    update_time?: unknown;
  };
};

export function parseBaiduFinScopeReferenceRate(payload: unknown, currency: BaiduDiscountCurrency, now = Date.now()): ReferenceRate {
  if (!payload || typeof payload !== "object") throw new Error("百度汇率响应格式不正确");
  const result = payload as BaiduExchangePayload;
  const quote = result.Result;
  const rate = typeof quote?.to_currency?.num === "number" ? quote.to_currency.num
    : typeof quote?.to_currency?.num === "string" ? Number(quote.to_currency.num) : NaN;
  const updatedAt = typeof quote?.update_time === "string" ? quote.update_time.trim() : "";
  const dateMatch = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}(?::\d{2})?$/.exec(updatedAt);
  const timestamp = dateMatch ? Date.parse(updatedAt.replace(" ", "T") + "+08:00") : NaN;
  if ((result.ResultCode !== 0 && result.ResultCode !== "0")
    || quote?.from_currency?.code !== currency || quote?.to_currency?.code !== "CNY"
    || !Number.isFinite(rate) || rate <= 0 || !dateMatch || !isRecentRateDate(dateMatch[1], now)
    || !Number.isFinite(timestamp) || timestamp > now + 5 * 60_000) {
    throw new Error("百度汇率报价无效或已过期");
  }
  return { cny: rate, date: dateMatch[1], updatedAt, source: "BAIDU_FINSCOPE" };
}

type FrankfurterRow = { date?: unknown; base?: unknown; quote?: unknown; rate?: unknown };

export function isRecentRateDate(date: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const observed = Date.parse(`${date}T00:00:00Z`);
  const days = (now - observed) / 86400000;
  return Number.isFinite(days) && days >= -1 && days <= 7;
}

// Frankfurter quotes foreign currency per 1 CNY; PI rules store CNY per 1 foreign currency.
export function parseFrankfurterCnyRates(payload: unknown, now = Date.now()): Record<string, ReferenceRate> {
  if (!Array.isArray(payload)) throw new Error("汇总参考汇率格式不正确");
  const rates: Record<string, ReferenceRate> = {};
  for (const item of payload as FrankfurterRow[]) {
    if (item?.base !== "CNY" || typeof item.quote !== "string" || !/^[A-Z]{3}$/.test(item.quote)
      || typeof item.date !== "string" || !isRecentRateDate(item.date, now)
      || typeof item.rate !== "number" || !Number.isFinite(item.rate) || item.rate <= 0) continue;
    rates[item.quote] = { cny: 1 / item.rate, date: item.date, source: "AGGREGATED" };
  }
  return rates;
}
