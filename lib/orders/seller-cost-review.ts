export type SellerCostStockLine = {
  id: string;
  line_number: number;
  quantity: number;
  pi_amendment_cancelled_at?: string | null;
};

export type SellerCostSalesLine = {
  id: string;
  line_number: number;
  estimated_unit_cost_cny: number | string | null;
  pi_amendment_cancelled_at?: string | null;
};

export type SellerCostReceiptAllocation = {
  stock_order_item_id: string;
  quantity: number;
  purchase_unit_price_cny: number | string;
};

/** Returns PI lines whose quantity-weighted purchase price, excluding order fees, exceeds the seller estimate. */
export function sellerCostReviewLineNumbers(
  stockLines: SellerCostStockLine[],
  salesLines: SellerCostSalesLine[],
  allocations: SellerCostReceiptAllocation[],
) {
  const eligible = new Set<number>();
  const salesByLine = new Map(salesLines.filter(line => !line.pi_amendment_cancelled_at).map(line => [line.line_number, line]));
  const allocationsByStockId = new Map<string, SellerCostReceiptAllocation[]>();
  for (const allocation of allocations) {
    const bucket = allocationsByStockId.get(allocation.stock_order_item_id) || [];
    bucket.push(allocation);
    allocationsByStockId.set(allocation.stock_order_item_id, bucket);
  }

  for (const stockLine of stockLines) {
    if (stockLine.pi_amendment_cancelled_at) continue;
    const salesLine = salesByLine.get(stockLine.line_number);
    const estimate = Number(salesLine?.estimated_unit_cost_cny);
    if (!salesLine || !Number.isFinite(estimate) || estimate < 0) continue;
    const receipts = allocationsByStockId.get(stockLine.id) || [];
    const quantity = receipts.reduce((sum, row) => sum + Number(row.quantity), 0);
    const amountCents = receipts.reduce((sum, row) => sum + Math.round(Number(row.quantity) * Number(row.purchase_unit_price_cny) * 100), 0);
    if (!Number.isSafeInteger(stockLine.quantity) || quantity !== stockLine.quantity || quantity <= 0 || !Number.isSafeInteger(amountCents)) continue;
    const actualUnitPriceCents = Math.round(amountCents / quantity);
    const estimateCents = Math.round(estimate * 100);
    if (Number.isSafeInteger(estimateCents) && actualUnitPriceCents > estimateCents) eligible.add(stockLine.line_number);
  }

  return [...eligible].sort((a, b) => a - b);
}
