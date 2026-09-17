export type CostAmountRow = {
  provider: string;
  amount_type?: string | null;
  amount_usd?: number | string | null;
};

/**
 * OpenAI amounts are calculated from usage returned by the completed API call.
 * Google catalogue prices remain estimates until the provider billing sync marks
 * the ledger row FINAL, so they must not be presented as actually incurred cost.
 */
export function isActuallyIncurredCost(row: CostAmountRow) {
  const amount = Number(row.amount_usd || 0);
  if (!(amount > 0)) return false;
  if (row.provider === "OPENAI") return true;
  return row.amount_type === "FINAL";
}

export function actualCostUsd(rows: CostAmountRow[]) {
  return rows.reduce((sum, row) => sum + (isActuallyIncurredCost(row) ? Number(row.amount_usd || 0) : 0), 0);
}
