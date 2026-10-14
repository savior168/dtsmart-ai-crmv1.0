export type ReferenceRate = {
  cny: number;
  date: string;
  source: "CFETS" | "AGGREGATED";
};

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
