"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileDown, LoaderCircle, Save, XCircle } from "lucide-react";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/types";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { AppStatusBadge } from "@/components/ui/app-list";
type Payload = {
  order: {
    id: string;
    order_number: string;
    quote_id: string;
    quote_number: string;
    customer_short_name: string;
    destination_country: string | null;
    currency: string;
    subtotal: number;
    shipping_cost: number;
    total_amount: number;
    payment_method: string | null;
    delivery_date: string | null;
    confirmation_method: string | null;
    confirmation_note: string | null;
    status: SalesOrderStatus;
    confirmed_at: string;
    owner?: { name?: string | null; email?: string } | null;
  };
  items: Array<{
    id: string;
    line_number: number;
    item_name: string;
    brand: string | null;
    model: string | null;
    quality: string | null;
    description: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  stock_order: { id: string; stock_number: string; status: string };
  can_edit: boolean;
  can_cancel: boolean;
  can_export: boolean;
};
export function OrderDetailView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState("");
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/orders/${id}`, { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) {
      setError(b.error || "订单加载失败");
      return;
    }
    setData(b);
    setDelivery(b.order.delivery_date || "");
    setNote(b.order.confirmation_note || "");
    setError("");
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function patch(path: string, body: object, method = "PATCH") {
    setBusy(true);
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setError(b.error || "操作失败");
      return;
    }
    await load();
  }
  if (loading && !data)
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <LoaderCircle className="animate-spin text-blue-600" />
      </main>
    );
  if (!data)
    return <main className="p-6 text-rose-600">{error || "订单不存在"}</main>;
  const o = data.order;
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-wrap justify-between gap-2">
          <Link
            href="/orders"
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm"
          >
            <ArrowLeft size={16} />
            返回订单列表
          </Link>
          <div className="flex gap-2">
            {data.can_export ? (
              <a
                href={`/api/orders/${id}/export`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-violet-700"
              >
                <FileDown size={16} />
                导出订单Excel
              </a>
            ) : null}
            <Link
              href={`/quotes/${o.quote_id}`}
              className="h-9 rounded-lg border px-3 py-2 text-sm text-blue-700"
            >
              查看关联报价
            </Link>
            <Link
              href={`/stock-orders/${data.stock_order.id}`}
              className="h-9 rounded-lg border px-3 py-2 text-sm text-emerald-700"
            >
              查看/完善备货单
            </Link>
          </div>
        </div>
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap justify-between gap-3 border-b p-5">
            <div>
              <h1 className="text-xl font-bold">订单 {o.order_number}</h1>
              <p className="mt-1 text-sm text-slate-500">
                系统ID：{o.id} · 报价编号：{o.quote_number} · 归属人：
                {o.owner?.name || o.owner?.email || "-"}
              </p>
            </div>
            <AppStatusBadge status={o.status}>{SALES_ORDER_STATUS_LABELS[o.status]}</AppStatusBadge>
          </header>
          {error ? (
            <p className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="grid gap-4 p-5 md:grid-cols-4">
            {[
              ["客户简称", o.customer_short_name],
              ["目的国家", o.destination_country || "-"],
              ["确认渠道", o.confirmation_method || "-"],
              ["确认时间", new Date(o.confirmed_at).toLocaleString("zh-CN")],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 p-4">
                <small className="text-slate-500">{k}</small>
                <p className="mt-2 font-medium">{v}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto border-y">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs">
                <tr>
                  {[
                    "序号",
                    "产品",
                    "品牌",
                    "型号",
                    "质量",
                    "客户描述",
                    "数量",
                    "单价",
                    "金额",
                  ].map((x) => (
                    <th key={x} className="px-3 py-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="px-3 py-3">{i.line_number}</td>
                    <td className="px-3 py-3 font-medium">{i.item_name}</td>
                    <td className="px-3 py-3">{i.brand || "-"}</td>
                    <td className="px-3 py-3">{i.model || "-"}</td>
                    <td className="px-3 py-3">{i.quality || "-"}</td>
                    <td className="px-3 py-3">{i.description || "-"}</td>
                    <td className="px-3 py-3">{i.quantity}</td>
                    <td className="px-3 py-3">
                      {o.currency} {Number(i.unit_price).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {o.currency} {Number(i.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-blue-50">
                  <td colSpan={8} className="px-3 py-3 text-right">
                    订单总额（含运费 {o.currency}{" "}
                    {Number(o.shipping_cost).toFixed(2)}）
                  </td>
                  <td className="px-3 py-3 font-bold text-blue-700">
                    {o.currency} {Number(o.total_amount).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <section className="grid gap-4 p-5 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1.5 block text-slate-600">预计交付日期</span>
              <input
                disabled={!data.can_edit}
                type="date"
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
                className="h-10 w-full rounded-lg border px-3"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block text-slate-600">客户确认说明</span>
              <textarea
                disabled={!data.can_edit}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full rounded-lg border p-3"
              />
            </label>
          </section>
          {data.can_edit || data.can_cancel ? (
            <footer className="flex justify-end gap-2 border-t p-4">
              {data.can_cancel ? (
                <button
                  disabled={busy}
                  onClick={() => setCancelOpen(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm text-rose-700"
                >
                  <XCircle size={16} />
                  取消订单
                </button>
              ) : null}
              {data.can_edit ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void patch(`/api/orders/${id}`, {
                      delivery_date: delivery,
                      confirmation_note: note,
                    })
                  }
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm text-white"
                >
                  <Save size={16} />
                  保存订单说明
                </button>
              ) : null}
            </footer>
          ) : (
            <footer className="border-t bg-slate-50 p-4 text-sm text-slate-500">
              订单产品与价格是客户确认时的历史快照，不允许直接改写；其他用户仅可查看。
            </footer>
          )}
        </section>
        <AppDialog open={cancelOpen} title="取消销售订单" description="订单和关联备货单将同步取消；客户阶段会按剩余的有效报价或意向凭证自动回退。" onClose={()=>setCancelOpen(false)} width="max-w-md">
          <label className="text-sm font-medium text-slate-700">真实取消原因<textarea autoFocus required value={cancelReason} onChange={event=>setCancelReason(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" placeholder="请输入客户取消、内容变更或其他真实原因"/></label>
          <form onSubmit={event=>{event.preventDefault();if(cancelReason.trim()){void patch(`/api/orders/${id}/cancel`,{reason:cancelReason.trim()},"POST");setCancelOpen(false)}}}><DialogActions busy={busy} onCancel={()=>setCancelOpen(false)} confirmLabel="确认取消订单" tone="danger"/></form>
        </AppDialog>
      </div>
    </main>
  );
}
