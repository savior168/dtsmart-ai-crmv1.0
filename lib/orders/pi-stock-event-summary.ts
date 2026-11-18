import { STOCK_STATUS_LABELS, type StockOrderStatus } from "@/lib/types";

type StockEvent = {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const VISIBLE_STATUSES = new Set<StockOrderStatus>([
  "WAITING", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP",
  "SHIPPED", "SHORTAGE", "CANCELLED",
]);

export function summarizePiStockEvents(events: StockEvent[]) {
  return events.flatMap((event) => {
    const status = event.to_status as StockOrderStatus;
    if (!VISIBLE_STATUSES.has(status)) return [];
    // A partial handoff may leave the aggregate status unchanged. The structured
    // event has no kind column yet; only the system-generated prefix is safe to
    // recognize. Never return the free-form warehouse note to sales users.
    const partialHandoff = event.note?.startsWith("交货代：") && status !== "SHIPPED";
    if (event.from_status === event.to_status && !partialHandoff) return [];
    return [{
      id: event.id,
      created_at: event.created_at,
      created_by: event.created_by,
      label: partialHandoff ? "部分产品已交货代" : STOCK_STATUS_LABELS[status],
    }];
  });
}
