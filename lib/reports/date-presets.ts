/** Calendar-day presets shared by dashboard and performance analysis. */
export type BusinessDatePreset = "today" | "week" | "month" | "quarter" | "year";

export const BUSINESS_DATE_PRESETS: ReadonlyArray<{ value: BusinessDatePreset; label: string }> = [
  { value: "today", label: "今天" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "quarter", label: "本季" },
  { value: "year", label: "本年" },
];

const date = (value: Date) => value.toISOString().slice(0, 10);
const businessCalendar = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function businessDatePreset(kind: BusinessDatePreset, today = new Date()) {
  const parts = Object.fromEntries(businessCalendar.formatToParts(today).map((part) => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (kind === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (kind === "month") start.setUTCDate(1);
  if (kind === "quarter") { start.setUTCMonth(Math.floor((month - 1) / 3) * 3, 1); }
  if (kind === "year") { start.setUTCMonth(0, 1); }
  return { from: date(start), to: date(new Date(Date.UTC(year, month - 1, day))) };
}
