export function formatPerformanceNumber(value: unknown, digits = 2): string {
  if (value == null || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "—";
}
