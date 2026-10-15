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
import { stockProgressLabel, type StockProgress } from "@/lib/stock-progress";
import { containsChinese, needsCustomerEnglishReview, suggestCustomerEnglish } from "@/lib/pi-customer-text";
type Payload = {
  order: {
    id: string;
    order_number: string;
    warehouse_reference_number: string | null;
    quote_id: string;
    quote_number: string;
    customer_short_name: string;
    destination_country: string | null;
    currency: string;
    subtotal: number;
    shipping_cost: number;
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
    quality_en: string | null;
    description: string | null;
    description_en: string | null;
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
  can_edit_customer_text: boolean;
  can_delete_draft: boolean;
  can_submit: boolean;
  can_recall: boolean;
  can_edit: boolean;
  can_cancel: boolean;
  can_export: boolean;
};
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
  const [customerTextOpen, setCustomerTextOpen] = useState(false);
  const [customerTextRows, setCustomerTextRows] = useState<Array<{ line_number: number; quality_en: string; description_en: string }>>([]);
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
    setCustomerTextRows((b.items || []).map((item: Payload["items"][number]) => ({ line_number: item.line_number, quality_en: item.quality_en || "", description_en: item.description_en || "" })));
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
  async function saveCustomerText() {
    if (!data) return;
    setBusy(true);
    const response = await fetch(`/api/orders/${id}/customer-text`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: data.order.pi_revision, items: customerTextRows }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(body.error || "客户英文内容保存失败"); return; }
    setCustomerTextOpen(false);
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
  const directPi = o.confirmation_method === "DIRECT_PI";
  const needsEnglish = directPi && needsCustomerEnglishReview(data.items);
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
          <div className="flex gap-2">
            {directPi && data.stock_order && o.status !== "DRAFT" ? <button type="button" disabled={loading} onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm disabled:opacity-50"><RefreshCw size={15}/>刷新备货进度</button> : null}
            {directPi && o.status !== "CANCELLED" ? <Link href={`/orders/${id}/preview`} className="inline-flex h-9 items-center rounded-lg border px-3 text-sm text-blue-700">预览{data.can_export ? " / 打印" : "草稿"}</Link> : null}
            {directPi && data.can_edit_customer_text ? <button type="button" onClick={() => setCustomerTextOpen(true)} className="h-9 rounded-lg border border-blue-200 px-3 text-sm text-blue-700">核对客户英文{needsEnglish ? " · 待完成" : ""}</button> : null}
            {data.can_export && !needsEnglish ? (
              <a
                href={`/api/orders/${id}/export`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-violet-700"
              >
                <FileDown size={16} />
                {directPi ? "导出PI Excel" : "导出历史订单Excel"}
              </a>
            ) : null}
            {!directPi ? <Link
              href={`/quotes/${o.quote_id}`}
              className="h-9 rounded-lg border px-3 py-2 text-sm text-blue-700"
            >
              查看关联报价
            </Link> : null}
            {data.stock_order && !(directPi && o.status === "DRAFT") ? <Link
              href={`/stock-orders/${data.stock_order.id}`}
              className="h-9 rounded-lg border px-3 py-2 text-sm text-emerald-700"
            >
              查看/完善备货单
            </Link> : null}
            {data.can_edit_draft ? <Link href={`/orders/${id}/edit`} className="h-9 rounded-lg border px-3 py-2 text-sm text-blue-700">修改PI草稿及商品</Link> : null}
            {data.can_delete_draft ? <button type="button" disabled={busy} onClick={() => setDeleteOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-200 px-3 text-sm text-rose-700 disabled:opacity-50"><Trash2 size={15}/>删除未提交草稿</button> : null}
            {data.can_submit ? <button type="button" disabled={busy} onClick={() => void patch(`/api/orders/${id}/submit`, { revision: o.pi_revision }, "POST")} className="h-9 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50">确认PI并生成备货单</button> : null}
            {data.can_recall ? <button type="button" disabled={busy} onClick={() => setRecallOpen(true)} className="h-9 rounded-lg border border-amber-300 px-3 text-sm text-amber-800">撤回修改</button> : null}
          </div>
        </div>
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap justify-between gap-3 border-b p-5">
            <div>
              <h1 className="text-xl font-bold">{directPi ? "PI订单" : "历史销售订单"} {o.order_number}</h1>
              <p className="mt-1 text-sm text-slate-500">{directPi ? "客户订单编号" : "报价编号"}：<span className="font-semibold text-slate-800">{directPi ? o.warehouse_reference_number : o.quote_number}</span> · 销售员：{o.owner?.name || o.owner?.email || "-"}</p>
            </div>
            <AppStatusBadge status={o.status}>{directPi && o.status === "WAITING_STOCK" && data.stock_order?.progress.percent ? stockProgressLabel(data.stock_order.progress) : SALES_ORDER_STATUS_LABELS[o.status]}</AppStatusBadge>
          </header>
          {error ? (
            <p className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {directPi ? <>
            <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-500">客户名称 · 目的国家</p><p className="mt-2 text-lg font-semibold text-slate-900">{o.customer_short_name}</p><div className="mt-1 text-sm text-slate-600"><CountryLabel value={o.destination_country}/></div></div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="text-xs text-blue-700">客户应付总额 · 含运费</p><p className="mt-2 text-xl font-bold tabular-nums text-blue-800">{o.currency} {Number(o.total_amount).toFixed(2)}</p><p className="mt-1 text-xs text-blue-700">其中运费 {o.currency} {Number(o.shipping_cost).toFixed(2)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-500">产品销售额 / 产品毛利 · 人民币</p><p className="mt-2 font-semibold tabular-nums">¥{productSalesCny.toFixed(2)} <span className="text-slate-400">/</span> <span className={productProfitCny < 0 ? "text-rose-700" : "text-emerald-700"}>¥{productProfitCny.toFixed(2)}</span></p><p className="mt-1 text-xs text-slate-500">产品毛利率 {productSalesCny > 0 ? (productProfitCny / productSalesCny * 100).toFixed(2) : "0.00"}% · 不含运费</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="mb-2 text-xs text-slate-500">备货进度</p>{data.stock_order && o.status !== "DRAFT" ? <StockProgressCell progress={data.stock_order.progress}/> : <p className="text-sm font-medium text-slate-600">{o.status === "DRAFT" ? "PI草稿未提交仓库" : SALES_ORDER_STATUS_LABELS[o.status]}</p>}</div>
            </div>
            <div className="grid gap-4 border-t px-5 py-4 text-sm lg:grid-cols-2">
              <div><h2 className="font-semibold text-slate-800">订单与收货信息</h2><p className="mt-2 text-slate-600">确认时间：{o.confirmed_at ? new Date(o.confirmed_at).toLocaleString("zh-CN") : "尚未提交仓库"} · 收件人：{o.delivery_recipient || "—"}</p><p className="mt-1 text-slate-600">电话：{o.delivery_phone || "—"} · 邮箱：{o.delivery_email || "—"}</p><p className="mt-1 break-words text-slate-600">收货地址：{o.delivery_address || "—"}</p></div>
              <div><h2 className="font-semibold text-slate-800">付款与汇率</h2><p className="mt-2 text-slate-600">付款方式：{o.payment_method || "—"} · 1 {o.currency} ≈ {Number(o.fx_rate_cny_to_payment) > 0 ? Number((1 / Number(o.fx_rate_cny_to_payment)).toPrecision(8)) : "—"} CNY</p><p className="mt-1 text-slate-600">人民币总额（含运费）：¥{Number(o.total_cny).toFixed(2)}</p><details className="mt-2"><summary className="cursor-pointer text-blue-700">查看收款账户快照</summary><p className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-slate-600">{o.payment_account_snapshot || "—"}</p></details></div>
            </div>
            <p className="border-t px-5 py-2 text-xs text-slate-400">PI系统ID：{o.id}</p>
          </> : <div className="grid gap-4 p-5 md:grid-cols-4">{[["客户名称", o.customer_short_name], ["目的国家", o.destination_country || "-"], ["确认渠道", o.confirmation_method || "-"], ["确认时间", o.confirmed_at ? new Date(o.confirmed_at).toLocaleString("zh-CN") : "尚未提交仓库"]].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 p-4"><small className="text-slate-500">{k}</small><p className="mt-2 font-medium">{k === "目的国家" ? <CountryLabel value={o.destination_country}/> : v}</p></div>)}</div>}
          {directPi && data.stock_order && o.status === "DRAFT" ? <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-amber-50 px-5 py-3 text-sm text-amber-800"><span>原备货单已撤回（历史），当前不作为仓库待办。修改 PI 草稿并重新提交后，仓库才会收到更新后的备货单。</span><Link href={`/stock-orders/${data.stock_order.id}`} className="font-medium text-blue-700 underline underline-offset-2">查看原备货记录</Link></div> : null}
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
                    ...(directPi ? ["人民币单价", "预估成本", "利润率"] : []),
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
                    {directPi ? <><td className="px-3 py-3">¥{Number(i.unit_price_cny).toFixed(2)}</td><td className="px-3 py-3">¥{Number(i.estimated_unit_cost_cny).toFixed(2)}</td><td className="px-3 py-3">{Number(i.unit_price_cny) > 0 ? `${((Number(i.unit_price_cny) - Number(i.estimated_unit_cost_cny)) / Number(i.unit_price_cny) * 100).toFixed(2)}%` : "—"}</td></> : null}
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
                  <td colSpan={directPi ? 11 : 8} className="px-3 py-3 text-right">
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
          {directPi ? <div className="border-b p-5 text-sm"><b>订单变更说明</b><p className="mt-2 whitespace-pre-wrap text-slate-700">{o.confirmation_note ? numberedPiChangeNote(o.confirmation_note) : "暂无变更"}</p><b className="mt-4 block">逐项理货要求与仓库备注</b><div className="mt-2 space-y-1">{data.items.map((item) => <p key={item.id}>{item.line_number}. {item.item_name}：{item.preparation_requirement || "常规理货"}{item.internal_note ? `；备注：${item.internal_note}` : ""}</p>)}</div></div> : null}
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
            {!directPi ? <label className="text-sm">
              <span className="mb-1.5 block text-slate-600">客户确认说明</span>
              <textarea
                disabled={!data.can_edit}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full rounded-lg border p-3"
              />
            </label> : null}
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
              {directPi ? (o.status === "DRAFT" ? "PI草稿可由归属销售员修改，确认提交前仓库不可见。" : "已提交PI的产品、价格、汇率及收款信息不得静默改写；仓库尚未开始时可撤回修改。") : "订单产品与价格是客户确认时的历史快照，不允许直接改写；其他用户仅可查看。"}
            </footer>
          )}
        </section>
        <AppDialog open={customerTextOpen} title="核对客户英文质量与描述" description="仅影响客户版PI预览和导出，原中文及仓库备货内容保持不变。常见术语仅提供建议，必须由销售员核对。已提交PI的英文修订会写入审计记录。" onClose={() => setCustomerTextOpen(false)} width="max-w-3xl">
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">{data.items.map((item, index) => <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="font-medium">第{item.line_number}行 · {item.item_name} / {item.brand} / {item.model}</p><div className="mt-2 grid gap-3 sm:grid-cols-2">{(["quality", "description"] as const).map((field) => { const original = item[field] || ""; const target = field === "quality" ? "quality_en" : "description_en"; const suggestion = suggestCustomerEnglish(original); return <label key={field} className="block"><span className="text-slate-600">{field === "quality" ? "产品质量" : "产品描述"}：{original || "—"}</span><textarea rows={2} value={customerTextRows[index]?.[target] || ""} onChange={(event) => setCustomerTextRows((rows) => rows.map((row, position) => position === index ? { ...row, [target]: event.target.value } : row))} className="mt-1 w-full rounded-lg border border-slate-300 p-2" placeholder={containsChinese(original) ? "填写核对后的英文，必填" : "原文已是英文，可留空"} />{suggestion && !customerTextRows[index]?.[target] ? <button type="button" className="text-xs text-blue-700 underline" onClick={() => setCustomerTextRows((rows) => rows.map((row, position) => position === index ? { ...row, [target]: suggestion } : row))}>采用建议：{suggestion}</button> : null}</label>; })}</div></div>)}</div>
          <form onSubmit={(event) => { event.preventDefault(); void saveCustomerText(); }}><DialogActions busy={busy} onCancel={() => setCustomerTextOpen(false)} confirmLabel="保存核对英文" /></form>
        </AppDialog>
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
