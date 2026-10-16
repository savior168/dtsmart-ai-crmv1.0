"use client";

import { useCallback, useEffect, useState } from "react";
import { AppPagination } from "@/components/ui/app-pagination";

type Account = { id: string; label: string; currency: string; instructions: string; active: boolean };
const blank = () => ({ label: "", currency: "", instructions: "", active: true });
const input = "w-full rounded-lg border px-3 py-2 text-sm";

export function PiPaymentAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const load = useCallback(async () => {
    const response = await fetch("/api/pi-payment-accounts", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "收款账户加载失败"); return; }
    setAccounts(body.data || []);
    setPage((current) => Math.min(current, Math.max(1, Math.ceil((body.data || []).length / pageSize))));
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
      setEditing(null); setForm(blank()); setShowForm(false); await load();
    } catch { setError("网络异常，请刷新后核对账户状态"); }
    finally { setBusy(false); }
  }
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-4">
    <div><h1 className="text-2xl font-bold">PI收款账户</h1><p className="mt-1 text-sm text-slate-500">仅系统管理员可维护。销售员可选择任一启用账户，不受PI报价币种限制；订单保存账户快照，之后修改不会篡改历史PI。</p></div>
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">共 {accounts.length} 个账户；账户信息较长时可在下方按页查看。</p><button type="button" onClick={() => { setEditing(null); setForm(blank()); setShowForm((current) => !current); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">{showForm && !editing ? "收起新增表单" : "新增收款账户"}</button></div>
    {showForm ? <section id="account-form" className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-semibold">{editing ? "编辑收款账户" : "新增收款账户"}</h2><div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">账户名称<input className={input} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="例如 公司美元账户" /></label>
      <label className="text-sm">账户币种（管理标记，不限制PI报价币种）<input className={input} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="USD / NGN / CNY" maxLength={3} /></label>
      <label className="text-sm md:col-span-2">展示在PI的完整收款信息<textarea className={input} rows={5} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="收款人、银行/平台、账号等；请先核对收款主体" /></label>
      <label className="text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> 启用供新PI选择</label>
    </div><div className="mt-4 flex gap-2"><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "保存中…" : "保存账户"}</button><button type="button" onClick={() => { setEditing(null); setForm(blank()); setShowForm(false); }} className="rounded-lg border px-4 py-2 text-sm">取消</button></div></section> : null}
    <section className="overflow-hidden rounded-xl border bg-white"><h2 className="border-b px-5 py-4 font-semibold">现有账户</h2><div className="grid gap-3 p-4 lg:grid-cols-2">{accounts.slice((page - 1) * pageSize, page * pageSize).map((account) => <div key={account.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-4"><div className="min-w-0"><b className="break-words">{account.label} · {account.currency}</b><span className={`ml-2 text-xs ${account.active ? "text-emerald-700" : "text-slate-500"}`}>{account.active ? "启用" : "停用"}</span><p className="mt-2 whitespace-pre-wrap break-all text-sm leading-5 text-slate-600">{account.instructions}</p></div><button type="button" onClick={() => { setEditing(account.id); setForm({ label: account.label, currency: account.currency, instructions: account.instructions, active: account.active }); setShowForm(true); window.requestAnimationFrame(() => document.getElementById("account-form")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} className="shrink-0 rounded-lg border px-3 py-2 text-sm">编辑</button></div>)}{!accounts.length ? <p className="text-sm text-slate-500">尚无收款账户。添加并启用后，销售员才能创建PI。</p> : null}</div>{accounts.length > pageSize ? <AppPagination page={page} pageSize={pageSize} total={accounts.length} onPage={setPage} onPageSize={() => {}} pageSizes={[pageSize]} itemLabel="个账户" /> : null}</section>
  </div></main>;
}
