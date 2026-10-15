import { STOCK_STATUS_LABELS } from "@/lib/types";

export type StockProgress = {
  status: string;
  percent: number;
  ordered_units: number;
  received_units: number;
};

const stagePercent: Record<string, number> = {
  WAITING: 0,
  PREPARING: 20,
  RECEIVED: 40,
  SORTING: 60,
  READY_TO_SHIP: 80,
  SHIPPED: 100,
};

/** The percentage describes workflow stages, never physical receipt volume. */
export function summarizeStockProgress(
  status: string,
  items: Array<{ quantity: number; received_quantity: number | null; preparation_status?: string | null }>,
): StockProgress {
  const ordered = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const weighted = ordered > 0 ? Math.round(items.reduce((sum, item) => sum +
    Number(item.quantity || 0) * (stagePercent[item.preparation_status || status] ?? 0), 0) / ordered) : 0;
  return {
    status,
    percent: ["DRAFT", "SHORTAGE", "CANCELLED", "READY"].includes(status) ? 0 : weighted,
    ordered_units: ordered,
    received_units: items.reduce((sum, item) => sum + Number(item.received_quantity || 0), 0),
  };
}

export function stockProgressLabel(progress: StockProgress) {
  if (progress.status === "WAITING" && progress.percent > 0) return "部分备货中";
  return STOCK_STATUS_LABELS[progress.status as keyof typeof STOCK_STATUS_LABELS] || progress.status;
}
