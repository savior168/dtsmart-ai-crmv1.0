export const DASHBOARD_BASE_DATE = "2026-08-01";
export type DashboardDatePreset = "HISTORY" | "WEEK" | "MONTH" | "QUARTER";

function localDate(value: Date) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

export function dashboardDatePresetRange(preset: DashboardDatePreset, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "WEEK") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === "MONTH") start.setDate(1);
  if (preset === "QUARTER") start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  return { from: preset === "HISTORY" ? DASHBOARD_BASE_DATE : localDate(start), to: localDate(today) };
}
