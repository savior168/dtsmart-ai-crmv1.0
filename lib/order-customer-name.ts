import { createAdminClient } from "@/lib/supabase/admin";

/** Resolve only customers attached to orders the caller has already been allowed to see. */
export async function loadOrderCustomerNames(orderIds: string[], historicalOnly = false): Promise<Map<string, string | null>> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const admin = createAdminClient();
  const { data: orders, error } = await admin.from("sales_orders")
    .select("id,customer_name_snapshot,customer:customers(contact_name)").in("id", ids);
  if (error) throw error;
  return new Map((orders || []).map((order) => {
    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
    return [order.id, order.customer_name_snapshot?.trim() || (historicalOnly ? null : customer?.contact_name?.trim()) || null];
  }));
}
