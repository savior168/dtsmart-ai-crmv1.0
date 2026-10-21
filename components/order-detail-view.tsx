"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileDown, LoaderCircle, RefreshCw, Save, Trash2, XCircle } from "lucide-react";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/types";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { AppStatusBadge } from "@/components/ui/app-list";
import { CountryLabel } from "@/components/country-label";
import { numberedPiChangeNote } from "@/lib/pi-change-note";
import { StockProgressCell } from "@/components/stock-progress-cell";
import type { StockProgress } from "@/lib/stock-progress";
import { PI_EXECUTING_STATUSES, piOrderStatusLabel } from "@/lib/stock-progress";

function PiInternalTextCell({ text, fallback, label, lineNumber }: {
  text: string | null; fallback: string; label: string; lineNumber: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = text?.trim() || fallback;
  const canExpand = content.length > 48 || content.includes("\n");
  return <td className="min-w-[180px] max-w-[260px] px-3 py-2 align-top">
    <span className={`block min-w-0 leading-5 ${canExpand && !expanded ? "line-clamp-2 break-words" : "max-h-40 overflow-y-auto whitespace-pre-wrap break-words"}`} title={canExpand && !expanded ? content : undefined}>{content}</span>
    {canExpand ? <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}第 ${lineNumber} 项${label}`} className="mt-1 text-xs font-medium text-blue-700 hover:underline">{expanded ? "收起" : "展开"}</button> : null}
  </td>;
}
type Payload = {
  order: {
    id: string;
    order_number: string;
    warehouse_reference_number: string | null;
    quote_id: string;
    quote_number: string;
    customer_short_name: string;
    customer_name_snapshot?: string | null;
    customer_tax_number_snapshot?: string | null;
    customer?: { contact_name?: string | null; company_name?: string | null; tax_number?: string | null } | null;
    destination_country: string | null;
    currency: string;
    show_dual_currency_prices: boolean | null;
    subtotal: number;
    shipping_cost: number;
    last_balance_amount: number | null;
    other_charge_amount: number | null;
    discount_amount: number | null;
    paypal_fee_amount: number | null;
    total_amount: number;
    fx_rate_cny_to_payment: number | null;
    subtotal_cny: number | null;
    shipping_cny: number | null;
    total_cny: number | null;
    payment_account_snapshot: string | null;
    delivery_recipient: string | null;
    delivery_phone: string | null;
    delivery_email: string | null;
    delivery_address: string | null;
    forwarder_address: string | null;
    forwarder_recipient: string | null;
    forwarder_phone: string | null;
    payment_method: string | null;
    delivery_date: string | null;
    confirmation_method: string | null;
    confirmation_note: string | null;
    status: SalesOrderStatus;
    confirmed_at: string | null;
    pi_revision: number;
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
    unit_price_cny: number | null;
    estimated_unit_cost_cny: number | null;
    preparation_requirement: string | null;
    internal_note: string | null;
    amount: number;
  }>;
  stock_order: { id: string; stock_number: string; status: string; progress: StockProgress } | null;
  receiving_progress: { total_items: number; received_items: number; ordered_units: number; received_units: number } | null;
  can_edit_draft: boolean;
  can_delete_draft: boolean;
  can_submit: boolean;
  can_recall: boolean;
  can_edit: boolean;
  can_cancel: boolean;
  can_export: boolean;
  can_preview: boolean;
  can_view_stock: boolean;
};

function PiInfoCards({ order: o }: { order: Payload["order"] }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const feeRows = ([
    ["产品小计", Number(o.subtotal)],
    ["运费", Number(o.shipping_cost)],
    ["未付尾款（加收）", Number(o.last_balance_amount || 0)],
    ["其他费用（加收）", Number(o.other_charge_amount || 0)],
    ["折扣（扣减）", -Number(o.discount_amount || 0)],
    ["PayPal 手续费（加收）", Number(o.paypal_fee_amount || 0)],
  ] as Array<[string, number]>).filter(([label, amount]) => label === "产品小计" || amount !== 0);
  const card = "min-w-0 rounded-lg border border-slate-200 bg-white p-3";
  return <><div className="grid items-stretch gap-3 border-t px-5 py-3 text-sm md:grid-cols-2 xl:grid-cols-4">
    <section className={card}><h3 className="mb-2 font-semibold text-slate-800">客户收货信息</h3><div className="space-y-1 text-slate-600">
      <p>收货人：{o.delivery_recipient || "—"}</p><p>电话：{o.delivery_phone || "—"}</p>
      <p className="break-all">邮箱：{o.delivery_email || "—"}</p><p className="break-words">收货地址：{o.delivery_address || "—"}</p>
      {o.delivery_date ? <p>预计交付日期：{o.delivery_date}</p> : null}
    </div></section>
    <section className={card}><h3 className="mb-2 font-semibold text-slate-800">货代收货信息</h3><div className="space-y-1 text-slate-600">
      <p>收货人：{o.forwarder_recipient || "未填写"}</p><p>电话：{o.forwarder_phone || "未填写"}</p>
      <p className="break-words">收货地址：{o.forwarder_address || "未填写"}</p>
    </div></section>
    <section className={card}><h3 className="mb-2 font-semibold text-slate-800">付款与汇率</h3><div className="space-y-1 text-slate-600">
      <p className="text-lg font-semibold text-blue-700 tabular-nums">{o.currency} {Number(o.total_amount).toFixed(2)}</p>
      <p>付款方式：{o.payment_method || "—"}</p>
      <p>汇率：1 {o.currency} ≈ {Number(o.fx_rate_cny_to_payment) > 0 ? Number((1 / Number(o.fx_rate_cny_to_payment)).toPrecision(8)) : "—"} CNY</p>
      <p>人民币总额：¥{Number(o.total_cny).toFixed(2)}</p>
      <p>价格展示：{o.show_dual_currency_prices === true ? `CNY / ${o.currency} 双币种` : `仅 ${o.currency}`}</p>
      {o.payment_account_snapshot ? <button type="button" onClick={() => setAccountOpen(true)} className="pt-1 text-left font-medium text-blue-700 hover:underline">查看收款账户</button> : null}
    </div></section>
    <section className={card}><h3 className="mb-2 font-semibold text-slate-800">费用明细 · {o.currency}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-slate-600 tabular-nums">{feeRows.map(([label, amount]) => <div key={label} className="contents"><dt>{label}</dt><dd className="text-right">{amount.toFixed(2)}</dd></div>)}
        <dt className="border-t border-slate-200 pt-2 font-semibold text-slate-800">客户应付总额</dt><dd className="border-t border-slate-200 pt-2 text-right font-semibold text-blue-700">{Number(o.total_amount).toFixed(2)}</dd>
      </dl>
    </section>
  </div><AppDialog open={accountOpen} onClose={() => setAccountOpen(false)} title="本单收款账户快照"><p className="whitespace-pre-wrap break-all text-sm leading-6 text-slate-700">{o.payment_account_snapshot || "—"}</p></AppDialog></>;
}
export function OrderDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState("");
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallReason, setRecallReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
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
  async function deleteDraft() {
    if (!data) return;
    setBusy(true);
    const response = await fetch(`/api/orders/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: data.order.pi_revision }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    setDeleteOpen(false);
    if (!response.ok) {
      setError(body.error || "删除PI草稿失败");
      return;
    }
    router.push("/orders");
    router.refresh();
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
  const directPi = o.confirmation_method === "DIRECT_PI";
  const productSalesCny = data.items.reduce((sum, item) => sum + Number(item.unit_price_cny || 0) * Number(item.quantity || 0), 0);
  const productCostCny = data.items.reduce((sum, item) => sum + Number(item.estimated_unit_cost_cny || 0) * Number(item.quantity || 0), 0);
  const productProfitCny = productSalesCny - productCostCny;
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-wrap justify-between gap-2">
          <Link
            href="/orders"
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm"
          >
            <ArrowLeft size={16} />
            返回PI订单列表
          </Link>
          <div className="flex flex-wrap gap-2">
            {directPi && data.stock_order && o.status !== "DRAFT" ? <button type="button" disabled={loading} onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm disabled:opacity-50"><RefreshCw size={15}/>刷新备货进度</button> : null}
            {data.can_preview && directPi && o.status !== "CANCELLED" ? <Link href={`/orders/${id}/preview`} className="inline-flex h-9 items-center rounded-lg border px-3 text-sm text-blue-700">预览{data.can_export ? " / 打印" : "草稿"}</Link> : null}
            {data.can_export ? <details className="relative z-20">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border bg-white px-3 text-sm text-violet-700 hover:bg-violet-50"><FileDown size={16} />导出{directPi ? " PI" : "历史订单"}<span aria-hidden="true">▾</span></summary>
              <div className="absolute right-0 top-full mt-1 min-w-44 rounded-lg border bg-white p-1 shadow-lg">
                <a href={`/api/orders/${id}/export`} className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">导出 Excel</a>
                {directPi ? <Link href={`/orders/${id}/preview?export=pdf`} target="_blank" rel="noopener noreferrer" title="打开打印窗口并选择另存为 PDF" className="block rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">导出 PDF</Link> : null}
              </div>
            </details> : null}
            {!directPi ? <Link
              href={`/quotes/${o.quote_id}`}
              className="h-9 rounded-lg border px-3 py-2 text-sm text-blue-700"
            >
              查看关联报价
            </Link> : null}
            {data.can_view_stock && data.stock_order && !(directPi && o.status === "DRAFT") ? <Link
              href={`/stock-orders/${data.stock_order.id}`}
              className="h-9 rounded-lg border px-3 py-2 text-sm text-emerald-700"
            >
              查看备货单
            </Link> : null}
            {data.can_edit_draft ? <Link href={`/orders/${id}/edit`} className="h-9 rounded-lg border px-3 py-2 text-sm text-blue-700">修改PI草稿及商品</Link> : null}
            {data.can_delete_draft ? <button type="button" disabled={busy} onClick={() => setDeleteOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-200 px-3 text-sm text-rose-700 disabled:opacity-50"><Trash2 size={15}/>删除未提交草稿</button> : null}
            {data.can_submit ? <button type="button" disabled={busy} onClick={() => void patch(`/api/orders/${id}/submit`, { revision: o.pi_revision }, "POST")} className="h-9 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50">确认PI并生成备货单</button> : null}
            {data.can_recall ? <button type="button" disabled={busy} onClick={() => setRecallOpen(true)} className="h-9 rounded-lg border border-amber-300 px-3 text-sm text-amber-800">撤回修改</button> : null}
          </div>
        </div>
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <h1 className="text-xl font-bold">{directPi ? "PI订单" : "历史销售订单"} {o.order_number}</h1>
              <p className="mt-1 text-sm text-slate-500">{directPi ? "客户订单编号" : "报价编号"}：<span className="font-semibold text-slate-800">{directPi ? o.warehouse_reference_number : o.quote_number}</span> · 销售员：{o.owner?.name || o.owner?.email || "-"}</p>
            </div>
            <AppStatusBadge status={o.status} tone={directPi && (PI_EXECUTING_STATUSES as readonly string[]).includes(o.status) ? "violet" : undefined}>{directPi ? piOrderStatusLabel(o.status) : SALES_ORDER_STATUS_LABELS[o.status]}</AppStatusBadge>
          </header>
          {error ? (
            <p className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {directPi ? <>
            <div className="grid gap-3 px-5 py-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">客户名称（本单快照）</p><p className="mt-1 text-lg font-semibold text-slate-900">{o.customer_name_snapshot?.trim() || "历史未留存"}</p><p className="text-sm text-slate-600">公司名称：{o.customer_short_name}</p><p className="break-words text-sm text-slate-600">公司税号（本单）：{o.customer_tax_number_snapshot?.trim() || "历史未留存"}</p><div className="text-sm text-slate-600"><CountryLabel value={o.destination_country}/></div></div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-blue-700">客户应付总额 · 含各项费用</p><p className="mt-1 text-xl font-bold tabular-nums text-blue-800">{o.currency} {Number(o.total_amount).toFixed(2)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">产品销售额 / 产品毛利 · 人民币</p><p className="mt-1 font-semibold tabular-nums">¥{productSalesCny.toFixed(2)} <span className="text-slate-400">/</span> <span className={productProfitCny < 0 ? "text-rose-700" : "text-emerald-700"}>¥{productProfitCny.toFixed(2)}</span></p><p className="mt-1 text-xs text-slate-500">产品毛利率 {productSalesCny > 0 ? (productProfitCny / productSalesCny * 100).toFixed(2) : "0.00"}% · 不含运费</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="mb-2 text-xs text-slate-500">备货进度</p>{data.stock_order && o.status !== "DRAFT" ? <StockProgressCell progress={data.stock_order.progress}/> : <p className="text-sm font-medium text-slate-600">{o.status === "DRAFT" ? "PI草稿未提交仓库" : SALES_ORDER_STATUS_LABELS[o.status]}</p>}</div>
            </div>
            <PiInfoCards order={o} />
            <p className="border-t px-5 py-2 text-xs text-slate-400">PI系统ID：{o.id}</p>
          </> : <div className="grid gap-4 p-5 md:grid-cols-5">{[["客户名称", o.customer?.contact_name?.trim() || "未填写"], ["公司名称", o.customer_short_name], ["目的国家", o.destination_country || "-"], ["确认渠道", o.confirmation_method || "-"], ["确认时间", o.confirmed_at ? new Date(o.confirmed_at).toLocaleString("zh-CN") : "尚未提交仓库"]].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 p-4"><small className="text-slate-500">{k}</small><p className="mt-2 font-medium">{k === "目的国家" ? <CountryLabel value={o.destination_country}/> : v}</p></div>)}</div>}
          {directPi && data.stock_order && o.status === "DRAFT" ? <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-amber-50 px-5 py-3 text-sm text-amber-800"><span>原备货单已撤回（历史），当前不作为仓库待办。修改 PI 草稿并重新提交后，仓库才会收到更新后的备货单。</span>{data.can_view_stock ? <Link href={`/stock-orders/${data.stock_order.id}`} className="font-medium text-blue-700 underline underline-offset-2">查看原备货记录</Link> : null}</div> : null}
          <div className="overflow-x-auto border-y">
            <table className={`w-full text-left text-sm ${directPi ? "min-w-[1550px]" : "min-w-[900px]"}`}>
              <thead className="bg-slate-50 text-xs">
                <tr>
                  {[
                    "序号",
                    directPi ? "产品类型" : "产品",
                    directPi ? "产品品牌" : "品牌",
                    directPi ? "产品型号" : "型号",
                    directPi ? "产品质量" : "质量",
                    directPi ? "产品描述" : "客户描述",
                    "数量",
                    ...(directPi ? ["销售单价（人民币）", "成本单价（人民币）", "利润率"] : []),
                    "单价",
                    "金额",
                    ...(directPi ? ["理货要求", "仓库备注"] : []),
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
                    {directPi ? <><td className="px-3 py-3">¥{Number(i.unit_price_cny).toFixed(2)}</td><td className="px-3 py-3">¥{Number(i.estimated_unit_cost_cny).toFixed(2)}</td><td className="px-3 py-3">{Number(i.unit_price_cny) > 0 ? `${((Number(i.unit_price_cny) - Number(i.estimated_unit_cost_cny)) / Number(i.unit_price_cny) * 100).toFixed(2)}%` : "—"}</td></> : null}
                    <td className="px-3 py-3">
                      {o.currency} {Number(i.unit_price).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {o.currency} {Number(i.amount).toFixed(2)}
                    </td>
                    {directPi ? <><PiInternalTextCell text={i.preparation_requirement} fallback="常规理货" label="理货要求" lineNumber={i.line_number}/><PiInternalTextCell text={i.internal_note} fallback="—" label="仓库备注" lineNumber={i.line_number}/></> : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-blue-50">
                  <td colSpan={directPi ? 11 : 8} className="px-3 py-3 text-right">
                    订单总额（含运费及各项费用）
                  </td>
                  <td className="px-3 py-3 font-bold text-blue-700">
                    {o.currency} {Number(o.total_amount).toFixed(2)}
                  </td>
                  {directPi ? <td colSpan={2}/> : null}
                </tr>
              </tfoot>
            </table>
          </div>
          {directPi ? <div className="border-b p-5 text-sm"><b>订单变更说明</b><p className="mt-2 whitespace-pre-wrap text-slate-700">{o.confirmation_note ? numberedPiChangeNote(o.confirmation_note) : "暂无变更"}</p></div> : null}
          {!directPi ? <section className="grid gap-4 p-5 md:grid-cols-2">
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
          </section> : null}
          {data.can_cancel || (data.can_edit && !directPi) ? (
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
              {data.can_edit && !directPi ? (
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
              {directPi ? (o.status === "DRAFT" ? "PI草稿可由归属销售员修改，确认提交前仓库不可见。" : "已提交PI的产品、价格、汇率及收款信息不得静默改写；仓库尚未开始时可撤回修改。") : "订单产品与价格是客户确认时的历史快照，不允许直接改写；其他用户仅可查看。"}
            </footer>
          )}
        </section>
        <AppDialog open={deleteOpen} title="删除未提交的PI草稿" description="仅从未提交过、也未生成备货单的草稿可删除；删除后无法恢复。" onClose={() => setDeleteOpen(false)} width="max-w-md">
          <p className="text-sm text-slate-700">确认删除 PI {o.order_number} 及其产品明细吗？</p>
          <form onSubmit={(event) => { event.preventDefault(); void deleteDraft(); }}><DialogActions busy={busy} onCancel={() => setDeleteOpen(false)} confirmLabel="确认删除草稿" tone="danger"/></form>
        </AppDialog>
        <AppDialog open={cancelOpen} title="取消销售订单" description="订单和关联备货单将同步取消；客户阶段会按剩余的有效报价或意向凭证自动回退。" onClose={()=>setCancelOpen(false)} width="max-w-md">
          <label className="text-sm font-medium text-slate-700">真实取消原因<textarea autoFocus required value={cancelReason} onChange={event=>setCancelReason(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" placeholder="请输入客户取消、内容变更或其他真实原因"/></label>
          <form onSubmit={event=>{event.preventDefault();if(cancelReason.trim()){void patch(`/api/orders/${id}/cancel`,{reason:cancelReason.trim()},"POST");setCancelOpen(false)}}}><DialogActions busy={busy} onCancel={()=>setCancelOpen(false)} confirmLabel="确认取消订单" tone="danger"/></form>
        </AppDialog>
        <AppDialog open={recallOpen} title="撤回PI备货单" description="仅仓库尚未开始备货时可撤回。撤回后PI回到草稿，修改并重新提交才会再次通知仓库。" onClose={() => setRecallOpen(false)} width="max-w-md">
          <label className="text-sm font-medium text-slate-700">撤回原因<textarea autoFocus required value={recallReason} onChange={(event) => setRecallReason(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" /></label>
          <form onSubmit={(event) => { event.preventDefault(); if (recallReason.trim()) { void patch(`/api/orders/${id}/recall`, { reason: recallReason.trim() }, "POST"); setRecallOpen(false); } }}><DialogActions busy={busy} onCancel={() => setRecallOpen(false)} confirmLabel="确认撤回" /></form>
        </AppDialog>
      </div>
    </main>
  );
}
