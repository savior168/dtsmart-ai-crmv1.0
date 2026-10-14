"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { AppDialog } from "@/components/ui/app-dialog";

type Rate = { currency: string; label: string; reference_cny: number | null; source: "ECB" | "MANUAL" | "IDENTITY" | "UNAVAILABLE"; reference_date: string | null; business_cny: number | null; adjustment_mode: "OFFSET" | "PERCENT" | "FIXED"; adjustment_value: number; manual_reference_cny: number | null; updated_at: string | null };
const input = "h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";

export function PiExchangeRates() {
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
    if (!editing || busy) return;
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
    <header><h1 className="text-2xl font-bold">PI汇率设置</h1><p className="mt-1 text-sm text-slate-600">欧洲央行工作日参考价仅供参考，并非实时交易价。业务汇率可按固定差额、百分比或固定值设置；未覆盖币种由管理员录入参考价。PI保存时使用销售实际填写的汇率快照。</p></header>
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    <section className="rounded-xl border bg-white p-4"><label className="text-sm">搜索币种<input className={`${input} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入币种代码或名称" /></label>
      <div className="mt-3 divide-y">{visible.map((rate) => <div key={rate.currency} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><b>{rate.currency} · {rate.label}</b><p className="mt-1 text-slate-600">市场参考：{rate.reference_cny == null ? "暂无" : `1 ${rate.currency} = ${Number(rate.reference_cny.toPrecision(10))} CNY`} · {rate.source === "ECB" ? `欧洲央行 ${rate.reference_date}` : rate.source === "MANUAL" ? `管理员录入 ${rate.updated_at ? new Date(rate.updated_at).toLocaleDateString("zh-CN") : ""}` : rate.source === "IDENTITY" ? "本币" : "无来源"}</p><p className="text-blue-700">业务汇率：{rate.business_cny == null ? "未配置" : `1 ${rate.currency} = ${rate.business_cny} CNY`}</p></div><button type="button" onClick={() => edit(rate)} className="rounded-lg border px-3 py-2">设置规则</button></div>)}</div>
    </section>
    {selected ? <AppDialog title={`${selected.currency} · ${selected.label} 业务汇率规则`} description="修改后只影响新建PI；已有PI保留原汇率快照。" onClose={() => setEditing(null)} width="max-w-3xl"><div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">计算方式<AppSelect className={input} disabled={selected.currency === "CNY"} value={mode} onChange={(event) => setMode(event.target.value as Rate["adjustment_mode"])}><option value="OFFSET">参考价 + 固定差额</option><option value="PERCENT">参考价 × (1 + 百分比)</option><option value="FIXED">固定业务汇率</option></AppSelect></label>
      <label className="text-sm">{mode === "OFFSET" ? "差额（如 -0.05）" : mode === "PERCENT" ? "百分比（如 -2）" : "1 外币对应人民币"}<input className={input} disabled={selected.currency === "CNY"} type="number" step="0.000001" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label className="text-sm">手工参考价（仅无官方价时使用）<input className={input} type="number" min="0.000001" step="0.000001" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="没有官方参考价时填写" /></label>
    </div>{error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}<p className="mt-3 text-xs text-slate-500">销售可在创建 PI 时按实际交易条件调整；参考价不可视为银行成交价。</p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "保存中…" : "保存规则"}</button></div></AppDialog> : null}
  </div></main>;
}
