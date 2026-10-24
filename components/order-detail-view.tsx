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
    created_at: string;
    updated_at: string;
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
    last_balance_cny: number | null;
    other_charge_cny: number | null;
    discount_cny: number | null;
    paypal_fee_cny: number | null;
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
  stock_order: { id: string; stock_number: string; status: string; created_at: string; updated_at: string; progress: StockProgress } | null;
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
  const fx = Number(o.fx_rate_cny_to_payment);
  const toCny = (cny: number | null, payment: number) => typeof cny === "number" && Number.isFinite(cny)
    ? cny : fx > 0 ? payment / fx : null;
  const feeRows = [
    { label: "产品小计", payment: Number(o.subtotal), cny: toCny(o.subtotal_cny, Number(o.subtotal)) },
    { label: "运费", payment: Number(o.shipping_cost), cny: toCny(o.shipping_cny, Number(o.shipping_cost)) },
    { label: "未付尾款（加收）", payment: Number(o.last_balance_amount || 0), cny: toCny(o.last_balance_cny, Number(o.last_balance_amount || 0)) },
    { label: "其他费用（加收）", payment: Number(o.other_charge_amount || 0), cny: toCny(o.other_charge_cny, Number(o.other_charge_amount || 0)) },
    { label: "折扣（扣减）", payment: -Number(o.discount_amount || 0), cny: toCny(o.discount_cny === null ? null : -Number(o.discount_cny), -Number(o.discount_amount || 0)) },
    { label: "PayPal 手续费（加收）", payment: Number(o.paypal_fee_amount || 0), cny: toCny(o.paypal_fee_cny, Number(o.paypal_fee_amount || 0)) },
  ].filter((row) => row.label === "产品小计" || row.payment !== 0 || (row.cny !== null && row.cny !== 0));
  const totalCny = toCny(o.total_cny, Number(o.total_amount));
  const hasCustomerDelivery = Boolean(o.delivery_recipient || o.delivery_phone || o.delivery_email || o.delivery_address || o.delivery_date);
  const hasForwarder = Boolean(o.forwarder_recipient || o.forwarder_phone || o.forwarder_address);
  const detailClass = "group min-w-0 rounded-lg border border-slate-200 bg-white";
  const summaryClass = "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm";
  return <div className="grid gap-2 border-t px-5 py-2 xl:grid-cols-2">
    <details className={detailClass}>
      <summary className={summaryClass}>
        <span className="font-semibold text-slate-800">收货信息</span>
        <span className="min-w-0 truncate text-right text-xs text-slate-500">
          {hasCustomerDelivery || hasForwarder
            ? [hasCustomerDelivery ? `客户：${o.delivery_recipient || "已填写"}` : "", hasForwarder ? `货代：${o.forwarder_recipient || "已填写"}` : ""].filter(Boolean).join(" · ")
            : "本单未记录收货信息"}
          <span className="ml-2 text-blue-700 group-open:hidden">展开</span>
          <span className="ml-2 hidden text-blue-700 group-open:inline">收起</span>
        </span>
      </summary>
      <div className="grid gap-3 border-t bg-slate-50/70 p-3 text-sm sm:grid-cols-2">
        <section className="min-w-0">
          <h3 className="mb-1 font-medium text-slate-700">客户收货</h3>
          {hasCustomerDelivery ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-slate-600">
            {o.delivery_recipient ? <><dt>收货人</dt><dd className="break-words">{o.delivery_recipient}</dd></> : null}
            {o.delivery_phone ? <><dt>电话</dt><dd className="break-words">{o.delivery_phone}</dd></> : null}
            {o.delivery_email ? <><dt>邮箱</dt><dd className="break-all">{o.delivery_email}</dd></> : null}
            {o.delivery_address ? <><dt>地址</dt><dd className="break-words">{o.delivery_address}</dd></> : null}
            {o.delivery_date ? <><dt>预计交付</dt><dd>{o.delivery_date}</dd></> : null}
          </dl> : <p className="text-xs text-slate-500">未填写</p>}
        </section>
        <section className="min-w-0">
          <h3 className="mb-1 font-medium text-slate-700">货代收货</h3>
          {hasForwarder ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-slate-600">
            {o.forwarder_recipient ? <><dt>收货人</dt><dd className="break-words">{o.forwarder_recipient}</dd></> : null}
            {o.forwarder_phone ? <><dt>电话</dt><dd className="break-words">{o.forwarder_phone}</dd></> : null}
            {o.forwarder_address ? <><dt>地址</dt><dd className="break-words">{o.forwarder_address}</dd></> : null}
          </dl> : <p className="text-xs text-slate-500">未填写</p>}
        </section>
      </div>
    </details>
    <details className={detailClass}>
      <summary className={summaryClass}>
        <span className="font-semibold text-slate-800">付款与费用明细</span>
        <span className="min-w-0 truncate text-right text-xs text-slate-500">
          {o.payment_method || "未记录付款方式"}{fx > 0 ? ` · 1 ${o.currency} ≈ ${Number((1 / fx).toPrecision(6))} CNY` : ""}
          <span className="ml-2 text-blue-700 group-open:hidden">展开</span>
          <span className="ml-2 hidden text-blue-700 group-open:inline">收起</span>
        </span>
      </summary>
      <div className="grid gap-3 border-t bg-slate-50/70 p-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-1 text-sm text-slate-600">
          <p>付款方式：{o.payment_method || "—"}</p>
          <p>汇率：1 {o.currency} ≈ {fx > 0 ? Number((1 / fx).toPrecision(8)) : "—"} CNY</p>
          <p>应付金额：{totalCny === null ? "RMB —" : `¥${Number(totalCny).toFixed(2)}`}{o.currency !== "CNY" ? ` · ${o.currency} ${Number(o.total_amount).toFixed(2)}` : ""}</p>
          {o.payment_account_snapshot ? <p className="break-words"><span className="font-medium">收款账户：</span>{o.payment_account_snapshot}</p> : null}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-500">费用项目及金额</p>
          <dl className={`grid gap-x-3 gap-y-1 text-xs text-slate-600 tabular-nums ${o.currency === "CNY" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto]"}`}>
            <dt className="font-medium text-slate-500">费用项目</dt><dd className="text-right font-medium text-slate-500">RMB</dd>{o.currency !== "CNY" ? <dd className="text-right font-medium text-slate-500">{o.currency}</dd> : null}
            {feeRows.map((row) => <div key={row.label} className="contents"><dt className="min-w-0">{row.label}</dt><dd className="whitespace-nowrap text-right">{row.cny === null ? "—" : Number(row.cny).toFixed(2)}</dd>{o.currency !== "CNY" ? <dd className="whitespace-nowrap text-right">{row.payment.toFixed(2)}</dd> : null}</div>)}
            <dt className="border-t border-slate-200 pt-1 font-semibold text-slate-800">总计</dt><dd className="whitespace-nowrap border-t border-slate-200 pt-1 text-right font-semibold text-blue-700">{totalCny === null ? "—" : Number(totalCny).toFixed(2)}</dd>{o.currency !== "CNY" ? <dd className="whitespace-nowrap border-t border-slate-200 pt-1 text-right font-semibold text-blue-700">{Number(o.total_amount).toFixed(2)}</dd> : null}
          </dl>
        </div>
      </div>
    </details>
  </div>;
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
  const totalFx = Number(o.fx_rate_cny_to_payment);
  const totalCny = typeof o.total_cny === "number" && Number.isFinite(o.total_cny)
    ? o.total_cny : totalFx > 0 ? Number(o.total_amount) / totalFx : null;
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
            <div className="min-w-0">
              <h1 className="break-all text-xl font-bold">{directPi ? "PI订单" : "历史销售订单"} {directPi ? (o.warehouse_reference_number || o.order_number) : o.order_number}</h1>
              <p className="mt-1 break-all text-xs text-slate-500">{directPi ? "系统PI编号" : "报价编号"}：{directPi ? o.order_number : o.quote_number} · 销售员：{o.owner?.name || o.owner?.email || "-"}</p>
              {directPi ? (
                <p className="mt-1 text-xs text-slate-500">
                  创建：{new Date(o.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}
                  · 最近更新：{new Date(o.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}
                </p>
              ) : null}
            </div>
            <AppStatusBadge status={o.status} tone={directPi && (PI_EXECUTING_STATUSES as readonly string[]).includes(o.status) ? "violet" : undefined}>{directPi ? piOrderStatusLabel(o.status) : SALES_ORDER_STATUS_LABELS[o.status]}</AppStatusBadge>
          </header>
          {error ? (
            <p className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {directPi ? <>
            <div className="grid gap-3 px-5 py-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">客户名称（本单快照）</p><p className="mt-1 text-lg font-semibold text-slate-900">{o.customer_name_snapshot?.trim() || "历史未留存"}</p><p className="text-sm text-slate-600">公司名称：{o.customer_short_name}</p><p className="break-words text-sm text-slate-600">客户税号（本单）：{o.customer_tax_number_snapshot?.trim() || "历史未留存"}</p><div className="text-sm text-slate-600"><CountryLabel value={o.destination_country}/></div></div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-blue-700">客户应付总额 · 含各项费用</p><p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xl font-bold tabular-nums text-blue-800"><span>{totalCny === null ? "RMB —" : `¥${Number(totalCny).toFixed(2)}`}</span>{o.currency !== "CNY" ? <span className="text-base">{o.currency} {Number(o.total_amount).toFixed(2)}</span> : null}</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">产品销售额 / 产品毛利 · 人民币</p><p className="mt-1 font-semibold tabular-nums">¥{productSalesCny.toFixed(2)} <span className="text-slate-400">/</span> <span className={productProfitCny < 0 ? "text-rose-700" : "text-emerald-700"}>¥{productProfitCny.toFixed(2)}</span></p><p className="mt-1 text-xs text-slate-500">产品毛利率 {productSalesCny > 0 ? (productProfitCny / productSalesCny * 100).toFixed(2) : "0.00"}% · 不含运费</p></div>
            </div>
            <PiInfoCards order={o} />
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
                    ...(directPi ? ["理货要求", "销售备注"] : []),
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
                    {directPi ? <><PiInternalTextCell text={i.preparation_requirement} fallback="常规理货" label="理货要求" lineNumber={i.line_number}/><PiInternalTextCell text={i.internal_note} fallback="—" label="销售备注" lineNumber={i.line_number}/></> : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-blue-50">
                  <td colSpan={directPi ? 11 : 8} className="px-3 py-3 text-right">
                    订单总额（含运费及各项费用）
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-blue-700">
                    <span className="inline-flex flex-wrap justify-end gap-x-4 gap-y-1 whitespace-nowrap"><span>{directPi ? totalCny === null ? "RMB —" : `¥${Number(totalCny).toFixed(2)}` : `${o.currency} ${Number(o.total_amount).toFixed(2)}`}</span>{directPi && o.currency !== "CNY" ? <span>{o.currency} {Number(o.total_amount).toFixed(2)}</span> : null}</span>
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
