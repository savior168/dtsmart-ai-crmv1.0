import "server-only";

import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
type ProgressItem = { stock_order_id: string; quantity: number; received_quantity: number | null; prepared_quantity: number; shipped_quantity: number };

/** Read every line of the visible orders; PostgREST caps a single response. */
export async function loadStockProgressItems(supabase: ServerSupabase, stockOrderIds: string[]) {
  const byStockId = new Map<string, ProgressItem[]>();
  const uniqueIds = [...new Set(stockOrderIds)];
  for (let start = 0; start < uniqueIds.length; start += 100) {
    const ids = uniqueIds.slice(start, start + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("stock_order_items")
        .select("stock_order_id,quantity,received_quantity,prepared_quantity,shipped_quantity")
        .in("stock_order_id", ids)
        .order("stock_order_id")
        .order("line_number")
        .range(offset, offset + 999);
      if (error) throw error;
      for (const item of data || []) {
        const list = byStockId.get(item.stock_order_id) || [];
        list.push(item);
        byStockId.set(item.stock_order_id, list);
      }
      if ((data || []).length < 1000) break;
    }
  }
  return byStockId;
}
