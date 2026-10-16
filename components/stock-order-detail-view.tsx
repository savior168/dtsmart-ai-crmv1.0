"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AppDialog, ConfirmDialog } from "@/components/ui/app-dialog";
import { AppPagination } from "@/components/ui/app-pagination";
import { STOCK_ITEM_PROGRESS, stockItemProgress, stockItemProgressKey, stockProgressLabel, summarizeStockProgress, type StockItemProgressKey } from "@/lib/stock-progress";
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
  prepared_quantity: number;
  shipped_quantity: number;
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
  created_by: string | null;
  created_at: string;
  creator?: { name?: string | null; email?: string } | null;
};
type CorrectionDraft = {
  itemId: string;
  received: string;
  prepared: string;
  supplierCode: string;
  reason: string;
  revertStart: boolean;
};
type ShipmentDraft = {
  itemIds: string[];
  note: string;
  packaging: string;
  procurement: string;
  shipping: string;
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
    delivery_recipient: string | null;
    delivery_address: string | null;
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
  event_count: number;
  expenses?: { packaging_cost_cny: number; procurement_expenses_cny: number; shipping_expenses_cny: number; updated_at: string } | null;
  shipments?: Array<{ id: string; item_ids: string[]; packaging_cost_cny: number; procurement_expenses_cny: number; shipping_expenses_cny: number; handoff_note: string; created_at: string }>;
  shipment_feature_ready?: boolean;
  can_prepare: boolean;
  recalled_pi: boolean;
  can_view_pi: boolean;
  can_export: boolean;
  can_submit: boolean;
  can_update: boolean;
  can_edit_receiving: boolean;
  allowed_statuses: StockOrderStatus[];
};
const ITEM_STAGES: StockOrderStatus[] = ["WAITING", "PREPARING", "RECEIVED", "SORTING", "READY_TO_SHIP", "SHIPPED"];
const eventStageLabels: Record<string, string> = {
  DRAFT: "待完善备货信息", WAITING: "待仓库接单", PREPARING: "采购中", RECEIVED: "已回齐待理货",
  SORTING: "理货中", READY_TO_SHIP: "已理货待交货代", SHIPPED: "已交货代",
  SHORTAGE: "缺货异常", CANCELLED: "已取消", READY: "待仓库接单",
};
function readableEventNote(value: string | null) {
  if (!value) return "历史记录未填写说明";
  return value.replace(/\b(DRAFT|WAITING|PREPARING|RECEIVED|SORTING|READY_TO_SHIP|SHIPPED|SHORTAGE|CANCELLED|READY)\b/g,
    (status) => eventStageLabels[status] || status);
}
export function StockOrderDetailView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [receivingDraft, setReceivingDraft] = useState<Record<string, { received: string; prepared: string; supplierCode: string }>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const orderVersion = useRef("");
  const [receivingSearch, setReceivingSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [stageFilter, setStageFilter] = useState<"ALL" | StockItemProgressKey>("ALL");
  const [itemPage, setItemPage] = useState(1);
  const [itemPageSize, setItemPageSize] = useState(20);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [eventPage, setEventPage] = useState(1);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [batchStage, setBatchStage] = useState<"RECEIVED" | "READY_TO_SHIP" | null>(null);
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const [shipmentDraft, setShipmentDraft] = useState<ShipmentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [withdrawnOrderNumber, setWithdrawnOrderNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StockOrderStatus>("PREPARING");
  const [progressNote, setProgressNote] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");
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
    setEventPage(1);
    setItems(body.items || []);
    setSelectedItemIds([]);
    orderVersion.current = body.order.updated_at;
    setReceivingDraft(Object.fromEntries((body.items || []).map((item: Item) => [item.id, { received: String(item.received_quantity ?? 0), prepared: String(item.prepared_quantity ?? 0), supplierCode: item.warehouse_supplier_code || "" }])));
    setRequirements(body.order.stocking_requirements || "");
    setExpected(
      localDateTimeInput(body.order.expected_ready_at),
    );
    setStatus(body.allowed_statuses?.find((item: StockOrderStatus) => ["SHORTAGE", "CANCELLED"].includes(item)) || body.allowed_statuses?.[0] || body.order.status);
    setProgressNote("");
    setExceptionNote("");
    setError("");
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function loadEvents(page: number) {
    setEventsLoading(true);
    const response = await fetch(`/api/stock-orders/${id}/events?page=${page}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setEventsLoading(false);
    if (!response?.ok) { setError(body.error || "状态流转记录加载失败"); return; }
    setData((current) => current ? { ...current, events: body.data || [], event_count: body.count || 0 } : current);
    setEventPage(page);
    setError("");
  }
  const visibleItems = items.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (stageFilter !== "ALL" && stockItemProgressKey(item) !== stageFilter) return false;
    if (pendingOnly && Number(receivingDraft[item.id]?.received ?? item.received_quantity) >= Number(item.quantity)) return false;
    const query = receivingSearch.trim().toLowerCase();
    return !query || [item.item_name, item.brand, item.model, receivingDraft[item.id]?.supplierCode].some((value) => String(value || "").toLowerCase().includes(query));
  });
  const totalItemPages = Math.max(1, Math.ceil(visibleItems.length / itemPageSize));
  const safeItemPage = Math.min(itemPage, totalItemPages);
  const paginatedItems = visibleItems.slice((safeItemPage - 1) * itemPageSize, safeItemPage * itemPageSize);
  const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
  const startableItems = selectedItems.filter((item) => item.preparation_status === "WAITING");
  const visibleIds = visibleItems.map(({ item }) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((itemId) => selectedItemIds.includes(itemId));
  useEffect(() => {
    setItemPage(1);
    setSelectedItemIds([]);
  }, [receivingSearch, pendingOnly, stageFilter]);
  useEffect(() => {
    if (itemPage > totalItemPages) setItemPage(totalItemPages);
  }, [itemPage, totalItemPages]);
  const hasUnsavedQuantity = items.some((item) => {
    const draft = receivingDraft[item.id];
    return draft && (draft.received !== String(item.received_quantity)
      || draft.prepared !== String(item.prepared_quantity)
      || draft.supplierCode.trim() !== (item.warehouse_supplier_code || ""));
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
  function saveLineOnBlur(item: Item, action: "RECEIVE" | "PREPARE") {
    const draft = receivingDraft[item.id];
    if (!draft) return;
    const raw = action === "RECEIVE" ? draft.received : draft.prepared;
    const supplierCode = draft.supplierCode.trim();
    if (action === "RECEIVE" && String(item.received_quantity) === raw
      && (item.warehouse_supplier_code || "") === supplierCode) return;
    if (action === "PREPARE" && String(item.prepared_quantity) === raw) return;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > item.quantity
      || supplierCode.length > 100
      || (action === "RECEIVE" && Number(raw) < item.prepared_quantity)
      || (action === "PREPARE" && Number(raw) > Number(draft.received))) {
      setError(`第 ${item.line_number} 项未保存：数量须为0至订购数之间的整数，且已理货数≤已回货数；供应商编码最多100字`);
      return;
    }
    const submitted = { ...draft };
    const amount = Number(raw);
    const submittedNote = progressNote.trim();
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      setSavingItemId(item.id);
      setError("");
      try {
        const response = await fetch(`/api/stock-orders/${id}/progress`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, changes: [{ item_id: item.id, quantity: amount,
            supplier_code: supplierCode }], expected_updated_at: orderVersion.current, note: submittedNote }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "自动保存失败");
        orderVersion.current = body.data.updated_at;
        const saved = body.items?.[0] as Partial<Item> | undefined;
        setData((current) => current ? { ...current, order: { ...current.order, ...body.data } } : current);
        if (saved) setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...saved } : row));
        setReceivingDraft((current) => {
          const latest = current[item.id];
          if (!latest || (action === "RECEIVE" && (latest.received !== submitted.received || latest.supplierCode !== submitted.supplierCode))
            || (action === "PREPARE" && latest.prepared !== submitted.prepared)) return current;
          return { ...current, [item.id]: { ...latest,
            received: String(saved?.received_quantity ?? latest.received),
            prepared: String(saved?.prepared_quantity ?? latest.prepared),
            supplierCode: saved?.warehouse_supplier_code ?? latest.supplierCode } };
        });
        const historyResponse = await fetch(`/api/stock-orders/${id}`, { cache: "no-store" }).catch(() => null);
        const latest = historyResponse?.ok ? await historyResponse.json().catch(() => null) as Payload | null : null;
        if (latest?.events) setData((current) => current ? {
          ...current,
          events: eventPage === 1 ? latest.events : current.events,
          event_count: latest.event_count,
        } : current);
      } catch (cause) {
        setError(`第 ${item.line_number} 项未保存：${cause instanceof Error ? cause.message : "请重试"}`);
      } finally {
        setSavingItemId(null);
      }
    });
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
    if (["SHORTAGE", "CANCELLED"].includes(status) && !exceptionNote.trim()) {
      setError("请填写缺货或取消原因");
      return;
    }
    await saveQueue.current;
    await request(`/api/stock-orders/${id}/status`, "PATCH", {
      status, note: exceptionNote.trim(),
    });
  }
  async function runProgress(action: "START", chosen: Item[]) {
    if (!data || busy) return;
    await saveQueue.current;
    if (hasUnsavedQuantity) { setError("还有未保存的数量或供应商编码，请确认自动保存完成后重试"); return; }
    await request(`/api/stock-orders/${id}/progress`, "PATCH", {
      action, changes: chosen.map((item) => ({ item_id: item.id })),
      expected_updated_at: orderVersion.current, note: progressNote.trim(),
    });
  }
  function openShipment(chosen: Item[]) {
    if (hasUnsavedQuantity) { setError("还有未保存的数量或供应商编码，请等待自动保存后重试"); return; }
    if (!chosen.length || chosen.some((item) => item.received_quantity !== item.quantity
      || item.prepared_quantity !== item.quantity || item.shipped_quantity !== 0)) {
      setError("只能选择已整行回齐、完成理货且尚未交货代的产品");
      return;
    }
    setError("");
    setShipmentDraft({ itemIds: chosen.map((item) => item.id), note: "", packaging: "", procurement: "", shipping: "" });
  }
  async function confirmShipment() {
    if (!shipmentDraft || busy) return;
    await saveQueue.current;
    if (hasUnsavedQuantity) { setError("还有未保存的数量或供应商编码，请等待自动保存后重试"); return; }
    const costs = [shipmentDraft.packaging, shipmentDraft.procurement, shipmentDraft.shipping];
    if (!shipmentDraft.note.trim() || shipmentDraft.note.length > 1000
      || costs.some((value) => !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(value))) {
      setError("请填写交接信息和三项人民币费用；无费用填0，金额最多两位小数");
      return;
    }
    const success = await request(`/api/stock-orders/${id}/ship`, "PATCH", {
      item_ids: shipmentDraft.itemIds, expected_updated_at: orderVersion.current,
      note: shipmentDraft.note.trim(), packaging_cost_cny: shipmentDraft.packaging,
      procurement_expenses_cny: shipmentDraft.procurement,
      shipping_expenses_cny: shipmentDraft.shipping,
    });
    if (success) setShipmentDraft(null);
  }
  async function runBatchProgress(stage: "RECEIVED" | "READY_TO_SHIP") {
    await saveQueue.current;
    if (hasUnsavedQuantity) { setError("还有未保存的数量或供应商编码，请确认自动保存完成后重试"); setBatchStage(null); return; }
    const success = await request(`/api/stock-orders/${id}/batch-progress`, "PATCH", {
      stage, item_ids: selectedItemIds, expected_updated_at: orderVersion.current,
    });
    if (success) setBatchStage(null);
  }
  async function saveCorrection() {
    if (!correction || !data || busy) return;
    await saveQueue.current;
    if (hasUnsavedQuantity) { setError("还有未保存的数量或供应商编码，请等待自动保存完成后再更正"); return; }
    const item = items.find((row) => row.id === correction.itemId);
    const received = Number(correction.received);
    const prepared = Number(correction.prepared);
    if (!item || !/^\d+$/.test(correction.received) || !/^\d+$/.test(correction.prepared)
      || !Number.isSafeInteger(received) || !Number.isSafeInteger(prepared)
      || received > item.quantity || prepared > received || prepared < item.shipped_quantity
      || received < item.shipped_quantity || correction.supplierCode.trim().length > 100) {
      setError("更正数量须满足已发货数 ≤ 理货数 ≤ 回货数 ≤ 订购数；供应商编码最多100字");
      return;
    }
    if (!correction.reason.trim()) { setError("请填写本次更正原因"); return; }
    if (correction.revertStart && (item.preparation_status !== "PREPARING"
      || item.received_quantity !== 0 || item.prepared_quantity !== 0 || item.shipped_quantity !== 0)) {
      setError("仅可撤回尚无实物进度的误点采购操作");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/stock-orders/${id}/corrections`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_updated_at: orderVersion.current, reason: correction.reason.trim(),
        changes: [{ item_id: item.id, received_quantity: received, prepared_quantity: prepared,
          supplier_code: correction.supplierCode, revert_start: correction.revertStart }] }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(body.error || "进度更正失败，请刷新后重试"); return; }
    setCorrection(null);
    await load();
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
  const showStockProgress = o.status !== "DRAFT" && !data.recalled_pi;
  const canExecute = data.can_update && ITEM_STAGES.includes(o.status) && o.status !== "SHIPPED" && !data.recalled_pi;
  const unshippedItems = items.filter((item) => item.shipped_quantity === 0);
  const canShip = canExecute && data.shipment_feature_ready !== false && unshippedItems.length > 0 && unshippedItems.every((item) =>
    item.received_quantity === item.quantity && item.prepared_quantity === item.quantity);
  const selectedShippable = selectedItems.length > 0 && selectedItems.every((item) =>
    item.received_quantity === item.quantity && item.prepared_quantity === item.quantity && item.shipped_quantity === 0);
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
          <div className="flex min-w-0 flex-wrap gap-2">
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
                导出备货单 Excel
              </a>
            ) : null}
            {data.can_export ? <Link href={`/stock-orders/${id}/preview?export=pdf`} target="_blank" rel="noopener noreferrer" title="打开打印窗口并选择另存为 PDF" className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-violet-700"><FileDown size={16}/>导出备货单 PDF</Link> : null}
          </div>
        </div>
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
            <div>
              <h1 className="text-xl font-bold">订单 {o.warehouse_reference_number || o.order_number}</h1>
              <p className="mt-1 text-sm text-slate-500">
                备货单号：{o.stock_number} · 销售员：{o.sales?.name || o.sales?.email || "—"}
              </p>
            </div>
            {<span className={`rounded px-3 py-1.5 text-sm ${data.recalled_pi || ["SHORTAGE", "CANCELLED"].includes(o.status) ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}>
              {data.recalled_pi ? "已撤回（历史）" : stockProgressLabel(stockProgress)}
            </span>}
          </header>
          {data.recalled_pi ? <p className="border-b bg-amber-50 px-5 py-3 text-sm text-amber-800">这张备货单随 PI 撤回，当前不是仓库待办；原内容仅供追溯。请在 PI 草稿中修改并重新提交。</p> : null}
          {error ? (
            <div className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          {o.status_note?.trim() ? <p className="border-b bg-amber-50 px-5 py-2 text-sm text-amber-900"><b>状态备注：</b>{o.status_note}</p> : null}
          <div className={`grid gap-3 border-b p-5 lg:grid-cols-2 ${showStockProgress ? "xl:grid-cols-12" : "xl:grid-cols-2"}`}>
            {showStockProgress ? <section className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4 xl:col-span-5" aria-labelledby="stock-progress-heading">
              <h2 id="stock-progress-heading" className="mb-3 text-sm font-semibold text-slate-900">整单实物进度 · {stockProgress.ordered_units} 件</h2>
              <StockProgressCell progress={stockProgress} wide/>
              <p className="mt-3 text-xs leading-5 text-slate-500">按件数统计，合计 100%。部分回货会同时显示未回货和已回货数量；“理货中”表示回齐后尚未全部理完；“已交货代”仅表示仓库完成交接，不代表客户签收。</p>
            </section> : null}
            <section className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 ${showStockProgress ? "xl:col-span-3" : ""}`} aria-labelledby="stock-recipient-heading">
              <h2 id="stock-recipient-heading" className="mb-3 text-sm font-semibold text-slate-900">客户与收货信息</h2>
              <dl className="space-y-2.5 text-sm leading-5">
                <div><dt className="text-xs text-slate-500">客户</dt><dd className="font-medium text-slate-900">{o.customer_short_name || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">目的国家</dt><dd><CountryLabel value={o.destination_country}/></dd></div>
                <div><dt className="text-xs text-slate-500">收件人</dt><dd className="font-medium text-slate-900">{o.delivery_recipient || "—"}</dd></div>
                <div className="min-w-0"><dt className="text-xs text-slate-500">收货地址</dt><dd className="break-words text-slate-800">{o.delivery_address || "—"}</dd></div>
              </dl>
            </section>
            <section className={`min-w-0 rounded-xl border p-4 ${o.stocking_requirements?.trim() ? "border-amber-200 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-600"} ${showStockProgress ? "lg:col-span-2 xl:col-span-4" : ""}`} aria-labelledby="stock-requirements-heading">
              <h2 id="stock-requirements-heading" className="mb-2 text-sm font-semibold">整单理货要求</h2>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words pr-2 text-sm leading-6" tabIndex={0}>{o.stocking_requirements || "常规理货"}</p>
            </section>
          </div>
          <div className="p-5 pt-0">
            <h2 className="mb-1 font-semibold">仓库产品明细</h2>
            <p className="mb-3 text-xs text-slate-500">
              仅展示仓库所需规格、数量、理货要求及 PI 预估成本；销售价、客户付款价和利润率不会在备货单展示。
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <input value={receivingSearch} onChange={(e) => setReceivingSearch(e.target.value)} placeholder="搜索产品、型号、供应商编码" className="h-9 min-w-64 rounded border px-3" />
              <label className="inline-flex items-center gap-2"><span className="text-slate-500">单项进度</span><select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as "ALL" | StockItemProgressKey)} className="h-9 rounded border bg-white px-2"><option value="ALL">全部进度</option>{STOCK_ITEM_PROGRESS.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />仅看未回齐</label>
              {canExecute ? <label className="inline-flex items-center gap-2"><input type="checkbox" checked={allVisibleSelected} disabled={visibleIds.length === 0} onChange={(e) => setSelectedItemIds((current) => e.target.checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((itemId) => !visibleIds.includes(itemId)))} />选择当前筛选的 {visibleIds.length} 项（跨页）</label> : null}
              <span className="text-slate-500">筛选后 {visibleItems.length}/{items.length} 项{canExecute ? " · 已选 " + selectedItems.length + " 项" : ""}</span>
            </div>
            {canExecute ? <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              累计回货数、已完成理货数和供应商编码离开输入框后自动保存；理货数不能超过已回货数。减少已保存的数量时，先填写下方更正原因。
            </div> : null}
            {error ? <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[1740px] table-fixed text-left text-sm">
                <colgroup>
                  {[42, 48, 74, 74, 104, 112, 110, 170, 115, 58, 125, 105, 105, 158, 190, 150, ...(canExecute ? [112] : [])].map((width, index) => <col key={index} style={{ width }} />)}
                </colgroup>
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    {[
                      "选择",
                      "序号",
                      "产品类型",
                      "产品品牌",
                      "产品型号",
                      "产品质量",
                      "产品描述",
                      "中文质量/描述（仓库）",
                      "成本单价（人民币）",
                      "数量",
                      "供应商编码",
                      "累计已回货",
                      "已完成理货",
                      "单项进度",
                      "理货要求",
                      "仓库备注",
                      ...(canExecute ? ["操作"] : []),
                    ].map((x) => (
                      <th key={x} className="break-words px-2 py-3 font-medium leading-4">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map(({ item, index }) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-3">{canExecute ? <input type="checkbox" aria-label={`选择第 ${item.line_number} 项进行批量备货操作`} checked={selectedItemIds.includes(item.id)} onChange={(event) => setSelectedItemIds((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} /> : null}</td>
                      <td className="px-3 py-3">{item.line_number}</td>
                      <td className="px-2 py-2 font-medium">
                        <div className="line-clamp-2 break-words leading-5" title={[item.product_type_snapshot || item.item_name || "—", item.product_type_snapshot && item.item_name !== item.product_type_snapshot ? item.item_name : ""].filter(Boolean).join(" · ")}>
                          {item.product_type_snapshot || item.item_name || "—"}{item.product_type_snapshot && item.item_name !== item.product_type_snapshot ? <small className="font-normal text-slate-500"> · {item.item_name}</small> : null}
                        </div>
                      </td>
                      <td className="px-2 py-2"><div className="line-clamp-2 break-words leading-5" title={item.brand || "-"}>{item.brand || "-"}</div></td>
                      <td className="px-2 py-2"><div className="line-clamp-2 break-words leading-5" title={item.model || "-"}>{item.model || "-"}</div></td>
                      <td className="px-2 py-2">
                        <div className="line-clamp-2 break-words leading-5" title={[item.quality || "-", item.product_color_snapshot ? `颜色：${item.product_color_snapshot}` : "", summarizeProductSpecificationsSnapshot(item.product_specifications_snapshot)].filter(Boolean).join(" · ")}>
                          {item.quality || "-"}{item.product_color_snapshot || item.product_specifications_snapshot ? <small className="text-slate-500"> · {[item.product_color_snapshot ? `颜色：${item.product_color_snapshot}` : "", summarizeProductSpecificationsSnapshot(item.product_specifications_snapshot)].filter(Boolean).join(" · ")}</small> : null}
                        </div>
                      </td>
                      <td className="px-2 py-2"><div className="line-clamp-2 break-words leading-5" title={item.description || "-"}>{item.description || "-"}</div></td>
                      <td className="px-2 py-2">
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
                            className="h-9 w-full min-w-0 rounded border px-2"
                          />
                        ) : (
                          <div className="line-clamp-2 break-words leading-5" title={item.description_zh || "-"}>{item.description_zh || "-"}</div>
                        )}
                      </td>
                      <td className="px-2 py-2">{item.estimated_unit_cost_cny === null ? "—" : Number(item.estimated_unit_cost_cny).toFixed(2)}</td>
                      <td className="px-2 py-2">{item.quantity}</td>
                      <td className="px-2 py-2">
                        {canExecute ? <input value={receivingDraft[item.id]?.supplierCode ?? ""}
                          onChange={(e) => setReceivingDraft((current) => ({ ...current, [item.id]: { ...current[item.id], supplierCode: e.target.value } }))}
                          onBlur={() => saveLineOnBlur(item, "RECEIVE")}
                          aria-label={`第 ${item.line_number} 行供应商编码`} maxLength={100} className="h-9 w-full min-w-0 rounded border px-2" /> : <div className="line-clamp-2 break-words leading-5" title={item.warehouse_supplier_code || "—"}>{item.warehouse_supplier_code || "—"}</div>}
                      </td>
                      <td className="px-2 py-2">
                        {canExecute ? <input inputMode="numeric" pattern="[0-9]*" maxLength={10} value={receivingDraft[item.id]?.received ?? "0"}
                          onChange={(e) => { if (/^\d{0,10}$/.test(e.target.value)) setReceivingDraft((current) => ({ ...current, [item.id]: { ...current[item.id], received: e.target.value } })); }}
                          onBlur={() => saveLineOnBlur(item, "RECEIVE")}
                          aria-label={`第 ${item.line_number} 行累计已回货数量`} className="h-9 w-full min-w-0 rounded border px-2 text-right" /> : item.received_quantity}
                      </td>
                      <td className="px-2 py-2">
                        {canExecute ? <input inputMode="numeric" pattern="[0-9]*" maxLength={10} value={receivingDraft[item.id]?.prepared ?? "0"}
                          onChange={(e) => { if (/^\d{0,10}$/.test(e.target.value)) setReceivingDraft((current) => ({ ...current, [item.id]: { ...current[item.id], prepared: e.target.value } })); }}
                          onBlur={() => saveLineOnBlur(item, "PREPARE")}
                          aria-label={`第 ${item.line_number} 行累计已完成理货数量`} className="h-9 w-full min-w-0 rounded border px-2 text-right" /> : item.prepared_quantity}
                      </td>
                      <td className="px-2 py-2"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${stockItemProgress(item).tone}`}>{stockItemProgress(item).label}</span><small className="mt-1 block whitespace-nowrap text-xs leading-4 text-slate-500">回货 {item.received_quantity}/{item.quantity} · 理货 {item.prepared_quantity}/{item.quantity} · 交货代 {item.shipped_quantity}/{item.quantity}</small>{savingItemId === item.id ? <small className="mt-1 block text-blue-700">正在自动保存…</small> : null}</td>
                      <td className="px-2 py-2">
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
                            className="h-9 w-full min-w-0 rounded border px-2"
                          />
                        ) : (
                          <div className="line-clamp-2 break-words text-[13px] leading-5 text-slate-600" title={item.preparation_requirement || "-"}>{item.preparation_requirement || "-"}</div>
                        )}
                      </td>
                      <td className="px-2 py-2"><div className="line-clamp-2 break-words text-[13px] leading-5 text-slate-600" title={item.internal_note || "-"}>{item.internal_note || "-"}</div></td>
                      {canExecute ? <td className="px-2 py-2"><button type="button" disabled={busy || savingItemId !== null || hasUnsavedQuantity} onClick={() => setCorrection({
                        itemId: item.id, received: String(item.received_quantity), prepared: String(item.prepared_quantity),
                        supplierCode: item.warehouse_supplier_code || "", reason: "", revertStart: false,
                      })} className="whitespace-nowrap rounded border border-amber-300 px-3 py-1.5 text-amber-800 disabled:opacity-40">更正进度</button></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {correction ? (() => {
              const item = items.find((row) => row.id === correction.itemId);
              if (!item) return null;
              const canRevertStart = item.preparation_status === "PREPARING" && item.received_quantity === 0
                && item.prepared_quantity === 0 && item.shipped_quantity === 0;
              return <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-label="更正单项实物进度">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h3 className="font-semibold text-amber-950">更正第 {item.line_number} 项 · {item.model || item.item_name}</h3>
                    <p className="mt-1 text-xs text-slate-600">更正会追加到状态流转记录，不会删除原操作。请以实物核对结果填写。</p></div>
                  <button type="button" onClick={() => setCorrection(null)} disabled={busy} className="rounded border bg-white px-3 py-1.5 text-sm">取消</button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">累计已回货<input type="number" min={item.shipped_quantity} max={item.quantity} step={1} value={correction.received} onChange={(event) => setCorrection((current) => current ? { ...current, received: event.target.value } : current)} className="mt-1 h-10 w-full rounded border bg-white px-3"/></label>
                  <label className="text-sm">累计已完成理货<input type="number" min={item.shipped_quantity} max={item.quantity} step={1} value={correction.prepared} onChange={(event) => setCorrection((current) => current ? { ...current, prepared: event.target.value } : current)} className="mt-1 h-10 w-full rounded border bg-white px-3"/></label>
                  <label className="text-sm">供应商编码<input maxLength={100} value={correction.supplierCode} onChange={(event) => setCorrection((current) => current ? { ...current, supplierCode: event.target.value } : current)} className="mt-1 h-10 w-full rounded border bg-white px-3"/></label>
                </div>
                {canRevertStart ? <label className="mt-3 flex items-center gap-2 text-sm text-amber-950"><input type="checkbox" checked={correction.revertStart} onChange={(event) => setCorrection((current) => current ? { ...current, revertStart: event.target.checked } : current)}/>撤回误点的“开始采购”，恢复为“待采购”（仅限尚无实物进度）</label> : null}
                <label className="mt-3 block text-sm">更正原因（必填）<textarea maxLength={1000} value={correction.reason} onChange={(event) => setCorrection((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="例如：录入错误，实收应为12件，已核对实物" className="mt-1 min-h-20 w-full rounded border bg-white px-3 py-2"/></label>
                <div className="mt-3 flex justify-end"><button type="button" disabled={busy || savingItemId !== null || hasUnsavedQuantity} onClick={() => void saveCorrection()} className="rounded-lg bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-40">{busy ? "正在保存…" : "确认更正并记入流水"}</button></div>
              </section>;
            })() : null}
            {visibleItems.length > 20 ? <AppPagination page={safeItemPage} pageSize={itemPageSize} total={visibleItems.length} itemLabel="项产品" onPage={setItemPage} onPageSize={(size) => { setItemPageSize(size); setItemPage(1); }} pageSizes={[20, 50, 100]} /> : null}
          </div>
          {canExecute ? <section className="mx-5 mb-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
            <h2 className="font-semibold">仓库快捷操作</h2>
            <p className="mt-1 text-slate-600">单项可直接填写实际累计数量，无需逐级点状态；批量快捷操作仅在实物确已达到所选阶段时使用，系统自动计算整单进度并记录操作。减少已保存数量时请先在说明栏填写更正原因。</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input value={progressNote} onChange={(event) => setProgressNote(event.target.value)} maxLength={1000} aria-label="本次仓库进度操作说明" placeholder="本次操作说明：数量更正原因或货代交接信息" className="h-10 min-w-64 flex-1 rounded-lg border bg-white px-3"/>
              <button disabled={busy || hasUnsavedQuantity || startableItems.length === 0} onClick={() => void runProgress("START", startableItems)} className="h-10 rounded-lg border border-blue-300 bg-white px-4 text-blue-800 disabled:opacity-40">选中 {startableItems.length} 项开始采购</button>
              <button disabled={busy || hasUnsavedQuantity || selectedItems.length === 0} onClick={() => setBatchStage("RECEIVED")} className="h-10 rounded-lg border border-cyan-300 bg-white px-4 text-cyan-800 disabled:opacity-40">选中 {selectedItems.length} 项标记已回齐</button>
              <button disabled={busy || hasUnsavedQuantity || selectedItems.length === 0} onClick={() => setBatchStage("READY_TO_SHIP")} className="h-10 rounded-lg border border-violet-300 bg-white px-4 text-violet-800 disabled:opacity-40">选中 {selectedItems.length} 项标记理货完成</button>
              <button disabled={busy || hasUnsavedQuantity || data.shipment_feature_ready === false || !selectedShippable} onClick={() => openShipment(selectedItems)} className="h-10 rounded-lg border border-emerald-300 bg-white px-4 font-medium text-emerald-800 disabled:opacity-40">选中 {selectedItems.length} 项交货代</button>
              <button disabled={busy || hasUnsavedQuantity || !canShip} onClick={() => openShipment(unshippedItems)} className="h-10 rounded-lg bg-emerald-600 px-4 font-medium text-white disabled:opacity-40">{stockProgress.shipped_units ? "剩余产品交货代" : "整单交货代"}</button>
            </div>
            {selectedItems.length ? <p className="mt-2 text-xs text-blue-800">已选择 {selectedItems.length} 项；交货代仅处理所选完整产品行。批量标记理货完成不会自动发货。</p> : null}
            {data.shipment_feature_ready === false ? <p role="status" className="mt-2 text-xs text-amber-800">交货代费用记录尚未就绪，暂不可发货；采购、回货和理货操作不受影响。</p> : null}
            {!canShip ? <p className="mt-2 text-xs text-slate-500">整单交货代需要所有未发货产品完成理货；如只交接部分，请选择已理货的完整产品行。</p> : null}
          </section> : null}
          <AppDialog open={shipmentDraft !== null} title="确认交货代并记录本次费用" description="仅所选完整产品行会标记已交货代；三项费用为本次交接发生额，统一人民币，未发生请填0。" onClose={() => { if (!busy) { setShipmentDraft(null); setError(""); } }}>
            {shipmentDraft ? <form onSubmit={(event) => { event.preventDefault(); void confirmShipment(); }} className="space-y-4 text-sm">
              <p className="rounded-lg bg-blue-50 p-3 text-blue-900">本次交接 {shipmentDraft.itemIds.length} 项、{items.filter((item) => shipmentDraft.itemIds.includes(item.id)).reduce((sum, item) => sum + Number(item.quantity), 0)} 件。请先核对实物和交接凭证。</p>
              <label className="block">货代交接信息（必填）<textarea required maxLength={1000} value={shipmentDraft.note} onChange={(event) => setShipmentDraft((current) => current && { ...current, note: event.target.value })} placeholder="货代名称、交接时间、运单号或交接凭证" className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2"/></label>
              <div className="grid gap-3 sm:grid-cols-3">{([
                ["packaging", "包装费用"], ["procurement", "采购其他费用"], ["shipping", "出货其他费用"],
              ] as const).map(([key, label]) => <label key={key}>{label}（人民币）<input required inputMode="decimal" type="number" min="0" max="999999999999.99" step="0.01" value={shipmentDraft[key]} onChange={(event) => setShipmentDraft((current) => current && { ...current, [key]: event.target.value })} placeholder="未发生填0" className="mt-1 h-10 w-full rounded-lg border px-3"/></label>)}</div>
              {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p> : null}
              <div className="flex justify-end gap-2 border-t pt-4"><button type="button" disabled={busy} onClick={() => { setShipmentDraft(null); setError(""); }} className="rounded-lg border px-4 py-2">取消</button><button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-40">{busy ? "正在记录…" : "确认交货代并保存费用"}</button></div>
            </form> : null}
          </AppDialog>
          <ConfirmDialog open={batchStage !== null} title={batchStage === "RECEIVED" ? "确认选中产品已全部回货？" : "确认选中产品已完成理货？"}
            description={batchStage === "RECEIVED" ? `将选中 ${selectedItems.length} 项的累计回货数更新至订购数。请先核对实物，未回齐的产品不要选中。` : `将选中 ${selectedItems.length} 项的回货数和理货完成数更新至订购数。仅在实物已回齐、测试贴标并打包完成后确认；未处理完的产品不要选中。`}
            confirmLabel="确认更新实物进度" busy={busy} onCancel={() => { if (!busy) setBatchStage(null); }} onConfirm={() => { if (batchStage) void runBatchProgress(batchStage); }}/>
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
                  value={exceptionNote}
                  onChange={(e) => setExceptionNote(e.target.value)}
                  maxLength={1000}
                  aria-label="本次整单异常处理原因"
                  placeholder={
                    status === "SHORTAGE" || status === "CANCELLED"
                      ? "必须填写本次缺货或取消的具体原因"
                      : "填写本次恢复备货的说明"
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
              <h2 className="font-semibold">累计交货代费用（内部 · 人民币）</h2>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
                <span>包装：¥{Number(data.expenses.packaging_cost_cny).toFixed(2)}</span>
                <span>采购发生：¥{Number(data.expenses.procurement_expenses_cny).toFixed(2)}</span>
                <span>出货发生：¥{Number(data.expenses.shipping_expenses_cny).toFixed(2)}</span>
              </div>
              {data.shipments?.length ? <div className="mt-3 space-y-2 border-t pt-3">{data.shipments.map((shipment) => <div key={shipment.id} className="rounded-lg border bg-white p-3"><p className="font-medium">{new Date(shipment.created_at).toLocaleString("zh-CN")} · {shipment.item_ids.length} 项完整产品行</p><p className="mt-1 break-words text-slate-600">{shipment.handoff_note}</p><p className="mt-1 text-slate-600">包装 ¥{Number(shipment.packaging_cost_cny).toFixed(2)} · 采购其他 ¥{Number(shipment.procurement_expenses_cny).toFixed(2)} · 出货其他 ¥{Number(shipment.shipping_expenses_cny).toFixed(2)}</p></div>)}</div> : null}
            </section>
          ) : null}
          <section className="border-t p-5">
            <h2 className="font-semibold">状态流转记录</h2>
            <div className="mt-3 space-y-2" aria-busy={eventsLoading}>
              {data.events.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm"
                >
                  <time className="text-slate-500">
                    {new Date(event.created_at).toLocaleString("zh-CN")}
                  </time>
                  <span>
                    {event.from_status === event.to_status ? <b>实物进度更新</b> : event.from_status
                      ? `${STOCK_STATUS_LABELS[event.from_status as StockOrderStatus]} → `
                      : ""}
                    {event.from_status !== event.to_status ? <b>{STOCK_STATUS_LABELS[event.to_status]}</b> : null}
                  </span>
                  <span className="min-w-[240px] flex-1 break-words text-slate-600">
                    {readableEventNote(event.note)}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    操作人：{event.creator?.name || event.creator?.email || (event.created_by ? `未知用户（${event.created_by.slice(0, 8)}）` : "历史系统记录")}
                  </span>
                </div>
              ))}
              {!eventsLoading && data.events.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">暂无状态流转记录</p> : null}
            </div>
            {data.event_count > 10 ? <AppPagination page={eventPage} pageSize={10} total={data.event_count} itemLabel="条记录" onPage={(page) => void loadEvents(page)} onPageSize={() => {}} pageSizes={[10]} /> : null}
          </section>
        </section>
      </div>
    </main>
  );
}
