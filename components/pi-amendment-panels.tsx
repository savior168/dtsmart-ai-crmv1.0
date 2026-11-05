"use client";

import { useState } from "react";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { diffPiAmendment, type PiAmendmentLine } from "@/lib/orders/pi-amendment-diff";
import { warehousePiAmendment, type PiAmendmentRecord, type WarehousePiChange } from "@/lib/orders/pi-amendment-view";

type Editable = PiAmendmentLine & { line_number: number | null };
const moneyValid = (value: number) => Number.isFinite(value) && value >= 0
  && value <= 999999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const lineLabel = (line: Record<string, unknown> | null) => line
  ? [line.item_name, line.brand, line.model, line.quality].filter(Boolean).join(" · ") : "—";

export function PiAmendmentSalesPanel({ orderId, revision, items, progress, amendments,
  appliedCount, canRequest, onUpdated }: {
  orderId: string; revision: number; items: Editable[];
  progress: Array<{ line_number: number; received_quantity: number; shipped_quantity: number }>;
  amendments: PiAmendmentRecord[]; appliedCount: number; canRequest: boolean; onUpdated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Editable[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const progressByLine = new Map(progress.map((row) => [row.line_number, row]));
  const locked = new Set(items.filter((item) => item.line_number !== null
    && Number(progressByLine.get(item.line_number)?.shipped_quantity || 0) > 0).map((item) => item.id));
  function edit(index: number, key: keyof Editable, value: string | number) {
    setDraft((current) => current?.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) || null);
  }
  async function withdraw(requestId: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/amendments?request_id=${encodeURIComponent(requestId)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "撤回变更失败");
      await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "撤回变更失败"); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!draft || busy) return;
    try {
      if (!reason.trim() || reason.length > 500 || draft.length < 1 || draft.length > 500
        || draft.some((row) => !row.item_name.trim() || !row.brand.trim() || !row.model.trim()
          || !row.quality.trim()
          || !Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) <= 0
          || !moneyValid(Number(row.unit_price_cny)) || !moneyValid(Number(row.estimated_unit_cost_cny)))) {
        throw new Error("请填写变更原因、必填产品资料、整数数量及准确的人民币单价");
      }
      const proposed = draft.map((row) => ({ ...row, quantity: Number(row.quantity),
        unit_price_cny: Number(row.unit_price_cny),
        estimated_unit_cost_cny: Number(row.estimated_unit_cost_cny) }));
      const progressMap = new Map(items.map((row) => [row.id, {
        received_quantity: Number(progressByLine.get(row.line_number || -1)?.received_quantity || 0),
        shipped_quantity: Number(progressByLine.get(row.line_number || -1)?.shipped_quantity || 0),
      }]));
      const changes = diffPiAmendment(items, proposed, progressMap);
      if (!changes.length) throw new Error("请先修改至少一项产品");
      setBusy(true); setError("");
      const response = await fetch(`/api/orders/${orderId}/amendments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: revision, items: proposed, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "变更申请失败");
      setDraft(null); setReason("");
      await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "变更申请失败"); }
    finally { setBusy(false); }
  }
  return <section className="border-t p-5" aria-label="PI订单变更">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">订单变更 · 已生效 {appliedCount}/3 次</h2>
        <p className="mt-1 text-xs text-slate-600">仅创建人可申请；仓库确认前不改正式 PI。已交货代产品项锁定，实物需退回/重新分配的变更先挂起。</p></div>
      {canRequest ? <button type="button" onClick={() => { setError(""); setDraft(items.map((row) => ({ ...row }))); }}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">申请变更</button> : null}
    </div>
    <div className="mt-3 space-y-2">{amendments.map((record) => {
      const view = warehousePiAmendment(record);
      return <div key={record.id} className={`rounded-lg border p-3 text-sm ${record.status === "PENDING" ? "border-amber-300 bg-amber-50" : "bg-slate-50"}`}>
        <p className="font-medium">{record.status === "PENDING" ? "待仓库确认" : record.status === "APPLIED" ? `已生效 · PI v${record.applied_revision}` : record.status === "WITHDRAWN" ? "申请已撤回" : "已驳回"} · {new Date(record.created_at).toLocaleString("zh-CN")}</p>
        <p className="mt-1 text-slate-600">原因：{record.reason}</p><AmendmentChanges changes={view.changes}/>
        {record.status === "PENDING" ? <button type="button" disabled={busy} onClick={() => void withdraw(record.id)} className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">撤回待确认申请</button> : null}
        {record.decision_note ? <p className="mt-1 text-slate-600">仓库说明：{record.decision_note}</p> : null}
      </div>;
    })}</div>
    {error && !draft ? <p role="alert" className="mt-2 rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
    <AppDialog open={draft !== null} title="申请PI订单变更" description="整份申请须由仓库确认后才同时更新PI与备货单；已交货代行不能修改。" onClose={() => { if (!busy) setDraft(null); }} width="max-w-6xl">
      {draft ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-3 text-sm">
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">{draft.map((row, index) => <div key={row.id} className={`rounded-lg border p-3 ${locked.has(row.id) ? "bg-slate-50" : "bg-white"}`}>
          <div className="mb-2 flex justify-between"><b>{row.line_number ? `原第 ${row.line_number} 项` : "新增产品"}{locked.has(row.id) ? " · 已交货代，锁定" : ""}</b>
            {!locked.has(row.id) ? <button type="button" onClick={() => setDraft((current) => current?.filter((_, rowIndex) => rowIndex !== index) || null)} className="text-rose-700">删除此项</button> : null}</div>
          <div className="grid gap-2 md:grid-cols-4">{(["item_name","brand","model","quality","description","description_zh","preparation_requirement","internal_note","quantity","unit_price_cny","estimated_unit_cost_cny"] as const).map((key) => <label key={key} className="text-xs text-slate-600">
            {({ item_name: "产品类型", brand: "品牌", model: "型号", quality: "质量", description: "产品描述", description_zh: "仓库中文规格", preparation_requirement: "理货要求", internal_note: "内部备注", quantity: "数量", unit_price_cny: "售价 ¥/件", estimated_unit_cost_cny: "销售成本 ¥/件" })[key]}
            <input disabled={locked.has(row.id)} required={!(["description","description_zh","preparation_requirement","internal_note"] as string[]).includes(key)}
              type={["quantity","unit_price_cny","estimated_unit_cost_cny"].includes(key) ? "number" : "text"}
              step={key === "quantity" ? "1" : "0.01"} min={["quantity","unit_price_cny","estimated_unit_cost_cny"].includes(key) ? key === "quantity" ? "1" : "0" : undefined}
              value={String(row[key] ?? "")} onChange={(event) => edit(index,key,["quantity","unit_price_cny","estimated_unit_cost_cny"].includes(key) ? Number(event.target.value) : event.target.value)}
              className="mt-1 h-9 w-full rounded border px-2 disabled:bg-slate-100" /></label>)}</div>
        </div>)}</div>
        <button type="button" onClick={() => setDraft((current) => [...current || [], { id: crypto.randomUUID(), line_number: null,
          item_name: "", brand: "", model: "", quality: "", description: "", description_zh: "",
          preparation_requirement: "", internal_note: "", quantity: 1, unit_price_cny: 0, estimated_unit_cost_cny: 0 }])}
          className="rounded border border-blue-300 px-3 py-2 text-blue-700">＋ 增加产品</button>
        <label className="block">变更原因（必填）<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded border p-2" /></label>
        {error ? <p role="alert" className="rounded bg-rose-50 p-2 text-rose-700">{error}</p> : null}
        <DialogActions busy={busy} onCancel={() => setDraft(null)} confirmLabel="提交仓库确认" />
      </form> : null}
    </AppDialog>
  </section>;
}

export function AmendmentChanges({ changes }: { changes: WarehousePiChange["changes"] }) {
  return <div className="mt-2 space-y-1">{changes.map((change, index) => <div key={`${change.line_number || "new"}-${index}`}
    className={`rounded border px-2 py-1.5 text-xs ${change.kind === "新增" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : change.kind === "删除" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
    <b>{change.kind}{change.line_number ? ` · 原第 ${change.line_number} 项` : ""}</b>{" "}
    {change.kind === "删除" ? <s>{lineLabel(change.before)} · {String(change.before?.quantity)} 件</s>
      : change.kind === "新增" ? <span>{lineLabel(change.after)} · {String(change.after?.quantity)} 件</span>
      : <span>{lineLabel(change.before)} · {String(change.before?.quantity)} 件 → {lineLabel(change.after)} · {String(change.after?.quantity)} 件</span>}
    {change.sales_price_changed || change.seller_cost_changed ? <span className="ml-2 font-medium">（{change.sales_price_changed ? "售价" : ""}{change.sales_price_changed && change.seller_cost_changed ? "、" : ""}{change.seller_cost_changed ? "销售预估成本" : ""}已调整，仓库不展示金额）</span> : null}
  </div>)}</div>;
}

