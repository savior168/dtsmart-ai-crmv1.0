import { STOCK_STATUS_LABELS } from "@/lib/types";
import { physicalStockBuckets, type PhysicalStockItem } from "./stock-progress-math";

export const STOCK_BUCKETS = [
  { key: "pending", label: "未回货", color: "bg-slate-400" },
  { key: "received", label: "已回货待完成理货", color: "bg-amber-500" },
  { key: "prepared", label: "已理货待发货", color: "bg-blue-500" },
  { key: "shipped", label: "已发货", color: "bg-emerald-500" },
] as const;
export type StockBucketKey = (typeof STOCK_BUCKETS)[number]["key"];
export type StockProgress = {
  status: string;
  ordered_units: number;
  received_units: number;
  prepared_units: number;
  shipped_units: number;
  buckets: Record<StockBucketKey, { units: number; percent: number }>;
};

/** Every ordered unit belongs to exactly one physical bucket. */
export function summarizeStockProgress(
  status: string,
  items: PhysicalStockItem[],
): StockProgress {
  const { ordered, received, prepared, shipped, counts, percents } = physicalStockBuckets(items);
  return {
    status, ordered_units: ordered, received_units: received,
    prepared_units: prepared, shipped_units: shipped,
    buckets: Object.fromEntries(STOCK_BUCKETS.map((bucket, index) => [bucket.key,
      { units: counts[index], percent: percents[index] }])) as StockProgress["buckets"],
  };
}

export function stockProgressLabel(progress: StockProgress) {
  return STOCK_STATUS_LABELS[progress.status as keyof typeof STOCK_STATUS_LABELS] || progress.status;
}
