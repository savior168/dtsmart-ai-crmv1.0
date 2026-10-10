export const DASHBOARD_BASE_DATE = "2026-08-01";
export type DashboardDatePreset = "WEEK" | "MONTH" | "QUARTER" | "YEAR";

function businessDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

function dateKey(value: Date) { return value.toISOString().slice(0, 10); }

export function dashboardBusinessDateKey(value: Date) { return dateKey(businessDay(value)); }

export function dashboardDefaultDateRange(today = new Date()) {
  return { from: DASHBOARD_BASE_DATE, to: dateKey(businessDay(today)) };
}

export function dashboardDatePresetRange(preset: DashboardDatePreset, today = new Date()) {
  const day = businessDay(today);
  const start = new Date(day);
  if (preset === "WEEK") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (preset === "MONTH") start.setUTCDate(1);
  if (preset === "QUARTER") start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
  if (preset === "YEAR") start.setUTCMonth(0, 1);
  return { from: dateKey(start), to: dateKey(day) };
}
