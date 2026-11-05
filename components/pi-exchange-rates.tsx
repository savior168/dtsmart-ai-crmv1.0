"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { AppDialog } from "@/components/ui/app-dialog";

type Rate = { currency: string; label: string; reference_cny: number | null; source: "CFETS" | "AGGREGATED" | "BAIDU_FINSCOPE" | "MANUAL" | "IDENTITY" | "UNAVAILABLE"; source_url?: string | null; reference_date: string | null; source_updated_at?: string | null; business_cny: number | null; adjustment_mode: "OFFSET" | "PERCENT" | "FIXED"; adjustment_value: number; manual_reference_cny: number | null; updated_at: string | null };
const input = "h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
const showRate = (rate: number) => Number(rate.toFixed(rate >= 1 ? 4 : 8)).toString();
function sourceLabel(rate: Rate) {
  if (rate.source === "BAIDU_FINSCOPE") return `百度 FinScope 报价 ${rate.source_updated_at || rate.reference_date || ""}`;
  if (rate.source === "CFETS") return `中国外汇交易中心（人民银行授权）${rate.reference_date}`;
  if (rate.source === "AGGREGATED") return `Frankfurter 多来源汇总 ${rate.reference_date}`;
  if (rate.source === "MANUAL") return `手工参考价 ${rate.updated_at ? new Date(rate.updated_at).toLocaleDateString("zh-CN") : ""}`;
  return rate.source === "IDENTITY" ? "本币" : "无可用近期来源";
}

export function PiExchangeRates({ canManage }: { canManage: boolean }) {
  const [rates, setRates] = useState<Rate[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [mode, setMode] = useState<Rate["adjustment_mode"]>("OFFSET");
  const [value, setValue] = useState("0");
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/pi-exchange-rates", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "汇率加载失败");
      setRates(body.rates || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "汇率加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function edit(rate: Rate) {
    setEditing(rate.currency); setMode(rate.currency === "CNY" ? "FIXED" : rate.adjustment_mode); setValue(rate.currency === "CNY" ? "1" : String(rate.adjustment_value));
    setManual(rate.manual_reference_cny == null ? "" : String(rate.manual_reference_cny)); setError("");
  }
  async function save() {
    if (!canManage || !editing || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pi-exchange-rates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency: editing, adjustment_mode: mode, adjustment_value: Number(value), manual_reference_cny: manual }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "汇率规则保存失败");
      setEditing(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "汇率规则保存失败"); }
    finally { setBusy(false); }
  }
  const selected = rates.find((rate) => rate.currency === editing);
  const visible = rates.filter((rate) => `${rate.currency} ${rate.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-4">
    <header><h1 className="text-2xl font-bold">PI汇率设置</h1><p className="mt-1 text-sm text-slate-600">美元、欧元、英镑、澳元、加元和新西兰元默认采用百度 FinScope 报价，参考汇率四舍五入至 2 位小数后减 ¥0.10；有维护权限的账号可为新 PI 修改默认业务规则，销售也可按实际交易条件调整并确认本单汇率。PI创建时展示报价更新时间与核对链接。其他币种沿用现有来源与业务规则。所有参考报价仅供业务核对，不代表银行成交价；已保存 PI 保留本单确认的汇率快照。</p></header>
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    <section className="rounded-xl border bg-white p-4"><label className="text-sm">搜索币种<input className={`${input} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入币种代码或名称" /></label>
      <div className="mt-3 divide-y">{visible.map((rate) => <div key={rate.currency} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><b>{rate.currency} · {rate.label}</b><p className="mt-1 text-slate-600">市场参考：{rate.reference_cny == null ? "暂无" : `1 ${rate.currency} = ${showRate(rate.reference_cny)} CNY`} · {sourceLabel(rate)}{rate.source_url ? <> · <a href={rate.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">核对来源</a></> : null}</p><p className="text-blue-700">业务汇率：{rate.business_cny == null ? "未配置" : `1 ${rate.currency} = ${showRate(rate.business_cny)} CNY`}{rate.currency === "CNY" ? "（人民币固定 1:1）" : rate.adjustment_mode === "FIXED" ? "（固定业务汇率）" : rate.adjustment_mode === "PERCENT" ? `（参考价调整 ${rate.adjustment_value >= 0 ? "+" : ""}${showRate(rate.adjustment_value)}%）` : `（参考价两位小数后 ${rate.adjustment_value >= 0 ? "+" : ""}${showRate(rate.adjustment_value)}）`}</p></div>{rate.currency === "CNY" ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">固定 1:1</span> : canManage ? <button type="button" onClick={() => edit(rate)} className="rounded-lg border px-3 py-2">设置规则</button> : null}</div>)}</div>
    </section>
    {selected ? <AppDialog title={`${selected.currency} · ${selected.label} 业务汇率规则`} description="修改后只影响新建PI；已有PI保留原汇率快照。" onClose={() => setEditing(null)} width="max-w-3xl"><div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">计算方式<AppSelect className={input} disabled={selected.currency === "CNY"} value={mode} onChange={(event) => setMode(event.target.value as Rate["adjustment_mode"])}><option value="OFFSET">参考价 + 固定差额</option><option value="PERCENT">参考价 × (1 + 百分比)</option><option value="FIXED">固定业务汇率</option></AppSelect></label>
      <label className="text-sm">{mode === "OFFSET" ? "差额（如 -0.05）" : mode === "PERCENT" ? "百分比（如 -2）" : "1 外币对应人民币"}<input className={input} disabled={selected.currency === "CNY"} type="number" step="0.000001" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label className="text-sm">手工参考价（仅无近期市场价时使用）<input className={input} type="number" min="0.000001" step="0.000001" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="没有近期市场参考价时填写" /></label>
    </div>{error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}<p className="mt-3 text-xs text-slate-500">销售可在创建 PI 时按实际交易条件调整；参考价不可视为银行成交价。</p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "保存中…" : "保存规则"}</button></div></AppDialog> : null}
  </div></main>;
}
