/** Keep the default destination aligned with the visible sidebar order. */
const LANDING_PAGES = [
  ["dashboard.view", "/"],
  ["products.view", "/products"],
  ["products.categories.view", "/products/categories"],
  ["pricebooks.view", "/products/prices"],
  ["pricebooks.rules.view", "/products/pricing"],
  ["pricebooks.import", "/products/import"],
  ["customers.view", "/customers/pool"],
  ["followups.view", "/followups"],
  ["ai.acquisition.view", "/ai-acquisition"],
  ["ai.tasks.view", "/ai-screening"],
  ["orders.view", "/orders"],
  ["stock.view", "/stock-orders"],
  ["suppliers.view", "/suppliers"],
  ["supplier.reconciliation.view", "/supplier-reconciliation"],
  ["pi.rates.view", "/settings/pi-exchange-rates"],
  ["pi.accounts.view", "/settings/pi-payment-accounts"],
  ["reports.view", "/reports"],
  ["notifications.view", "/notifications"],
  ["system.users.view", "/settings/users"],
  ["costs.view", "/settings/costs"],
  ["system.audit.view", "/settings/audit"],
  ["system.security.view", "/settings/security"],
] as const;

export function firstAuthorizedPage(canAccess: (permission: string) => boolean): string | null {
  return LANDING_PAGES.find(([permission]) => canAccess(permission))?.[1] ?? null;
}
