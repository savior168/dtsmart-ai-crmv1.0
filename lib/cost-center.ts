export type CostDateRangePreset = "TODAY" | "WEEK" | "MONTH" | "CUSTOM";

export function shanghaiToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftCalendarDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function quickCostDateRange(preset: Exclude<CostDateRangePreset, "CUSTOM">, now = new Date()) {
  const to = shanghaiToday(now);
  if (preset === "TODAY") return { from: to, to };
  if (preset === "MONTH") return { from: `${to.slice(0, 7)}-01`, to };
  const weekday = new Date(`${to}T00:00:00Z`).getUTCDay();
  return { from: shiftCalendarDate(to, -((weekday + 6) % 7)), to };
}

export function costLedgerRange(from?: string | null, to?: string | null) {
  const today = shanghaiToday();
  const defaultFrom = `${today.slice(0, 7)}-01`;
  const fromDate = new Date(`${from || defaultFrom}T00:00:00+08:00`);
  const toDate = new Date(`${to || today}T00:00:00+08:00`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  if (![fromDate, toDate].every((value) => Number.isFinite(value.getTime())) || fromDate >= toDate) throw new Error("日期范围不正确");
  return { from: fromDate.toISOString(), to: toDate.toISOString(), fromDate: from || defaultFrom, toDate: to || today };
}
