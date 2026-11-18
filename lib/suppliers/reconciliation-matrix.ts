import { csvCell } from "./reconciliation-csv.ts";

export type ReconciliationMetric = "allocated_cny" | "paid_cny" | "unpaid_cny";
export type SupplierMonthAmount = { supplier_id: string; month: string;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };
export type SupplierPeriodAmount = { supplier_id: string;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };

const cents = (value: number) => Math.round(Number(value || 0) * 100);

export function buildReconciliationMatrix(suppliers: SupplierPeriodAmount[], monthly: SupplierMonthAmount[], metric: ReconciliationMetric) {
  const months = [...new Set(monthly.map((row) => row.month.slice(0, 7)))].sort();
  const cellCents = new Map<string, number>();
  const monthCents = new Map<string, number>();
  const supplierCents = new Map<string, number>();
  for (const row of monthly) {
    const month = row.month.slice(0, 7);
    const key = `${row.supplier_id}:${month}`;
    const amount = cents(row[metric]);
    cellCents.set(key, (cellCents.get(key) || 0) + amount);
    monthCents.set(month, (monthCents.get(month) || 0) + amount);
    supplierCents.set(row.supplier_id, (supplierCents.get(row.supplier_id) || 0) + amount);
  }
  const inconsistentSuppliers = suppliers.filter((row) => (supplierCents.get(row.supplier_id) || 0) !== cents(row[metric]));
  const periodCents = suppliers.reduce((total, row) => total + cents(row[metric]), 0);
  const monthlyCents = [...monthCents.values()].reduce((total, amount) => total + amount, 0);
  return { months, cellCents, monthCents, periodCents,
    consistent: inconsistentSuppliers.length === 0 && periodCents === monthlyCents };
}
export function renderSupplierMonthlyCsv(
  suppliers: Array<SupplierPeriodAmount & { system_code: string; supplier_name: string | null }>,
  monthly: SupplierMonthAmount[], metric: ReconciliationMetric,
) {
  const matrix = buildReconciliationMatrix(suppliers, monthly, metric);
  if (!matrix.consistent) throw new Error("月度金额与期间合计不一致，请刷新后再导出");
  const rows: unknown[][] = [["供应商代码", "供应商名称", ...matrix.months, "期间合计(CNY)"]];
  for (const supplier of suppliers) rows.push([
    supplier.system_code, supplier.supplier_name || "",
    ...matrix.months.map((month) => {
      const amount = matrix.cellCents.get(`${supplier.supplier_id}:${month}`);
      return amount === undefined ? "" : amount / 100;
    }),
    cents(supplier[metric]) / 100,
  ]);
  rows.push(["合计", "", ...matrix.months.map((month) => (matrix.monthCents.get(month) || 0) / 100), matrix.periodCents / 100]);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