export function PiAmendmentWarehousePanel({ stockId, amendments, canDecide, onUpdated }: {
  stockId: string; amendments: WarehousePiChange[]; canDecide: boolean; onUpdated: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<{ id: string; approve: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!decision || busy || !decision.approve && !reason.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/stock-orders/${stockId}/amendments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: decision.id, approve: decision.approve, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "PI变更审批失败");
      setDecision(null); setReason(""); await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审批失败"); }
    finally { setBusy(false); }
  }
  if (!amendments.length) return null;
  return <section className="border-t p-4" aria-label="PI订单变更记录">
    <h2 className="font-semibold">PI订单变更 · 仓库确认记录</h2>
    <p className="mt-1 text-xs text-slate-600">待确认变更不代表已生效；涉及的产品行暂停新增作业，已交货代行不可修改。打印旧版本前请核对 PI 版本。</p>
    <div className="mt-3 space-y-2">{amendments.map((record) => <div key={record.id} className={`rounded-lg border p-3 text-sm ${record.status === "PENDING" ? "border-amber-300 bg-amber-50" : "bg-slate-50"}`}>
      <div className="flex flex-wrap justify-between gap-2"><b>{record.status === "PENDING" ? "待确认 · 尚未生效" : record.status === "APPLIED" ? `已生效 · PI v${record.applied_revision}` : record.status === "WITHDRAWN" ? "申请已撤回" : "已驳回"}</b><time className="text-slate-500">{new Date(record.created_at).toLocaleString("zh-CN")}</time></div>
      <p className="mt-1">申请原因：{record.reason}</p><AmendmentChanges changes={record.changes}/>
      {record.decision_note ? <p className="mt-1 text-slate-600">审批说明：{record.decision_note}</p> : null}
      {canDecide && record.status === "PENDING" ? <div className="mt-3 flex gap-2"><button type="button" onClick={() => { setError(""); setDecision({ id: record.id, approve: true }); }} className="rounded bg-emerald-700 px-3 py-1.5 text-white">核对实物并确认同步</button><button type="button" onClick={() => { setError(""); setDecision({ id: record.id, approve: false }); }} className="rounded border border-rose-300 px-3 py-1.5 text-rose-700">驳回</button></div> : null}
    </div>)}</div>
    <AppDialog open={decision !== null} title={decision?.approve ? "确认PI变更并同步备货单" : "驳回PI变更"} description="确认前请逐项核对实物、送货单及未交货代数量；数据库会一次性同步PI、报价、备货单或全部回滚。" onClose={() => { if (!busy) setDecision(null); }} width="max-w-md">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-3 text-sm">
        <label className="block">{decision?.approve ? "核对说明" : "驳回原因（必填）"}<textarea required={!decision?.approve} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-24 w-full rounded border p-2" /></label>
        {error ? <p role="alert" className="rounded bg-rose-50 p-2 text-rose-700">{error}</p> : null}
        <DialogActions busy={busy} onCancel={() => setDecision(null)} confirmLabel={decision?.approve ? "确认并同步" : "确认驳回"} tone={decision?.approve ? undefined : "danger"}/>
      </form>
    </AppDialog>
  </section>;
}
