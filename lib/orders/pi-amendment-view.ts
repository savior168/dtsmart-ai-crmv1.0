type SnapshotLine = Record<string, unknown>;
export type PiAmendmentRecord = {
  id: string;
  status: string;
  base_revision: number;
  applied_revision: number | null;
  reason: string;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  before_items: SnapshotLine[];
  proposed_items: SnapshotLine[];
};

export type WarehousePiChange = Omit<PiAmendmentRecord, "before_items" | "proposed_items"> & {
  changes: Array<{ kind: "新增" | "删除" | "修改"; line_number: number | null;
    before: Record<string, unknown> | null; after: Record<string, unknown> | null;
    sales_price_changed: boolean; seller_cost_changed: boolean }>;
};

// Warehouse-facing snapshots must not expose sales price or seller cost.
function warehouseLine(row: SnapshotLine) {
  return {
    item_name: String(row.item_name || ""),
    brand: String(row.brand || ""),
    model: String(row.model || ""),
    quality: String(row.quality || ""),
    description: String(row.description || ""),
    description_zh: String(row.description_zh || ""),
    preparation_requirement: String(row.preparation_requirement || ""),
    internal_note: String(row.internal_note || ""),
    quantity: Number(row.quantity || 0),
  };
}

export function warehousePiAmendment(record: PiAmendmentRecord): WarehousePiChange {
  const before = new Map(record.before_items.map((row) => [String(row.id), row]));
  const after = new Map(record.proposed_items.map((row) => [String(row.id), row]));
  const changes: WarehousePiChange["changes"] = [];
  for (const row of record.before_items) {
    const newer = after.get(String(row.id));
    const original = warehouseLine(row);
    const revised = newer ? warehouseLine(newer) : null;
    const salesPriceChanged = Boolean(newer && Number(newer.unit_price_cny) !== Number(row.unit_price_cny));
    const sellerCostChanged = Boolean(newer && Number(newer.estimated_unit_cost_cny) !== Number(row.estimated_unit_cost_cny));
    if (!revised || JSON.stringify(original) !== JSON.stringify(revised) || salesPriceChanged || sellerCostChanged) {
      changes.push({ kind: revised ? "修改" : "删除", line_number: Number(row.line_number),
        before: original, after: revised, sales_price_changed: salesPriceChanged,
        seller_cost_changed: sellerCostChanged });
    }
  }
  for (const row of record.proposed_items) if (!before.has(String(row.id))) {
    changes.push({ kind: "新增", line_number: null, before: null, after: warehouseLine(row),
      sales_price_changed: false, seller_cost_changed: false });
  }
  return { id: record.id, status: record.status, base_revision: record.base_revision,
    applied_revision: record.applied_revision, reason: record.reason,
    decision_note: record.decision_note, created_at: record.created_at,
    decided_at: record.decided_at, changes };
}
