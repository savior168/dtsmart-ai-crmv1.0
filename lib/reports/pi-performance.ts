export type PiOrderRow = {
  id: string; order_number: string; customer_id: string | null; customer_name: string;
  sales_user_id: string; currency: string; total_amount: number; confirmed_at: string;
  items: Array<{ item_name: string; brand: string; model: string; quantity: number; amount: number }>;
};

export type PiOrderMetadata = { id: string; total_cny: number | null; fx_rate_cny_to_payment: number | null; archived_at: string | null; status: string };

export function performanceOwnerFilter(role: string, actorId: string, selectedOwner: string | null): string[] | null {
  return selectedOwner ? [selectedOwner] : role === "ADMIN" ? null : [actorId];
}

export function summarizePiPerformance(rows: PiOrderRow[], metadata: PiOrderMetadata[], ownerId: string | null) {
  const byId = new Map(metadata.map((row) => [row.id, row]));
  const orders = rows.filter((row) => {
    const meta = byId.get(row.id);
    return meta && !meta.archived_at && !["DRAFT", "CANCELLED"].includes(meta.status) && (!ownerId || row.sales_user_id === ownerId);
  }).map((row) => {
    const meta = byId.get(row.id)!;
    const native = Number(row.total_amount);
    const cny = meta.total_cny == null ? row.currency === "CNY" ? native : null : Number(meta.total_cny);
    // This snapshot converts CNY into the order's payment currency, not USD.
    // A CNY or third-currency order has no defensible USD value without a
    // separate USD/CNY snapshot from the same transaction time.
    const usd = row.currency === "USD" ? native : null;
    return { ...row, total_amount: native, total_cny: cny, total_usd: usd };
  });
  const currencies = Array.from(new Set(orders.map((order) => order.currency))).sort().map((currency) => ({
    currency, amount: orders.filter((order) => order.currency === currency).reduce((sum, order) => sum + order.total_amount, 0),
  }));
  const byCustomer = new Map<string, { id: string | null; label: string; order_count: number; quantity: number; cny: number; usd: number; missing_cny: number; missing_usd: number }>();
  const byProduct = new Map<string, { key: string; label: string; model: string; quantity: number; amounts: Record<string, number> }>();
  for (const order of orders) {
    const customerKey = order.customer_id || order.customer_name;
    const customer = byCustomer.get(customerKey) || { id: order.customer_id, label: order.customer_name, order_count: 0, quantity: 0, cny: 0, usd: 0, missing_cny: 0, missing_usd: 0 };
    customer.order_count++;
    customer.quantity += order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    customer.cny += order.total_cny || 0; customer.usd += order.total_usd || 0;
    customer.missing_cny += Number(order.total_cny == null); customer.missing_usd += Number(order.total_usd == null);
    byCustomer.set(customerKey, customer);
    for (const item of order.items) {
      const key = [item.item_name, item.brand, item.model].join("\u0000");
      const product = byProduct.get(key) || { key, label: [item.brand, item.item_name].filter(Boolean).join(" · ") || "未命名产品", model: item.model || "", quantity: 0, amounts: {} };
      product.quantity += Number(item.quantity || 0);
      product.amounts[order.currency] = (product.amounts[order.currency] || 0) + Number(item.amount || 0);
      byProduct.set(key, product);
    }
  }
  return {
    totals: { orders: orders.length, cny: orders.reduce((sum, row) => sum + (row.total_cny || 0), 0), usd: orders.reduce((sum, row) => sum + (row.total_usd || 0), 0), missing_cny: orders.filter((row) => row.total_cny == null).length, missing_usd: orders.filter((row) => row.total_usd == null).length, currencies },
    customers: [...byCustomer.values()].sort((a, b) => b.cny - a.cny || b.usd - a.usd || b.quantity - a.quantity),
    products: [...byProduct.values()].sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label)),
    orders,
  };
}
