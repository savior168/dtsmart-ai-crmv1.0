import { STOCK_STATUS_LABELS } from "@/lib/types";
import { physicalStockBuckets, type PhysicalStockItem } from "./stock-progress-math";

export const STOCK_BUCKETS = [
  { key: "pending", label: "待采购", color: "bg-slate-400" },
  { key: "purchasing", label: "采购中", color: "bg-amber-500" },
  { key: "received", label: "已回货待理货", color: "bg-cyan-500" },
  { key: "prepared", label: "已理货待交货代", color: "bg-violet-500" },
  { key: "shipped", label: "已交货代", color: "bg-emerald-500" },
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
  if (["DRAFT", "WAITING", "SHIPPED", "READY", "SHORTAGE", "CANCELLED"].includes(progress.status)) {
    return STOCK_STATUS_LABELS[progress.status as keyof typeof STOCK_STATUS_LABELS] || progress.status;
  }
  const occupied = STOCK_BUCKETS.filter((bucket) => progress.buckets[bucket.key].units > 0);
  return occupied.length > 1 ? "多阶段备货（查看进度条）" : occupied[0]?.label || "暂无备货数量";
}
