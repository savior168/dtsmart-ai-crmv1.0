export type ProductTrendOrder = {
  confirmed_at: string;
  items: Array<{ item_name: string; brand: string; model: string; sales_cny: number | null; sales_usd: number | null }>;
};

/** Only the matching product lines contribute; a PI counts once per product. */
export function productTrendPoints(
  orders: ProductTrendOrder[], key: string, periods: string[], bucketFor: (confirmedAt: string) => string,
) {
  const points = periods.map((period) => ({ period, orders: 0, cny: 0, usd: 0 }));
  const indexByPeriod = new Map(periods.map((period, index) => [period, index]));
  for (const order of orders) {
    const index = indexByPeriod.get(bucketFor(order.confirmed_at));
    if (index == null) continue;
    const matching = order.items.filter((item) => [item.item_name, item.brand, item.model].join("\u0000") === key);
    if (!matching.length) continue;
    points[index].orders++;
    points[index].cny += matching.reduce((sum, item) => sum + (item.sales_cny || 0), 0);
    points[index].usd += matching.reduce((sum, item) => sum + (item.sales_usd || 0), 0);
  }
  return points;
}
