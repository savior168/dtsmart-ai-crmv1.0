export type TeamContributionInput = {
  cny: number;
  missing_cny: number;
  product_profit_cny: number;
  missing_profit_orders: number;
};

/** Keep the denominator identical to the visible team's rows. */
export function teamContribution(rows: TeamContributionInput[]) {
  const salesTotal = rows.reduce((sum, row) => sum + row.cny, 0);
  const salesComplete = rows.every((row) => row.missing_cny === 0);
  const profitComplete = rows.every((row) => row.missing_profit_orders === 0);
  const profitTotal = rows.reduce((sum, row) => sum + row.product_profit_cny, 0);
  return rows.map((row) => ({
    salesShare: salesComplete && salesTotal > 0 ? Math.round(row.cny / salesTotal * 1000) / 10 : null,
    profitShare: profitComplete && profitTotal > 0 ? Math.round(row.product_profit_cny / profitTotal * 1000) / 10 : null,
  }));
}
