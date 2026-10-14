"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileDown,
  LoaderCircle,
  PackageCheck,
  Save,
  Send,
} from "lucide-react";
import { STOCK_STATUS_LABELS, type StockOrderStatus } from "@/lib/types";
import { AppDateTimeField } from "@/components/ui/app-date-time-field";
import { CountryLabel } from "@/components/country-label";
import { localDateTimeInput } from "@/lib/date-time";
import { summarizeProductSpecificationsSnapshot } from "@/lib/product-specifications";
type Item = {
  id: string;
  line_number: number;
  product_type_snapshot: string | null;
  product_specifications_snapshot: Record<string, string> | null;
  product_color_snapshot: string | null;
  item_name: string;
  brand: string | null;
  model: string | null;
  quality: string | null;
  description: string | null;
  description_zh: string | null;
  procurement_cost: number;
  estimated_unit_cost_cny: number | null;
  procurement_cost_confirmed: boolean;
  quantity: number;
  received_quantity: number;
  warehouse_supplier_code: string | null;
  preparation_requirement: string | null;
  internal_note: string | null;
};
type Event = {
  id: string;
  from_status: string | null;
  to_status: StockOrderStatus;
  note: string | null;
  created_at: string;
  creator?: { name?: string | null; email?: string } | null;
};
type Payload = {
  order: {
    id: string;
    quote_id: string;
    sales_order_id: string;
    quote_number: string;
    order_number: string;
    warehouse_reference_number: string | null;
    stock_number: string;
    customer_short_name: string;
    destination_country: string | null;
    status: StockOrderStatus;
    stocking_requirements: string | null;
    status_note: string | null;
    expected_ready_at: string | null;
    created_at: string;
    updated_at: string;
    sales?: { name?: string | null; email?: string } | null;
  };
  items: Item[];
  events: Event[];
  expenses?: { packaging_cost_cny: number; procurement_expenses_cny: number; shipping_expenses_cny: number; updated_at: string } | null;
  can_prepare: boolean;
  can_view_pi: boolean;
  can_submit: boolean;
  can_update: boolean;
  can_edit_procurement: boolean;
  can_edit_receiving: boolean;
  allowed_statuses: StockOrderStatus[];
};
export function StockOrderDetailView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [procurementDraft, setProcurementDraft] = useState<Record<string, string>>({});
  const [receivingDraft, setReceivingDraft] = useState<Record<string, { received: string; supplierCode: string }>>({});
  const [receivingSearch, setReceivingSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StockOrderStatus>("PREPARING");
  const [note, setNote] = useState("");
  const [packagingExpense, setPackagingExpense] = useState("");
  const [procurementExpense, setProcurementExpense] = useState("");
  const [shippingExpense, setShippingExpense] = useState("");
  const [requirements, setRequirements] = useState("");
  const [expected, setExpected] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/stock-orders/${id}`, {
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(body.error || "备货详情加载失败");
      return;
    }
    setData(body);
    setItems(body.items || []);
    setProcurementDraft(Object.fromEntries((body.items || []).map((item: Item) => [item.id, item.procurement_cost_confirmed ? String(item.procurement_cost) : ""])));
    setReceivingDraft(Object.fromEntries((body.items || []).map((item: Item) => [item.id, { received: String(item.received_quantity ?? 0), supplierCode: item.warehouse_supplier_code || "" }])));
    setRequirements(body.order.stocking_requirements || "");
    setExpected(
      localDateTimeInput(body.order.expected_ready_at),
    );
    setStatus(body.allowed_statuses?.[0] || body.order.status);
    setNote("");
    setPackagingExpense(body.expenses ? String(body.expenses.packaging_cost_cny) : "");
    setProcurementExpense(body.expenses ? String(body.expenses.procurement_expenses_cny) : "");
    setShippingExpense(body.expenses ? String(body.expenses.shipping_expenses_cny) : "");
    setError("");
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const totalCost = useMemo(() => items.every((item) => item.procurement_cost_confirmed)
    ? items.reduce((sum, item) => sum + Number(item.procurement_cost) * Number(item.quantity), 0)
    : null, [items]);
  const visibleItems = items.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (pendingOnly && Number(receivingDraft[item.id]?.received ?? item.received_quantity) >= Number(item.quantity)) return false;
    const query = receivingSearch.trim().toLowerCase();
    return !query || [item.item_name, item.brand, item.model, receivingDraft[item.id]?.supplierCode].some((value) => String(value || "").toLowerCase().includes(query));
  });
  function updateItem(
    index: number,
    key: "description_zh" | "preparation_requirement",
    value: string,
  ) {
    setItems((current) =>
      current.map((item, row) =>
        row === index ? { ...item, [key]: value } : item,
      ),
    );
  }
  async function request(path: string, method: string, body?: object) {
    setBusy(true);
    setError("");
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(result.error || "操作失败");
      return false;
    }
    await load();
    return true;
  }
  async function saveDraft() {
    return request(`/api/stock-orders/${id}/draft`, "PATCH", {
      stocking_requirements: requirements,
      expected_ready_at: expected ? new Date(expected).toISOString() : null,
      items,
    });
  }
  async function saveProcurementCosts() {
    const costs = items.map((item) => {
      const raw = (procurementDraft[item.id] || "").trim();
      if (raw && !/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`第 ${item.line_number} 行采购价应为非负金额，最多两位小数`);
      return { line_number: item.line_number, procurement_cost: raw ? Number(raw) : null };
    });
    await request(`/api/stock-orders/${id}/procurement`, "PATCH", { items: costs });
  }
  async function saveReceivingDetails() {
    const details = items.map((item) => {
      const draft = receivingDraft[item.id];
      const received = draft?.received?.trim() ?? "0";
      if (!/^\d+$/.test(received) || !Number.isSafeInteger(Number(received)) || Number(received) > Number(item.quantity)) {
        throw new Error(`第 ${item.line_number} 行回货数量须为0至订购数量之间的整数`);
      }
      if ((draft?.supplierCode || "").trim().length > 100) throw new Error(`第 ${item.line_number} 行供应商编码不能超过100字`);
      return { line_number: item.line_number, received_quantity: Number(received), warehouse_supplier_code: draft?.supplierCode?.trim() || "" };
    });
    return request(`/api/stock-orders/${id}/receiving`, "PATCH", { items: details, expected_updated_at: data?.order.updated_at });
  }
  async function submit() {
    if (!requirements.trim()) {
      setError("请填写整单备货要求");
      return;
    }
    if (items.some((item) => !item.description_zh?.trim())) {
      setError("请填写每项产品的中文质量或描述");
      return;
    }
    const saved = await saveDraft();
    if (saved) await request(`/api/stock-orders/${id}/submit`, "POST");
  }
  async function updateStatus() {
    if (["SHORTAGE", "CANCELLED", "READY_TO_SHIP", "SHIPPED"].includes(status) && !note.trim()) {
      setError("请填写缺货/取消原因，或测试打包/物流交接说明");
      return;
    }
    if (status === "SHIPPED" && [packagingExpense, procurementExpense, shippingExpense]
      .some((value) => !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value.trim()))) {
      setError("确认已发货前，请填写三项整单费用；没有发生的费用请明确填0，最多两位小数");
      return;
    }
    const nextStatus = status;
    const nextNote = note;
    if (data?.can_edit_receiving) {
      const saved = await saveReceivingDetails();
      if (!saved) return;
    }
    await request(`/api/stock-orders/${id}/status`, "PATCH", {
      status: nextStatus, note: nextNote,
      ...(nextStatus === "SHIPPED" ? {
        packaging_cost_cny: packagingExpense.trim(),
        procurement_expenses_cny: procurementExpense.trim(),
        shipping_expenses_cny: shippingExpense.trim(),
      } : {}),
    });
  }
  if (loading && !data)
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <LoaderCircle className="animate-spin text-blue-600" />
      </main>
    );
  if (!data)
    return <main className="p-6 text-rose-600">{error || "备货单不存在"}</main>;
  const o = data.order;
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1660px]">
        <div className="mb-4 flex flex-wrap justify-between gap-3">
          <Link
            href="/stock-orders"
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm"
          >
            <ArrowLeft size={16} />
            返回备货列表
          </Link>
          <div className="flex gap-2">
            {data.can_view_pi ? <Link
              href={`/orders/${o.sales_order_id}`}
              className="inline-flex h-9 items-center rounded-lg border px-3 text-sm text-blue-700"
            >
              查看订单 {o.order_number}
            </Link> : null}
            {o.status !== "DRAFT" ? (
              <a
                href={`/api/stock-orders/${id}/export`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-emerald-700"
              >
                <FileDown size={16} />
                导出标准备货单
              </a>
            ) : null}
          </div>
        </div>
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
            <div>
              <h1 className="text-xl font-bold">备货单 {o.stock_number}</h1>
              <p className="mt-1 text-sm text-slate-500">
                PI编号：{o.order_number} · 订单编号：{o.warehouse_reference_number || "—"} ·
                销售员：{o.sales?.name || o.sales?.email || "-"}
              </p>
            </div>
            <span className="rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
              {STOCK_STATUS_LABELS[o.status]}
            </span>
          </header>
          {error ? (
            <div className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          <div className="grid gap-4 p-5 md:grid-cols-4">
            {[
              ["客户简称", o.customer_short_name],
              ["目的国家", o.destination_country || "-"],
              ["当前状态", STOCK_STATUS_LABELS[o.status]],
              ["状态备注", o.status_note || "-"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-4">
                <small className="text-slate-500">{label}</small>
                <p className="mt-2 whitespace-pre-wrap text-sm font-medium">
                  {label === "目的国家" ? <CountryLabel value={o.destination_country}/> : value}
                </p>
              </div>
            ))}
          </div>
          <div className="mx-5 mb-5 rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm">
            <b>整单理货要求</b>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{o.stocking_requirements || "常规理货"}</p>
          </div>
          <div className="p-5 pt-0">
            <h2 className="mb-1 font-semibold">仓库产品明细</h2>
            <p className="mb-3 text-xs text-slate-500">
              仅展示仓库所需规格、数量、理货要求及成本；销售价、客户付款价和利润率不会在备货单展示。预估成本由销售录入，采购人员另行确认实际采购单价。
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <input value={receivingSearch} onChange={(e) => setReceivingSearch(e.target.value)} placeholder="搜索产品、型号、供应商编码" className="h-9 min-w-64 rounded border px-3" />
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />仅看未回齐</label>
              <span className="text-slate-500">显示 {visibleItems.length}/{items.length} 项</span>
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    {[
                      "序号",
                      "产品类型",
                      "品牌",
                      "型号",
                      "客户质量/描述",
                      "中文质量/描述（仓库）",
                      "预估成本价（CNY）",
                      "实际采购单价（CNY）",
                      "数量",
                      "已回货数量",
                      "供应商编码",
                      "理货要求",
                      "仓库备注",
                    ].map((x) => (
                      <th key={x} className="px-3 py-3 font-medium">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map(({ item, index }) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-3">{item.line_number}</td>
                      <td className="px-3 py-3 font-medium">
                        {item.product_type_snapshot || "未维护类型"}
                        <small className="mt-1 block font-normal text-slate-500">{item.item_name}</small>
                      </td>
                      <td className="px-3 py-3">{item.brand || "-"}</td>
                      <td className="px-3 py-3">{item.model || "-"}</td>
                      <td className="px-3 py-3">
                        {[item.quality, item.description]
                          .filter(Boolean)
                          .join(" · ") || "-"}
                        {item.product_color_snapshot || item.product_specifications_snapshot ? <small className="mt-1 block text-slate-500">{[item.product_color_snapshot ? `颜色：${item.product_color_snapshot}` : "", summarizeProductSpecificationsSnapshot(item.product_specifications_snapshot)].filter(Boolean).join(" · ")}</small> : null}
                      </td>
                      <td className="px-3 py-2">
                        {data.can_prepare ? (
                          <input
                            value={item.description_zh || ""}
                            onChange={(e) =>
                              updateItem(
                                index,
                                "description_zh",
                                e.target.value,
                              )
                            }
                            placeholder="必填：采购备货中文质量/描述"
                            className="h-9 min-w-60 rounded border px-2"
                          />
                        ) : (
                          item.description_zh || "-"
                        )}
                      </td>
                      <td className="px-3 py-2">{item.estimated_unit_cost_cny === null ? "—" : Number(item.estimated_unit_cost_cny).toFixed(2)}</td>
                      <td className="px-3 py-2">
                        {data.can_edit_procurement ? (
                          <input
                            inputMode="decimal"
                            value={procurementDraft[item.id] ?? ""}
                            onChange={(e) => setProcurementDraft((current) => ({ ...current, [item.id]: e.target.value }))}
                            placeholder="待采购核价"
                            aria-label={`第 ${item.line_number} 行实际采购单价`}
                            className="h-9 w-28 rounded border px-2 text-right"
                          />
                        ) : (
                          item.procurement_cost_confirmed ? Number(item.procurement_cost).toFixed(2) : <span className="text-slate-500">待采购核价</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{item.quantity}</td>
                      <td className="px-3 py-2">
                        {data.can_edit_receiving ? <input inputMode="numeric" value={receivingDraft[item.id]?.received ?? "0"}
                          onChange={(e) => setReceivingDraft((current) => ({ ...current, [item.id]: { received: e.target.value, supplierCode: current[item.id]?.supplierCode || "" } }))}
                          aria-label={`第 ${item.line_number} 行已回货数量`} className="h-9 w-24 rounded border px-2 text-right" /> : item.received_quantity}
                      </td>
                      <td className="px-3 py-2">
                        {data.can_edit_receiving ? <input value={receivingDraft[item.id]?.supplierCode ?? ""}
                          onChange={(e) => setReceivingDraft((current) => ({ ...current, [item.id]: { received: current[item.id]?.received ?? "0", supplierCode: e.target.value } }))}
                          aria-label={`第 ${item.line_number} 行供应商编码`} maxLength={100} className="h-9 w-36 rounded border px-2" /> : item.warehouse_supplier_code || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {data.can_prepare ? (
                          <input
                            value={item.preparation_requirement || ""}
                            onChange={(e) =>
                              updateItem(
                                index,
                                "preparation_requirement",
                                e.target.value,
                              )
                            }
                            placeholder="该产品特殊理货要求"
                            className="h-9 min-w-56 rounded border px-2"
                          />
                        ) : (
                          item.preparation_requirement || "-"
                        )}
                      </td>
                      <td className="px-3 py-3">{item.internal_note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-amber-50">
                    <td
                      colSpan={7}
                      className="px-3 py-3 text-right font-medium"
                    >
                      已确认采购金额合计
                    </td>
                    <td className="px-3 py-3 font-bold text-amber-800">
                      {totalCost === null ? "待全部核价" : totalCost.toFixed(2)}
                    </td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {data.can_edit_procurement ? (
            <section className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <p className="text-sm text-amber-900">采购人员填写实际采购单价；留空表示尚未确认，0 仅用于已确认免费取得的商品。该价格不含包装费和其他费用。</p>
              <button disabled={busy} onClick={() => void saveProcurementCosts().catch((cause) => setError(cause instanceof Error ? cause.message : "采购价格式不正确"))} className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 text-sm text-amber-900"><Save size={16} />保存采购核价</button>
            </section>
          ) : null}
          {data.can_edit_receiving ? <section className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-sm text-blue-900">按产品填写累计已回货数量和供应商编码；部分回货可多次保存，不能超过订购数量。</p>
            <button disabled={busy} onClick={() => void saveReceivingDetails().catch((cause) => setError(cause instanceof Error ? cause.message : "回货数量格式不正确"))}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 text-sm text-blue-900"><Save size={16} />保存回货信息</button>
          </section> : null}
          {data.can_prepare ? (
            <section className="mx-5 mb-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <h2 className="font-semibold">完善并提交备货信息</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_260px]">
                <label className="text-sm">
                  <span className="mb-1 block text-slate-600">
                    整单备货要求（必填）
                  </span>
                  <textarea
                    rows={3}
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    placeholder="例如：按型号分袋、贴客户标签、易碎屏单独加固"
                    className="w-full rounded-lg border p-3"
                  />
                </label>
                <AppDateTimeField label="期望备齐时间" value={expected} onChange={setExpected} help="按您设备当地时间选择；如尚未确定可暂不安排。" />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  disabled={busy}
                  onClick={() => void saveDraft()}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"
                >
                  <Save size={16} />
                  保存待完善内容
                </button>
                {data.can_submit ? (
                  <button
                    disabled={busy}
                    onClick={() => void submit()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm text-white"
                  >
                    <Send size={16} />
                    提交采购备货
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          {data.can_update && data.allowed_statuses.length ? (
            <section className="mx-5 mb-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <h2 className="font-semibold">仓库更新备货状态</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto]">
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as StockOrderStatus)
                  }
                  className="h-10 rounded-lg border bg-white px-3 text-sm"
                >
                  {data.allowed_statuses.map((key) => (
                    <option key={key} value={key}>
                      {STOCK_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    status === "READY_TO_SHIP"
                      ? "必填：确认已完成测试、理货和打包"
                      : status === "SHIPPED"
                      ? "必填：承运商、运单号或物流交接说明"
                      : status === "SHORTAGE" || status === "CANCELLED"
                      ? "必须填写具体原因"
                      : "填写本次实际备货进度"
                  }
                  className="h-10 rounded-lg border px-3 text-sm"
                />
                <button
                  disabled={busy}
                  onClick={() => void updateStatus().catch((cause) => setError(cause instanceof Error ? cause.message : "回货数量格式不正确"))}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm text-white"
                >
                  <PackageCheck size={17} />
                  确认状态
                </button>
              </div>
              {status === "SHIPPED" ? (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {([
                    ["包装费用（人民币）", packagingExpense, setPackagingExpense],
                    ["采购发生费用（人民币）", procurementExpense, setProcurementExpense],
                    ["出货发生费用（人民币）", shippingExpense, setShippingExpense],
                  ] as const).map(([label, value, setValue]) => (
                    <label key={label} className="text-sm font-medium">{label} *
                      <input type="number" min="0" step="0.01" inputMode="decimal" required value={value}
                        onChange={(event) => setValue(event.target.value)} placeholder="无费用填 0"
                        className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm" />
                    </label>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          {data.expenses ? (
            <section className="mx-5 mb-5 rounded-xl border bg-slate-50 p-4 text-sm">
              <h2 className="font-semibold">已发货整单费用（内部）</h2>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
                <span>包装：¥{Number(data.expenses.packaging_cost_cny).toFixed(2)}</span>
                <span>采购发生：¥{Number(data.expenses.procurement_expenses_cny).toFixed(2)}</span>
                <span>出货发生：¥{Number(data.expenses.shipping_expenses_cny).toFixed(2)}</span>
              </div>
            </section>
          ) : null}
          <section className="border-t p-5">
            <h2 className="font-semibold">状态流转记录</h2>
            <div className="mt-3 space-y-2">
              {data.events.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm"
                >
                  <time className="text-slate-500">
                    {new Date(event.created_at).toLocaleString("zh-CN")}
                  </time>
                  <span>
                    {event.from_status
                      ? `${STOCK_STATUS_LABELS[event.from_status as StockOrderStatus]} → `
                      : ""}
                    <b>{STOCK_STATUS_LABELS[event.to_status]}</b>
                  </span>
                  <span className="text-slate-600">
                    {event.note || "无备注"}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {event.creator?.name || event.creator?.email || "系统"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
