export function costLedgerRange(from?: string | null, to?: string | null) {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  const shanghaiToday = `${parts.year}-${parts.month}-${parts.day}`;
  const defaultFrom = `${parts.year}-${parts.month}-01`;
  const fromDate = new Date(`${from || defaultFrom}T00:00:00+08:00`);
  const toDate = new Date(`${to || shanghaiToday}T00:00:00+08:00`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  if (![fromDate, toDate].every((value) => Number.isFinite(value.getTime())) || fromDate >= toDate) throw new Error("日期范围不正确");
  return { from: fromDate.toISOString(), to: toDate.toISOString(), fromDate: from || defaultFrom, toDate: to || shanghaiToday };
}
