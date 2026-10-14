"use client";

import { useCallback, useEffect, useState } from "react";

type Account = { id: string; label: string; currency: string; instructions: string; active: boolean };
const blank = () => ({ label: "", currency: "", instructions: "", active: true });
const input = "w-full rounded-lg border px-3 py-2 text-sm";

export function PiPaymentAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/pi-payment-accounts", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "收款账户加载失败"); return; }
    setAccounts(body.data || []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pi-payment-accounts", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, id: editing }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "保存失败"); return; }
      setEditing(null); setForm(blank()); await load();
    } catch { setError("网络异常，请刷新后核对账户状态"); }
    finally { setBusy(false); }
  }
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-4">
    <div><h1 className="text-2xl font-bold">PI收款账户</h1><p className="mt-1 text-sm text-slate-500">仅系统管理员可维护。销售员可选择任一启用账户，不受PI报价币种限制；订单保存账户快照，之后修改不会篡改历史PI。</p></div>
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"><section className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-semibold">{editing ? "编辑收款账户" : "新增收款账户"}</h2><div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">账户名称<input className={input} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="例如 公司美元账户" /></label>
      <label className="text-sm">账户币种（管理标记，不限制PI报价币种）<input className={input} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="USD / NGN / CNY" maxLength={3} /></label>
      <label className="text-sm md:col-span-2">展示在PI的完整收款信息<textarea className={input} rows={5} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="收款人、银行/平台、账号等；请先核对收款主体" /></label>
      <label className="text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> 启用供新PI选择</label>
    </div><div className="mt-4 flex gap-2"><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "保存中…" : "保存账户"}</button>{editing ? <button type="button" onClick={() => { setEditing(null); setForm(blank()); }} className="rounded-lg border px-4 py-2 text-sm">取消编辑</button> : null}</div></section>
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-semibold">现有账户</h2><div className="space-y-3">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"><div><b>{account.label} · {account.currency}</b><span className={`ml-2 text-xs ${account.active ? "text-emerald-700" : "text-slate-500"}`}>{account.active ? "启用" : "停用"}</span><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{account.instructions}</p></div><button type="button" onClick={() => { setEditing(account.id); setForm({ label: account.label, currency: account.currency, instructions: account.instructions, active: account.active }); }} className="rounded-lg border px-3 py-2 text-sm">编辑</button></div>)}{!accounts.length ? <p className="text-sm text-slate-500">尚无收款账户。添加并启用后，销售员才能创建PI。</p> : null}</div></section></div>
  </div></main>;
}
