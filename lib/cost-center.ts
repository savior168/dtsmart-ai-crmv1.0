export type CostPeriod = "official" | "test" | "all";

export function normalizeCostPeriod(value: string | null): CostPeriod {
  return value === "test" || value === "all" ? value : "official";
}

export function costPeriodRange(input: {
  period: CostPeriod;
  accountingStartAt: string;
  from?: string | null;
  to?: string | null;
}) {
  const accountingStart = new Date(input.accountingStartAt);
  const requestedFrom = input.from
    ? new Date(`${input.from}T00:00:00+08:00`)
    : input.period === "official"
      ? accountingStart
      : new Date("1970-01-01T00:00:00.000Z");
  const requestedTo = input.to
    ? new Date(`${input.to}T23:59:59.999+08:00`)
    : new Date();
  if (![accountingStart, requestedFrom, requestedTo].every((value) => Number.isFinite(value.getTime()))) {
    throw new Error("日期范围不正确");
  }
  let from = requestedFrom;
  let to = requestedTo;
  if (input.period === "official" && from < accountingStart) from = accountingStart;
  if (input.period === "test" && to > accountingStart) to = accountingStart;
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    empty: from >= to,
  };
}

