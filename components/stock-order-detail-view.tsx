"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import { StockProgressCell } from "@/components/stock-progress-cell";
import { stockProgressLabel, summarizeStockProgress } from "@/lib/stock-progress";
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
  preparation_status: StockOrderStatus;
  warehouse_supplier_code: string | null;
  preparation_requirement: string | null;
  internal_note: string | null;
};
type Event = {
  id: string;
  from_status: string | null;
  to_status: StockOrderStatus;
  note: string | null;
  created_by: string;
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
  recalled_pi: boolean;
  can_view_pi: boolean;
  can_export: boolean;
  can_submit: boolean;
  can_update: boolean;
  can_edit_receiving: boolean;
  allowed_statuses: StockOrderStatus[];
};
const STOCK_PROGRESS_STAGES: StockOrderStatus[] = ["PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED"];
const ITEM_STAGES: StockOrderStatus[] = ["WAITING", ...STOCK_PROGRESS_STAGES];
const STAGE_COLORS: Record<string, string> = {
  WAITING: "bg-slate-100 text-slate-700", PREPARING: "bg-amber-100 text-amber-800",
  RECEIVED: "bg-cyan-100 text-cyan-800", SORTING: "bg-violet-100 text-violet-800",
  READY_TO_SHIP: "bg-blue-100 text-blue-800", SHIPPED: "bg-emerald-100 text-emerald-800",
};
export function StockOrderDetailView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [receivingDraft, setReceivingDraft] = useState<Record<string, { received: string; supplierCode: string }>>({});
  const [receivingSearch, setReceivingSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [withdrawnOrderNumber, setWithdrawnOrderNumber] = useState("");
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
      if (response.status === 410 && body.withdrawn) {
        setData(null);
        setWithdrawnOrderNumber(String(body.order_number || ""));
        setError(body.message || "此PI订单已撤回，原备货单不再是仓库待办。");
        return;
      }
      setError(body.error || "备货详情加载失败");
      return;
    }
    setWithdrawnOrderNumber("");
    setData(body);
    setItems(body.items || []);
    setSelectedItemIds([]);
    setReceivingDraft(Object.fromEntries((body.items || []).map((item: Item) => [item.id, { received: String(item.received_quantity ?? 0), supplierCode: item.warehouse_supplier_code || "" }])));
    setRequirements(body.order.stocking_requirements || "");
    setExpected(
      localDateTimeInput(body.order.expected_ready_at),
    );
    setStatus(body.allowed_statuses?.find((item: StockOrderStatus) => ["SHORTAGE", "CANCELLED"].includes(item)) || body.allowed_statuses?.[0] || body.order.status);
    setNote("");
    setPackagingExpense(body.expenses ? String(body.expenses.packaging_cost_cny) : "");
    setProcurementExpense(body.expenses ? String(body.expenses.procurement_expenses_cny) : "");
    setShippingExpense(body.expenses ? String(body.expenses.shipping_expenses_cny) : "");
    setError("");
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const visibleItems = items.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (pendingOnly && Number(receivingDraft[item.id]?.received ?? item.received_quantity) >= Number(item.quantity)) return false;
    const query = receivingSearch.trim().toLowerCase();
    return !query || [item.item_name, item.brand, item.model, receivingDraft[item.id]?.supplierCode].some((value) => String(value || "").toLowerCase().includes(query));
  });
  const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
  const selectedStage = selectedItems.length && selectedItems.every((item) => item.preparation_status === selectedItems[0].preparation_status)
    ? selectedItems[0].preparation_status : null;
  const nextSelectedStage = selectedStage ? ITEM_STAGES[ITEM_STAGES.indexOf(selectedStage) + 1] : null;
  const receivingDirty = items.some((item) => String(item.received_quantity ?? 0) !== String(receivingDraft[item.id]?.received ?? 0)
    || (item.warehouse_supplier_code || "") !== (receivingDraft[item.id]?.supplierCode || ""));
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
    if (!["SHORTAGE", "CANCELLED", "PREPARING"].includes(status)) { setError("常规备货状态请逐项更新产品"); return; }
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
  async function advanceItems(chosen: Item[]) {
    if (!data || !chosen.length || busy) return;
    const current = chosen[0].preparation_status;
    if (chosen.some((item) => item.preparation_status !== current)) { setError("批量更新请选择当前状态相同的产品"); return; }
    const next = ITEM_STAGES[ITEM_STAGES.indexOf(current) + 1];
    if (!next) return;
    if (receivingDirty) { setError("请先保存回货数量或供应商编码，再更新产品状态"); return; }
    if (["READY_TO_SHIP", "SHIPPED"].includes(next) && !note.trim()) { setError("进入待出货或已发货前请填写测试、打包或物流交接说明"); return; }
    if (ITEM_STAGES.indexOf(next) >= ITEM_STAGES.indexOf("RECEIVED") && chosen.some((item) => item.received_quantity !== item.quantity)) {
      setError("请先将选中产品的累计已回货数量保存至订购数量"); return;
    }
    const finalShipping = next === "SHIPPED" && items.every((item) => item.preparation_status === "SHIPPED" || chosen.some((row) => row.id === item.id));
    if (finalShipping && [packagingExpense, procurementExpense, shippingExpense]
      .some((value) => !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value.trim()))) {
      setError("全部产品发货前，请填写三项整单费用；无费用请填0"); return;
    }
    await request(`/api/stock-orders/${id}/item-status`, "PATCH", {
      changes: chosen.map((item) => ({ item_id: item.id, status: next })),
      expected_updated_at: data.order.updated_at, note: note.trim(),
      packaging_cost_cny: finalShipping ? packagingExpense : null,
      procurement_expenses_cny: finalShipping ? procurementExpense : null,
      shipping_expenses_cny: finalShipping ? shippingExpense : null,
    });
  }
  if (loading && !data)
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <LoaderCircle className="animate-spin text-blue-600" />
      </main>
    );
  if (!data)
    return <main className="p-4 lg:p-6"><div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-900">{withdrawnOrderNumber ? `订单 ${withdrawnOrderNumber} 已撤回` : "备货单不可查看"}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{error || "备货单不存在或您无权查看"}</p>
      <Link href="/stock-orders" className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">返回备货单列表</Link>
    </div></main>;
  const o = data.order;
  const stockProgress = summarizeStockProgress(o.status, items);
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
              查看PI订单 {o.warehouse_reference_number || o.order_number}
            </Link> : null}
            {o.status !== "CANCELLED" ? <Link href={`/stock-orders/${id}/preview`} className="inline-flex h-9 items-center rounded-lg border px-3 text-sm text-blue-700">预览{data.can_export ? " / 打印" : "草稿"}</Link> : null}
            {data.can_export ? (
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
                订单编号：{o.warehouse_reference_number || "—"} · 内部PI号：{o.order_number} ·
                销售员：{o.sales?.name || o.sales?.email || "-"}
              </p>
            </div>
            <span className="rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
              {data.recalled_pi ? "已撤回（历史）" : stockProgressLabel(stockProgress)}
            </span>
          </header>
          {data.recalled_pi ? <p className="border-b bg-amber-50 px-5 py-3 text-sm text-amber-800">这张备货单随 PI 撤回，当前不是仓库待办；原内容仅供追溯。请在 PI 草稿中修改并重新提交。</p> : null}
          {o.status !== "DRAFT" ? <div className="border-b px-5 py-4">
            <p className="mb-2 text-xs text-slate-500">仓库备货流程 · 按顺序流转</p>
            <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="仓库备货流程">
              {STOCK_PROGRESS_STAGES.map((stage, index) => {
                const currentIndex = STOCK_PROGRESS_STAGES.indexOf(o.status);
                return <li key={stage} className={`rounded-full border px-3 py-1.5 ${stage === o.status ? "border-blue-600 bg-blue-50 font-semibold text-blue-700" : currentIndex > index ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>
                  {index + 1}. {STOCK_STATUS_LABELS[stage]}
                </li>;
              })}
            </ol>
            {o.status === "WAITING" ? <p className="mt-2 text-xs text-slate-500">{stockProgress.percent > 0 ? "部分产品仍待备货；已处理产品的阶段和回货数量在下方逐项显示。" : "仓库待处理，下一步可将产品更新为“备货中”。"}</p> : null}
            {["SHORTAGE", "CANCELLED"].includes(o.status) ? <p className="mt-2 text-xs text-amber-700">当前为{STOCK_STATUS_LABELS[o.status]}，不属于常规五步进度。</p> : null}
            {!data.recalled_pi ? <div className="mt-3 max-w-sm"><StockProgressCell progress={stockProgress}/></div> : null}
          </div> : null}
          {error ? (
            <div className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          <div className="grid gap-4 p-5 md:grid-cols-4">
            {[
              ["客户名称", o.customer_short_name],
              ["目的国家", o.destination_country || "-"],
              ["当前状态", data.recalled_pi ? "已撤回（历史）" : stockProgressLabel(stockProgress)],
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
              仅展示仓库所需规格、数量、理货要求及 PI 预估成本；销售价、客户付款价和利润率不会在备货单展示。
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <input value={receivingSearch} onChange={(e) => setReceivingSearch(e.target.value)} placeholder="搜索产品、型号、供应商编码" className="h-9 min-w-64 rounded border px-3" />
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />仅看未回齐</label>
              <span className="text-slate-500">显示 {visibleItems.length}/{items.length} 项</span>
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    {[
                      "选择",
                      "序号",
                      "产品类型",
                      "品牌",
                      "型号",
                      "客户质量/描述",
                      "中文质量/描述（仓库）",
                      "预估成本价（CNY）",
                      "数量",
                      "已回货数量",
                      "供应商编码",
                      "本项备货状态",
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
                      <td className="px-3 py-3">{data.can_update && ITEM_STAGES.includes(item.preparation_status) && item.preparation_status !== "SHIPPED" ? <input type="checkbox" aria-label={`选择第 ${item.line_number} 项`} checked={selectedItemIds.includes(item.id)} onChange={(event) => setSelectedItemIds((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} /> : null}</td>
                      <td className="px-3 py-3">{item.line_number}</td>
                      <td className="px-3 py-3 font-medium">
                        {item.product_type_snapshot || item.item_name || "—"}
                        {item.product_type_snapshot && item.item_name !== item.product_type_snapshot ? <small className="mt-1 block font-normal text-slate-500">{item.item_name}</small> : null}
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
                      <td className="px-3 py-2"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${STAGE_COLORS[item.preparation_status] || STAGE_COLORS.WAITING}`}>{STOCK_STATUS_LABELS[item.preparation_status] || "待备货"}</span>{data.can_update && ITEM_STAGES.includes(item.preparation_status) && item.preparation_status !== "SHIPPED" ? <button disabled={busy} onClick={() => void advanceItems([item])} className="mt-1 block whitespace-nowrap text-xs font-medium text-blue-700 hover:underline disabled:opacity-40">推进至{STOCK_STATUS_LABELS[ITEM_STAGES[ITEM_STAGES.indexOf(item.preparation_status) + 1]]}</button> : null}</td>
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
              </table>
            </div>
          </div>
          {data.can_edit_receiving ? <section className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-sm text-blue-900">按产品填写累计已回货数量和供应商编码；部分回货可多次保存，不能超过订购数量。</p>
            <button disabled={busy} onClick={() => void saveReceivingDetails().catch((cause) => setError(cause instanceof Error ? cause.message : "回货数量格式不正确"))}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 text-sm text-blue-900"><Save size={16} />保存回货信息</button>
          </section> : null}
          {data.can_update && ITEM_STAGES.includes(o.status) && o.status !== "SHIPPED" ? <section className="mx-5 mb-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
            <h2 className="font-semibold">逐项更新备货进度</h2>
            <p className="mt-1 text-xs text-slate-600">每项只推进一个阶段；可勾选当前状态相同的产品批量推进。整单进度按各项数量加权计算，回货数量单独显示。</p>
            <div className="mt-3 flex flex-wrap items-center gap-3"><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="本次说明；待出货/已发货必填" className="h-10 min-w-64 flex-1 rounded-lg border bg-white px-3 text-sm"/><button disabled={busy || !nextSelectedStage} onClick={() => void advanceItems(selectedItems)} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-40">{nextSelectedStage ? `推进选中 ${selectedItems.length} 项至${STOCK_STATUS_LABELS[nextSelectedStage]}` : "选择相同状态的产品"}</button></div>
            {items.some((item) => item.preparation_status === "READY_TO_SHIP") ? <div className="mt-3 grid gap-3 md:grid-cols-3">{([
              ["包装费用（人民币）", packagingExpense, setPackagingExpense],
              ["采购发生费用（人民币）", procurementExpense, setProcurementExpense],
              ["出货发生费用（人民币）", shippingExpense, setShippingExpense],
            ] as const).map(([label, value, setValue]) => <label key={label} className="text-sm">{label}<input value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" placeholder="整单全部发货时填写；无费用填0" className="mt-1 h-10 w-full rounded-lg border bg-white px-3"/></label>)}</div> : null}
          </section> : null}
          {data.can_prepare ? (
            <section className="mx-5 mb-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <h2 className="font-semibold">仓库完善备货信息</h2>
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
                    确认备货草稿
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          {data.can_update && data.allowed_statuses.some((key) => ["SHORTAGE", "CANCELLED"].includes(key)) ? (
            <section className="mx-5 mb-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <h2 className="font-semibold">整单异常处理</h2>
              <p className="mt-1 text-xs text-slate-600">常规进度请在产品明细逐项更新；整单缺货或取消才使用此入口。</p>
              <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto]">
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as StockOrderStatus)
                  }
                  className="h-10 rounded-lg border bg-white px-3 text-sm"
                >
                  {data.allowed_statuses.filter((key) => ["SHORTAGE", "CANCELLED"].includes(key) || (o.status === "SHORTAGE" && key === "PREPARING")).map((key) => (
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
                    操作人：{event.creator?.name || event.creator?.email || `未知用户（${event.created_by.slice(0, 8)}）`}
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
