import { SALES_ORDER_STATUS_LABELS, STOCK_STATUS_LABELS, type SalesOrderStatus } from "@/lib/types";
import { physicalStockBuckets, type PhysicalStockItem } from "./stock-progress-math";

export const STOCK_BUCKETS = [
  { key: "pending", label: "待采购", shortLabel: "待采购", color: "bg-slate-400" },
  { key: "purchasing", label: "采购中", shortLabel: "采购中", color: "bg-amber-500" },
  { key: "received", label: "已回货待理货", shortLabel: "回货待理", color: "bg-cyan-500" },
  { key: "prepared", label: "已理货未交货代", shortLabel: "已理货", color: "bg-violet-500" },
  { key: "shipped", label: "已交货代", shortLabel: "已交货代", color: "bg-emerald-500" },
] as const;
export type StockBucketKey = (typeof STOCK_BUCKETS)[number]["key"];
export type StockProgress = {
  status: string;
  ordered_units: number;
  received_units: number;
  prepared_units: number;
  shipped_units: number;
  sorting_items: number;
  sorting_prepared_units: number;
  sorting_ordered_units: number;
  buckets: Record<StockBucketKey, { units: number; percent: number }>;
};

/** Every ordered unit belongs to exactly one physical bucket. */
export function summarizeStockProgress(
  status: string,
  items: PhysicalStockItem[],
): StockProgress {
  const { ordered, received, prepared, shipped, counts, percents } = physicalStockBuckets(items);
  const sortingItems = items.filter((item) => {
    const quantity = Number(item.quantity || 0);
    const preparedQuantity = Number(item.prepared_quantity || 0);
    return quantity > 0 && Number(item.received_quantity || 0) === quantity
      && preparedQuantity > 0 && preparedQuantity < quantity;
  });
  return {
    status, ordered_units: ordered, received_units: received,
    prepared_units: prepared, shipped_units: shipped,
    sorting_items: sortingItems.length,
    sorting_prepared_units: sortingItems.reduce((sum, item) => sum + Number(item.prepared_quantity || 0), 0),
    sorting_ordered_units: sortingItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    buckets: Object.fromEntries(STOCK_BUCKETS.map((bucket, index) => [bucket.key,
      { units: counts[index], percent: percents[index] }])) as StockProgress["buckets"],
  };
}

export function stockProgressLabel(progress: StockProgress) {
  if (["DRAFT", "SHORTAGE", "CANCELLED"].includes(progress.status)) {
    return STOCK_STATUS_LABELS[progress.status as keyof typeof STOCK_STATUS_LABELS] || progress.status;
  }
  if (!progress.ordered_units) return STOCK_STATUS_LABELS[progress.status as keyof typeof STOCK_STATUS_LABELS] || "暂无备货数量";
  if (progress.status === "WAITING" && progress.received_units === 0 && progress.prepared_units === 0 && progress.shipped_units === 0) return "待仓库接单";
  if (progress.shipped_units === progress.ordered_units) return "已交货代";
  if (progress.shipped_units > 0) return "部分已交货代";
  if (progress.prepared_units === progress.ordered_units) return "已理货待交货代";
  if (progress.received_units === progress.ordered_units) {
    return progress.prepared_units > 0 ? "理货中" : "已回齐待理货";
  }
  if (progress.received_units > 0) return progress.sorting_items > 0 ? "部分回货，理货中" : "部分回货";
  return progress.buckets.purchasing.units > 0 ? "采购中" : "待采购";
}

export const STOCK_ITEM_PROGRESS = [
  { key: "WAITING", label: "待采购", tone: "bg-slate-100 text-slate-700" },
  { key: "PURCHASING", label: "采购中", tone: "bg-amber-100 text-amber-800" },
  { key: "PARTIAL_RECEIPT", label: "部分回货", tone: "bg-cyan-100 text-cyan-800" },
  { key: "RECEIVED", label: "已回齐待理货", tone: "bg-cyan-100 text-cyan-800" },
  { key: "SORTING", label: "理货中", tone: "bg-violet-100 text-violet-800" },
  { key: "READY_TO_SHIP", label: "已理货待交货代", tone: "bg-blue-100 text-blue-800" },
  { key: "SHIPPED", label: "已交货代", tone: "bg-emerald-100 text-emerald-800" },
] as const;
export type StockItemProgressKey = (typeof STOCK_ITEM_PROGRESS)[number]["key"];

export function stockItemProgressKey(item: PhysicalStockItem): StockItemProgressKey {
  const quantity = Number(item.quantity || 0);
  const received = Number(item.received_quantity || 0);
  const prepared = Number(item.prepared_quantity || 0);
  const shipped = Number(item.shipped_quantity || 0);
  if (quantity > 0 && shipped === quantity) return "SHIPPED";
  if (quantity > 0 && prepared === quantity) return "READY_TO_SHIP";
  if (received > 0 && received < quantity) return "PARTIAL_RECEIPT";
  if (quantity > 0 && received === quantity) return prepared > 0 ? "SORTING" : "RECEIVED";
  return item.preparation_status === "WAITING" ? "WAITING" : "PURCHASING";
}

export function stockItemProgress(item: PhysicalStockItem) {
  const key = stockItemProgressKey(item);
  return STOCK_ITEM_PROGRESS.find((stage) => stage.key === key)!;
}

/** The PI lifecycle is separate from the physical stages of its stock order. */
export const PI_EXECUTING_STATUSES = ["WAITING_STOCK", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP"] as const;
export function piOrderStatusLabel(status: string) {
  if ((PI_EXECUTING_STATUSES as readonly string[]).includes(status)) {
    return "已提交仓库（执行中）";
  }
  return SALES_ORDER_STATUS_LABELS[status as SalesOrderStatus] || status;
}
