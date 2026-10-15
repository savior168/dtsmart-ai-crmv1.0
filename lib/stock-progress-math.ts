export type PhysicalStockItem = {
  quantity: number;
  received_quantity: number | null;
  prepared_quantity?: number | null;
  shipped_quantity?: number | null;
  preparation_status?: string | null;
};

/** The five counts partition every ordered unit; percentages always total 100. */
export function physicalStockBuckets(items: PhysicalStockItem[]) {
  const ordered = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const received = items.reduce((sum, item) => sum + Number(item.received_quantity || 0), 0);
  const prepared = items.reduce((sum, item) => sum + Number(item.prepared_quantity || 0), 0);
  const shipped = items.reduce((sum, item) => sum + Number(item.shipped_quantity || 0), 0);
  const notStarted = items.reduce((sum, item) => sum + (!item.preparation_status || item.preparation_status === "WAITING"
    ? Number(item.quantity || 0) - Number(item.received_quantity || 0) : 0), 0);
  const counts = [notStarted, ordered - received - notStarted, received - prepared, prepared - shipped, shipped];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) || !Number.isSafeInteger(ordered)) {
    throw new Error("备货实物数量异常，请联系管理员核对记录");
  }
  if (!ordered) return { ordered, received, prepared, shipped, counts, percents: counts.map(() => 0) };
  const exact = counts.map((count) => count * 100 / ordered);
  const percents = exact.map(Math.floor);
  let remainder = 100 - percents.reduce((sum, value) => sum + value, 0);
  const indices = counts.map((_, index) => index)
    .sort((a, b) => (exact[b] - percents[b]) - (exact[a] - percents[a]) || a - b);
  for (const index of indices) {
    if (remainder-- <= 0) break;
    percents[index]++;
  }
  return { ordered, received, prepared, shipped, counts, percents };
}
