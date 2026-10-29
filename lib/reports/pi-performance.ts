export type PiOrderRow = {
  id: string; order_number: string; customer_id: string | null; customer_name: string;
  sales_user_id: string; currency: string; total_amount: number; confirmed_at: string;
  items: Array<{ item_name: string; brand: string; model: string; quantity: number; amount: number; unit_price_cny: number | null; estimated_unit_cost_cny: number | null; procurement_unit_cost_cny?: number | null; line_number?: number }>;
};

export type PiOrderMetadata = {
  id: string; total_cny: number | null; fx_rate_cny_to_payment: number | null;
  usd_cny_rate_snapshot: number | null; usd_rate_source_snapshot: string | null;
  usd_rate_reference_date_snapshot: string | null; usd_rate_synced_at_snapshot: string | null;
  archived_at: string | null; status: string;
};

export function performanceOwnerFilter(role: string, actorId: string, selectedOwner: string | null): string[] | null {
  return selectedOwner ? [selectedOwner] : role === "ADMIN" ? null : [actorId];
}

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function summarizePiPerformance(rows: PiOrderRow[], metadata: PiOrderMetadata[], ownerId: string | null) {
  const byId = new Map(metadata.map((row) => [row.id, row]));
  const orders = rows.filter((row) => {
    const meta = byId.get(row.id);
    return meta && !meta.archived_at && !["DRAFT", "CANCELLED"].includes(meta.status) && (!ownerId || row.sales_user_id === ownerId);
  }).map((row) => {
    const meta = byId.get(row.id)!;
    const currency = row.currency.toUpperCase();
    const native = Number(row.total_amount);
    const cny = meta.total_cny == null ? currency === "CNY" ? native : null : Number(meta.total_cny);
    const usdRate = positive(meta.usd_cny_rate_snapshot);
    const usd = currency === "USD" ? native : cny != null && usdRate ? cny / usdRate : null;
    const items = row.items.map((item) => {
      const quantity = Number(item.quantity || 0);
      const amount = Number(item.amount || 0);
      const salesCny = item.unit_price_cny == null ? currency === "CNY" ? amount : null : Number(item.unit_price_cny) * quantity;
      const salesUsd = currency === "USD" ? amount : salesCny != null && usdRate ? salesCny / usdRate : null;
      const actualUnitCost = item.procurement_unit_cost_cny == null ? null : positiveOrZero(item.procurement_unit_cost_cny);
      const estimatedUnitCost = item.estimated_unit_cost_cny == null ? null : positiveOrZero(item.estimated_unit_cost_cny);
      const unitCost = actualUnitCost ?? estimatedUnitCost;
      const costBasis = actualUnitCost != null ? "ACTUAL" : estimatedUnitCost != null ? "ESTIMATED" : "MISSING";
      const costCny = unitCost == null ? null : unitCost * quantity;
      return { ...item, quantity, amount, sales_cny: salesCny, sales_usd: salesUsd, cost_cny: costCny, cost_basis: costBasis,
        profit_cny: salesCny != null && costCny != null ? salesCny - costCny : null,
        profit_usd: salesUsd != null && costCny != null && usdRate ? salesUsd - costCny / usdRate : null };
    });
    const salesCnyComplete = items.every((item) => item.sales_cny != null);
    const costComplete = items.length > 0 && items.every((item) => item.cost_cny != null);
    const productSalesCny = salesCnyComplete ? items.reduce((sum, item) => sum + Number(item.sales_cny), 0) : null;
    const costCny = costComplete ? items.reduce((sum, item) => sum + Number(item.cost_cny), 0) : null;
    const productProfitCny = productSalesCny != null && costCny != null ? productSalesCny - costCny : null;
    const productProfitUsd = costComplete && items.every((item) => item.profit_usd != null) ? items.reduce((sum, item) => sum + Number(item.profit_usd), 0) : null;
    return { ...row, currency, total_amount: native, total_cny: cny, total_usd: usd,
      usd_cny_rate_snapshot: usdRate, usd_rate_source_snapshot: meta.usd_rate_source_snapshot,
      usd_rate_reference_date_snapshot: meta.usd_rate_reference_date_snapshot,
      usd_rate_synced_at_snapshot: meta.usd_rate_synced_at_snapshot,
      items, product_sales_cny: productSalesCny, cost_cny: costCny,
      product_profit_cny: productProfitCny, product_profit_usd: productProfitUsd, missing_profit_usd: productProfitUsd == null,
      product_margin: productSalesCny && productProfitCny != null ? productProfitCny / productSalesCny * 100 : null,
      missing_cost_lines: items.filter((item) => item.cost_cny == null).length,
      actual_cost_lines: items.filter((item) => item.cost_basis === "ACTUAL").length,
      estimated_cost_lines: items.filter((item) => item.cost_basis === "ESTIMATED").length,
      missing_usd_rate: currency !== "USD" && usdRate == null };
  });
  const byCustomer = new Map<string, {
    id: string | null; label: string; order_count: number; quantity: number; cny: number; usd: number;
    missing_cny: number; missing_usd: number; cost_cny: number; product_profit_cny: number;
    product_profit_usd: number; product_sales_cny: number; missing_profit_orders: number; missing_profit_usd_orders: number;
  }>();
  const byProduct = new Map<string, {
    key: string; label: string; model: string; quantity: number; cny: number; usd: number;
    missing_cny: number; missing_usd: number; cost_cny: number; product_profit_cny: number;
    product_profit_usd: number; product_sales_cny: number; missing_cost_lines: number; actual_cost_lines: number; estimated_cost_lines: number; missing_profit_lines: number; missing_profit_usd_lines: number;
  }>();
  for (const order of orders) {
    const customerKey = order.customer_id || order.customer_name;
    const customer = byCustomer.get(customerKey) || { id: order.customer_id, label: order.customer_name,
      order_count: 0, quantity: 0, cny: 0, usd: 0, missing_cny: 0, missing_usd: 0,
      cost_cny: 0, product_profit_cny: 0, product_profit_usd: 0, product_sales_cny: 0, missing_profit_orders: 0, missing_profit_usd_orders: 0 };
    customer.order_count++;
    customer.quantity += order.items.reduce((sum, item) => sum + item.quantity, 0);
    customer.cny += order.total_cny || 0; customer.usd += order.total_usd || 0;
    customer.missing_cny += Number(order.total_cny == null); customer.missing_usd += Number(order.total_usd == null);
    if (order.product_profit_cny == null) customer.missing_profit_orders++;
    if (order.product_profit_usd == null) customer.missing_profit_usd_orders++;
    if (order.product_profit_cny != null) {
      customer.product_profit_cny += order.product_profit_cny;
      customer.cost_cny += order.cost_cny || 0;
      customer.product_sales_cny += order.product_sales_cny || 0;
    }
    if (order.product_profit_usd != null) customer.product_profit_usd += order.product_profit_usd;
    byCustomer.set(customerKey, customer);
    for (const item of order.items) {
      const key = [item.item_name, item.brand, item.model].join("\u0000");
      const product = byProduct.get(key) || { key,
        label: [item.brand, item.item_name].filter(Boolean).join(" · ") || "未命名产品", model: item.model || "",
        quantity: 0, cny: 0, usd: 0, missing_cny: 0, missing_usd: 0,
        cost_cny: 0, product_profit_cny: 0, product_profit_usd: 0, product_sales_cny: 0, missing_cost_lines: 0, actual_cost_lines: 0, estimated_cost_lines: 0, missing_profit_lines: 0, missing_profit_usd_lines: 0 };
      product.quantity += item.quantity;
      if (item.cost_basis === "ACTUAL") product.actual_cost_lines++;
      if (item.cost_basis === "ESTIMATED") product.estimated_cost_lines++;
      if (item.sales_cny == null) product.missing_cny++; else product.cny += item.sales_cny;
      if (item.sales_usd == null) product.missing_usd++; else product.usd += item.sales_usd;
      if (item.cost_cny == null) product.missing_cost_lines++;
      if (item.profit_cny == null) product.missing_profit_lines++;
      if (item.profit_usd == null) product.missing_profit_usd_lines++;
      if (item.cost_cny != null && item.profit_cny != null) {
        product.cost_cny += item.cost_cny;
        product.product_profit_cny += item.profit_cny;
        product.product_sales_cny += Number(item.sales_cny || 0);
        if (item.profit_usd != null) product.product_profit_usd += item.profit_usd;
      }
      byProduct.set(key, product);
    }
  }
  const completeOrders = orders.filter((row) => row.product_profit_cny != null);
  const productSalesCny = completeOrders.reduce((sum, row) => sum + Number(row.product_sales_cny || 0), 0);
  const profitCny = completeOrders.reduce((sum, row) => sum + Number(row.product_profit_cny || 0), 0);
  return {
    totals: {
      orders: orders.length, cny: orders.reduce((sum, row) => sum + (row.total_cny || 0), 0),
      usd: orders.reduce((sum, row) => sum + (row.total_usd || 0), 0),
      missing_cny: orders.filter((row) => row.total_cny == null).length,
      missing_usd: orders.filter((row) => row.total_usd == null).length,
      cost_cny: completeOrders.reduce((sum, row) => sum + Number(row.cost_cny || 0), 0),
      product_sales_cny: productSalesCny, product_profit_cny: profitCny,
      product_profit_usd: orders.filter((row) => row.product_profit_usd != null).reduce((sum, row) => sum + Number(row.product_profit_usd), 0),
      missing_profit_usd_orders: orders.filter((row) => row.product_profit_usd == null).length,
      product_margin: productSalesCny > 0 ? profitCny / productSalesCny * 100 : null,
      missing_profit_orders: orders.filter((row) => row.product_profit_cny == null).length,
    },
    customers: [...byCustomer.values()].map((row) => ({ ...row, product_margin: row.product_sales_cny > 0 && row.missing_profit_orders === 0 ? row.product_profit_cny / row.product_sales_cny * 100 : null })).sort((a, b) => b.cny - a.cny || b.usd - a.usd || b.quantity - a.quantity),
    products: [...byProduct.values()].map((row) => ({ ...row, product_margin: row.product_sales_cny > 0 && row.missing_profit_lines === 0 ? row.product_profit_cny / row.product_sales_cny * 100 : null })).sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label)),
    orders,
  };
}

function positiveOrZero(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
