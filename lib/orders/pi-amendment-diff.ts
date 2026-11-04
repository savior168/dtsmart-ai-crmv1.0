export type PiAmendmentLine = {
  id: string;
  item_name: string;
  brand: string;
  model: string;
  quality: string;
  quality_en?: string;
  description?: string;
  description_en?: string;
  description_zh?: string;
  preparation_requirement?: string;
  internal_note?: string;
  quantity: number;
  unit_price_cny: number;
  estimated_unit_cost_cny: number;
};

export type StockLineProgress = { received_quantity: number; shipped_quantity: number };

export type PiLineChange = {
  id: string;
  kind: "ADDED" | "REMOVED" | "REPLACED" | "QUANTITY" | "PRICE" | "SPEC";
  before: PiAmendmentLine | null;
  after: PiAmendmentLine | null;
  // Every post-start amendment needs warehouse acknowledgement. This flag
  // additionally means existing physical stock must be reconciled first.
  physical_reconciliation_required: boolean;
};

function sameProduct(a: PiAmendmentLine, b: PiAmendmentLine) {
  return a.item_name === b.item_name && a.brand === b.brand
    && a.model === b.model && a.quality === b.quality
    && a.quality_en === b.quality_en;
}

export function diffPiAmendment(
  before: PiAmendmentLine[],
  after: PiAmendmentLine[],
  progress: Map<string, StockLineProgress>,
): PiLineChange[] {
  const oldIds = new Set(before.map((line) => line.id));
  const newIds = new Set(after.map((line) => line.id));
  if (oldIds.size !== before.length || newIds.size !== after.length
    || [...before, ...after].some((line) => !line.id || !Number.isSafeInteger(line.quantity)
      || line.quantity <= 0 || !Number.isFinite(line.unit_price_cny)
      || line.unit_price_cny < 0 || !Number.isFinite(line.estimated_unit_cost_cny)
      || line.estimated_unit_cost_cny < 0)) {
    throw new Error("PI产品明细存在重复行或无效数量、价格");
  }
  const previous = new Map(before.map((line) => [line.id, line]));
  const next = new Map(after.map((line) => [line.id, line]));
  const changes: PiLineChange[] = [];
  for (const line of before) {
    const updated = next.get(line.id) || null;
    const state = progress.get(line.id) || { received_quantity: 0, shipped_quantity: 0 };
    if (!Number.isSafeInteger(state.received_quantity) || !Number.isSafeInteger(state.shipped_quantity)
      || state.received_quantity < 0 || state.shipped_quantity < 0
      || state.shipped_quantity > state.received_quantity
      || state.received_quantity > line.quantity) throw new Error("备货进度无效");
    const kinds: PiLineChange["kind"][] = !updated ? ["REMOVED"]
      : [
        ...(!sameProduct(line, updated) ? ["REPLACED" as const] : []),
        ...(line.quantity !== updated.quantity ? ["QUANTITY" as const] : []),
        ...(line.unit_price_cny !== updated.unit_price_cny
          || line.estimated_unit_cost_cny !== updated.estimated_unit_cost_cny ? ["PRICE" as const] : []),
        ...(line.description !== updated.description
          || line.description_en !== updated.description_en
          || line.description_zh !== updated.description_zh
          || line.preparation_requirement !== updated.preparation_requirement
          || line.internal_note !== updated.internal_note ? ["SPEC" as const] : []),
      ];
    if (kinds.length && state.shipped_quantity > 0) {
      throw new Error(`第 ${line.id} 项已有交货代数量，不允许修改或删除`);
    }
    for (const kind of kinds) changes.push({ id: line.id, kind, before: line, after: updated,
      physical_reconciliation_required: state.received_quantity > 0
        && (kind === "REMOVED" || kind === "REPLACED" || kind === "SPEC"
          || kind === "QUANTITY" && updated !== null && updated.quantity < state.received_quantity),
    });
  }
  for (const line of after) if (!previous.has(line.id)) {
    changes.push({ id: line.id, kind: "ADDED", before: null, after: line,
      physical_reconciliation_required: false });
  }
  return changes;
}
