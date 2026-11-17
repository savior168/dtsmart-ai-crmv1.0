import type { PiAmendmentRecord } from "./pi-amendment-view";

export type PiAmendmentHighlight = "ADDED" | "CHANGED" | "REMOVED";

// Highlight only the latest applied revision. Pending and rejected requests
// must never change the appearance of the effective PI or stock order.
export function latestAppliedPiAmendmentHighlights(records: PiAmendmentRecord[]) {
  const latest = records.filter((record) => record.status === "APPLIED")
    .sort((a, b) => Number(b.applied_revision || 0) - Number(a.applied_revision || 0))[0];
  const result = new Map<string, PiAmendmentHighlight>();
  if (!latest) return result;
  const before = new Map(latest.before_items.map((row) => [String(row.id), row]));
  const after = new Map(latest.proposed_items.map((row) => [String(row.id), row]));
  for (const [id, oldRow] of before) {
    const newRow = after.get(id);
    if (!newRow) result.set(id, "REMOVED");
    else if (["item_name", "brand", "model", "quality", "description", "description_zh",
      "preparation_requirement", "internal_note", "quantity", "unit_price_cny", "estimated_unit_cost_cny"]
      .some((field) => String(oldRow[field] ?? "") !== String(newRow[field] ?? ""))) result.set(id, "CHANGED");
  }
  for (const id of after.keys()) if (!before.has(id)) result.set(id, "ADDED");
  return result;
}
