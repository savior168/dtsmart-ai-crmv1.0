export type ReceiptAllocation = {
  stock_order_item_id: string;
  quantity: number;
  purchase_unit_price_cny: number;
};

/** Use the immutable receipt ledger, never the last edited procurement unit price. */
export function actualReceiptCostByItem(allocations: ReceiptAllocation[]) {
  const totals = new Map<string, { quantity: number; amount_cny: number }>();
  for (const allocation of allocations) {
    const quantity = Number(allocation.quantity);
    const unitPrice = Number(allocation.purchase_unit_price_cny);
    const unitPriceCents = Math.round(unitPrice * 100);
    if (!allocation.stock_order_item_id || !Number.isSafeInteger(quantity)
      || !Number.isFinite(unitPrice) || unitPrice < 0
      || !Number.isSafeInteger(unitPriceCents)
      || Math.abs(unitPrice * 100 - unitPriceCents) > 1e-7) {
      throw new Error("回货成本明细无效");
    }
    const previous = totals.get(allocation.stock_order_item_id) || { quantity: 0, amount_cny: 0 };
    totals.set(allocation.stock_order_item_id, {
      quantity: previous.quantity + quantity,
      amount_cny: (Math.round(previous.amount_cny * 100) + quantity * unitPriceCents) / 100,
    });
  }
  return totals;
}

export function completeActualCost(
  orderedQuantity: number,
  receipt: { quantity: number; amount_cny: number } | undefined,
) {
  if (!Number.isSafeInteger(orderedQuantity) || orderedQuantity <= 0 || !receipt
    || receipt.quantity !== orderedQuantity || receipt.amount_cny < 0) return null;
  return Math.round((receipt.amount_cny + Number.EPSILON) * 100) / 100;
}

export function actualOrderProfit(
  lines: Array<{ stock_order_item_id: string; quantity: number; sales_cny: number | null }>,
  receipts: Map<string, { quantity: number; amount_cny: number }>,
  expenses: { packaging_cny: number; shipping_cny: number; other_cny: number } | null,
  allShipped: boolean,
) {
  if (!lines.length || lines.some((line) => line.sales_cny === null
    || !Number.isFinite(line.sales_cny) || line.sales_cny < 0)) return null;
  let salesCents = 0;
  let costCents = 0;
  for (const line of lines) {
    const cost = completeActualCost(line.quantity, receipts.get(line.stock_order_item_id));
    if (cost === null) return null;
    salesCents += Math.round(Number(line.sales_cny) * 100);
    costCents += Math.round(cost * 100);
  }
  const grossCents = salesCents - costCents;
  if (expenses && [expenses.packaging_cny, expenses.shipping_cny, expenses.other_cny]
    .some((value) => !Number.isFinite(value) || value < 0
      || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)) return null;
  // Earlier partial handoffs do not yet include the whole PI's shipping and
  // packaging costs. Never call their interim total a final actual net profit.
  const expenseCents = expenses === null || !allShipped ? null
    : Math.round(expenses.packaging_cny * 100) + Math.round(expenses.shipping_cny * 100)
      + Math.round(expenses.other_cny * 100);
  if (expenseCents !== null && (!Number.isSafeInteger(expenseCents) || expenseCents < 0)) return null;
  return {
    product_sales_cny: salesCents / 100,
    purchase_cost_cny: costCents / 100,
    actual_gross_profit_cny: grossCents / 100,
    actual_gross_margin: salesCents > 0 ? grossCents / salesCents * 100 : null,
    actual_net_profit_cny: expenseCents === null ? null : (grossCents - expenseCents) / 100,
    actual_net_margin: expenseCents === null || salesCents <= 0
      ? null : (grossCents - expenseCents) / salesCents * 100,
  };
}

export function summarizeActualOrders(
  orderIds: string[],
  actualByOrder: Map<string, NonNullable<ReturnType<typeof actualOrderProfit>>>,
) {
  const ids = [...new Set(orderIds)];
  let completeOrders = 0;
  let completeNetOrders = 0;
  let grossCents = 0;
  let netCents = 0;
  let netSalesCents = 0;
  for (const id of ids) {
    const actual = actualByOrder.get(id);
    if (!actual) continue;
    completeOrders++;
    grossCents += Math.round(actual.actual_gross_profit_cny * 100);
    if (actual.actual_net_profit_cny !== null) {
      completeNetOrders++;
      netCents += Math.round(actual.actual_net_profit_cny * 100);
      netSalesCents += Math.round(actual.product_sales_cny * 100);
    }
  }
  return {
    complete_orders: completeOrders,
    pending_orders: ids.length - completeOrders,
    gross_cny: grossCents / 100,
    net_cny: netCents / 100,
    net_sales_cny: netSalesCents / 100,
    net_margin: netSalesCents > 0 ? netCents / netSalesCents * 100 : null,
    complete_net_orders: completeNetOrders,
    pending_expense_orders: completeOrders - completeNetOrders,
  };
}
