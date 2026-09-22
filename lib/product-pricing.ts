export type PriceTier = {
  price_kind: "PROCUREMENT" | "PACKAGING" | "OTHER_COST" | "SALE_REFERENCE";
  currency: "CNY" | "USD";
  amount: number;
  minimum_quantity: number;
  effective_from?: string;
  is_active: boolean;
};

export type PricingRule = {
  markup_percent: number;
  minimum_margin_percent: number;
  rounding_increment: number;
};

export function activeTier(prices: PriceTier[], kind: PriceTier["price_kind"], quantity: number) {
  const active = prices
    .filter((price) => price.is_active && price.price_kind === kind)
    .sort((a, b) => {
      const quantityOrder = Number(b.minimum_quantity) - Number(a.minimum_quantity);
      if (quantityOrder) return quantityOrder;
      return String(b.effective_from || "").localeCompare(String(a.effective_from || ""));
    });
  return active.find((price) => Number(price.minimum_quantity) <= quantity) || active.at(-1) || null;
}

export function completeCostCny(prices: PriceTier[], quantity: number) {
  return (["PROCUREMENT", "PACKAGING", "OTHER_COST"] as const).reduce(
    (sum, kind) => sum + Number(activeTier(prices, kind, quantity)?.amount || 0),
    0,
  );
}

export function suggestedUsdPrice(costCny: number, cnyPerUsd: number, rule: PricingRule) {
  if (costCny <= 0 || cnyPerUsd <= 0) return 0;
  const costUsd = costCny / cnyPerUsd;
  const byMarkup = costUsd * (1 + Math.max(0, rule.markup_percent) / 100);
  const margin = Math.min(99.99, Math.max(0, rule.minimum_margin_percent)) / 100;
  const byMargin = costUsd / (1 - margin);
  const raw = Math.max(byMarkup, byMargin);
  const increment = Math.max(0.01, Number(rule.rounding_increment) || 0.01);
  return Math.ceil((raw - Number.EPSILON) / increment) * increment;
}
