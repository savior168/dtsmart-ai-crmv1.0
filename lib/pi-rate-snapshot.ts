import { isRecentRateDate, type ReferenceRate } from "./pi-rate-sources";

export type RateSnapshot = {
  currency: string;
  cny_per_unit: number;
  source: ReferenceRate["source"];
  reference_date: string;
};

export function mergeReferenceRates(
  fresh: Record<string, ReferenceRate>,
  snapshots: RateSnapshot[],
  now = Date.now(),
): Record<string, ReferenceRate> {
  const result = { ...fresh };
  for (const row of snapshots) {
    if (!isRecentRateDate(row.reference_date, now) || !Number.isFinite(row.cny_per_unit) || row.cny_per_unit <= 0) continue;
    const existing = result[row.currency];
    if (!existing || (row.source === "CFETS" && existing.source !== "CFETS")
      || (row.source === existing.source && row.reference_date > existing.date)) {
      result[row.currency] = { cny: row.cny_per_unit, date: row.reference_date, source: row.source };
    }
  }
  return result;
}

export function shouldSaveSnapshot(current: RateSnapshot | undefined, incoming: ReferenceRate, now = Date.now()) {
  if (!current || !isRecentRateDate(current.reference_date, now)) return true;
  if (current.source === "CFETS" && incoming.source !== "CFETS") return false;
  if (current.source !== "CFETS" && incoming.source === "CFETS") return true;
  return incoming.date >= current.reference_date;
}
