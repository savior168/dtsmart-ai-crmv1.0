"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, LoaderCircle, Search } from "lucide-react";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/types";
import { UserScopeSelect } from "@/components/user-scope-select";
import { AppFilterBar, AppStatusBadge, appFieldClass } from "@/components/ui/app-list";
import { AppPagination } from "@/components/ui/app-pagination";
type StockLink = { id: string; stock_number: string; status: string };
type Row = {
  id: string;
  order_number: string;
  quote_number: string;
  customer_short_name: string;
  currency: string;
  total_amount: number;
  status: SalesOrderStatus;
  delivery_date: string | null;
  updated_at: string;
  owner?: { name?: string | null; email?: string } | null;
  stock?: StockLink | StockLink[] | null;
};
export function OrdersView() {
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState("");
  const [canViewAll, setCanViewAll] = useState(false);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (userId) p.set("user_id", userId);
    const r = await fetch(`/api/orders?${p}`, { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) {
      setError(b.error || "加载失败");
      return;
    }
    setData(b.data || []);
    setCount(Number(b.count || 0));
    setCanViewAll(Boolean(b.can_view_all));
    setError("");
  }, [page, pageSize, q, status, userId]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1660px]">
        <header>
          <h1 className="text-2xl font-bold">销售订单</h1>
          <p className="mt-1 text-sm text-slate-500">
            客户确认报价后形成的不可变订单快照，并关联唯一备货单。
          </p>
        </header>
        <AppFilterBar>
          <label className="relative min-w-64 flex-1 xl:min-w-[320px]">
            <Search
              className="absolute left-3 top-3 text-slate-400"
              size={17}
            />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="搜索订单号、报价号或客户简称"
              className={`${appFieldClass} w-full pl-9`}
            />
          </label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className={appFieldClass}
          >
            <option value="">全部订单状态</option>
            {Object.entries(SALES_ORDER_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <UserScopeSelect
            permission="orders.data_all"
            value={userId}
            onChange={(value) => { setUserId(value); setPage(1); }}
            className={`${appFieldClass} min-w-52`}
          />
          <button
            onClick={() => {
              setQ("");
              setStatus("");
              setUserId("");
              setPage(1);
            }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            重置
          </button>
        </AppFilterBar>
        {error ? (
          <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <section className="mt-4 overflow-hidden rounded-xl border bg-white">
          {loading ? (
            <div className="grid min-h-52 place-items-center">
              <LoaderCircle className="animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    {[
                      "订单编号",
                      "报价编号",
                      "客户简称",
                      ...(canViewAll ? ["归属人"] : []),
                      "订单金额",
                      "订单状态",
                      "备货单",
                      "更新时间",
                      "操作",
                    ].map((x) => (
                      <th key={x} className="px-4 py-3 font-medium">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => {
                    const stock = Array.isArray(row.stock)
                      ? row.stock[0]
                      : row.stock;
                    return (
                      <tr key={row.id} className="border-t">
                        <td className="px-4 py-3 font-semibold">
                          {row.order_number}
                        </td>
                        <td className="px-4 py-3">{row.quote_number}</td>
                        <td className="px-4 py-3">{row.customer_short_name}</td>
                        {canViewAll ? (
                          <td className="px-4 py-3">
                            {row.owner?.name || row.owner?.email || "-"}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 font-semibold text-blue-700">
                          {row.currency} {Number(row.total_amount).toFixed(2)}
                        </td>
                        <td className="px-4 py-3"><AppStatusBadge status={row.status}>{SALES_ORDER_STATUS_LABELS[row.status]}</AppStatusBadge></td>
                        <td className="px-4 py-3">
                          {stock?.stock_number || "-"}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(row.updated_at).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/orders/${row.id}`}
                            className="text-blue-600"
                          >
                            查看订单
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!data.length ? (
                <div className="grid min-h-52 place-items-center text-sm text-slate-400">
                  <ClipboardList className="mb-2" />
                  暂无销售订单
                </div>
              ) : null}
            </div>
          )}
          <AppPagination page={page} pageSize={pageSize} total={count} itemLabel="张订单" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
        </section>
      </div>
    </main>
  );
}
