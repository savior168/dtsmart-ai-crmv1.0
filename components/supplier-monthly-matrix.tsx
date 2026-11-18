"use client";
import { useMemo } from "react";
import { buildReconciliationMatrix, renderSupplierMonthlyCsv, type ReconciliationMetric } from "@/lib/suppliers/reconciliation-matrix";

type Supplier = { supplier_id: string; system_code: string; supplier_name: string | null;
  allocated_cny: number; paid_cny: number; unpaid_cny: number };
type Month = { month: string; supplier_id: string; allocated_cny: number; paid_cny: number; unpaid_cny: number };

const metrics: Array<{ key: ReconciliationMetric; label: string }> = [
  { key: "allocated_cny", label: "应付货款" },
  { key: "paid_cny", label: "财务已付" },
  { key: "unpaid_cny", label: "未付货款" },
];
const formatMoney = (value: number) => `${value < 0 ? "−" : ""}¥${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SupplierMonthlyMatrix({ suppliers, monthly, metric, dateFrom, dateTo, supplierId, onMetricChange, onDrill }:
  { suppliers: Supplier[]; monthly: Month[]; metric: ReconciliationMetric; onMetricChange: (value: ReconciliationMetric) => void;
    dateFrom: string; dateTo: string; supplierId: string; onDrill: (supplierId: string, month: string) => void }) {
  const { months, cellCents, monthCents, periodCents, consistent } = useMemo(
    () => buildReconciliationMatrix(suppliers, monthly, metric), [suppliers, monthly, metric]);
  const selectedLabel = metrics.find((item) => item.key === metric)?.label || "应付货款";
  function exportMonthlyCsv() {
    const csv = renderSupplierMonthlyCsv(suppliers, monthly, metric);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `供应商月度对账-${selectedLabel}-${dateFrom}-${dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="overflow-hidden rounded-xl border bg-white shadow-sm" aria-label="供应商月度采购对账矩阵">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
      <div><h2 className="font-semibold">供应商月度对账</h2><p className="mt-1 text-xs text-slate-500">按送货单日期归属月份，覆盖当前筛选范围内全部送货单，不受明细分页影响。点击金额核对同范围明细。</p><p className="mt-1 text-xs text-amber-700">“财务已付”按对应送货单月份归集截至当前的已登记付款，不代表该月实际付款额。</p></div>
      <div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-lg border bg-slate-50 p-1" role="group" aria-label="月度金额口径">
        {metrics.map((item) => <button key={item.key} type="button" onClick={() => onMetricChange(item.key)} aria-pressed={metric === item.key}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${metric === item.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-blue-700"}`}>{item.label}</button>)}
      </div><button type="button" disabled={!consistent || !suppliers.length} onClick={exportMonthlyCsv} className="rounded-lg border px-3 py-2 text-xs text-blue-700 hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50">导出月度 CSV</button></div>
    </div>
    {!consistent ? <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">月度金额与期间合计不一致，请刷新并核对原始送货单；当前矩阵不应作为结算依据。</p> : null}
    {suppliers.length > 0 && months.length > 0 ? <div className="max-h-[520px] overflow-auto"><table className="min-w-full border-separate border-spacing-0 text-right text-sm">
      <caption className="sr-only">各供应商每月{selectedLabel}，末行和末列为合计</caption>
      <thead className="sticky top-0 z-20 bg-slate-50 text-slate-600"><tr><th scope="col" className="sticky left-0 z-30 min-w-44 border-b border-r bg-slate-50 px-4 py-3 text-left">供应商代码 / 名称</th>
        {months.map((month) => <th scope="col" key={month} className="min-w-36 border-b px-3 py-3 tabular-nums">{month}</th>)}<th scope="col" className="sticky right-0 z-30 min-w-40 border-b border-l bg-slate-50 px-4 py-3">期间合计</th></tr></thead>
      <tbody>{suppliers.map((supplier) => <tr key={supplier.supplier_id} className="group hover:bg-blue-50/50"><th scope="row" className="sticky left-0 z-10 border-b border-r bg-white px-4 py-3 text-left group-hover:bg-blue-50"><span className="block font-semibold">{supplier.system_code}</span><span className="block truncate text-xs font-normal text-slate-500" title={supplier.supplier_name || "未补名称"}>{supplier.supplier_name || "未补名称"}</span></th>
        {months.map((month) => { const value = cellCents.get(`${supplier.supplier_id}:${month}`); return <td key={month} className="border-b px-2 py-2 tabular-nums">{value === undefined ? <span className="text-slate-400" title="该月无送货单">—</span> : <button type="button" onClick={() => onDrill(supplier.supplier_id, month)} title={`核对 ${supplier.system_code} ${month} ${selectedLabel}`} className={`w-full rounded-md px-2 py-1.5 text-right font-medium hover:bg-blue-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${value < 0 ? "text-rose-700" : "text-blue-700"}`}>{formatMoney(value / 100)}</button>}</td>; })}
        <td className={`sticky right-0 z-10 border-b border-l bg-white px-4 py-3 font-semibold tabular-nums group-hover:bg-blue-50 ${Number(supplier[metric]) < 0 ? "text-rose-700" : "text-slate-900"}`}>{formatMoney(Number(supplier[metric] || 0))}</td></tr>)}
        <tr className="font-semibold"><th scope="row" className="sticky bottom-0 left-0 z-20 border-r border-t bg-slate-50 px-4 py-3 text-left">月份合计</th>{months.map((month) => <td key={month} className="sticky bottom-0 border-t bg-slate-50 px-2 py-2 tabular-nums"><button type="button" onClick={() => onDrill(supplierId, month)} title={`核对${supplierId ? "当前" : "全部"}供应商 ${month} ${selectedLabel}`} className="w-full rounded-md px-1 py-1.5 text-right font-semibold text-blue-700 hover:bg-blue-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{formatMoney((monthCents.get(month) || 0) / 100)}</button></td>)}<td className="sticky bottom-0 right-0 z-20 border-l border-t bg-slate-50 px-4 py-3 tabular-nums">{formatMoney(periodCents / 100)}</td></tr>
      </tbody></table></div> : <p className="p-8 text-center text-sm text-slate-500">当前筛选范围没有可汇总的送货单</p>}
  </section>;
}
