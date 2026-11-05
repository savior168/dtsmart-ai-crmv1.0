const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function businessDay(value: string) {
  const parts = Object.fromEntries(calendar.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The API uses an exclusive UTC end; chart periods use inclusive Shanghai business days. */
export function performanceTrendPeriods(from: string, exclusiveTo: string) {
  const first = businessDay(from);
  const last = businessDay(new Date(Date.parse(exclusiveTo) - 1).toISOString());
  const start = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const granularity: "day" | "month" | "year" = days <= 62 ? "day" : days <= 3650 ? "month" : "year";
  const cursor = new Date(start);
  if (granularity !== "day") cursor.setUTCDate(1);
  if (granularity === "year") cursor.setUTCMonth(0);
  const periods: string[] = [];
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    periods.push(granularity === "day" ? day : granularity === "month" ? day.slice(0, 7) : day.slice(0, 4));
    if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  const bucketFor = (timestamp: string) => {
    const day = businessDay(timestamp);
    return granularity === "day" ? day : granularity === "month" ? day.slice(0, 7) : day.slice(0, 4);
  };
  return { granularity, periods, bucketFor };
}
