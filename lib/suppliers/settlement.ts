export function isHalfMonthSettlement(cycle: string, days: number | null) {
  return cycle === "SEMI_MONTHLY" || (cycle === "NET_DAYS" && days === 15);
}

export function settlementDisplay(cycle: string, days: number | null, original?: string | null) {
  if (isHalfMonthSettlement(cycle, days)) return "半月结（15天）";
  return original?.trim() || (cycle === "NET_DAYS" ? `${days ?? "—"}天` : ({
    CASH: "现金结", WEEKLY: "周结", MONTHLY: "月结", OTHER: "其他", UNSET: "待补充",
  } as Record<string, string>)[cycle] || cycle);
}
