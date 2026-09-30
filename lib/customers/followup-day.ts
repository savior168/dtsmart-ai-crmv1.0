import { shanghaiToday } from "@/lib/cost-center";

export function followupDayBounds(now = new Date()) {
  const day = shanghaiToday(now);
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
