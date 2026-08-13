"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, Upload, Users, X } from "lucide-react";
import { CustomerForm } from "@/components/customer-form";
import type { Customer } from "@/lib/types";
import { AI_INDUSTRIES, AI_LEVELS, CUSTOMER_STATUSES } from "@/lib/types";

type UserOption = { id: string; name: string | null; email: string; role: string };

export function CustomersView() {
  const [items, setItems] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [aiLevel, setAiLevel] = useState("");
  const [industry, setIndustry] = useState("");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [deleted, setDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState("FOLLOWING");
  const [assignee, setAssignee] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [role, setRole] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), search, status, deleted: String(deleted), ai_level: aiLevel, industry, target });
    const response = await fetch(`/api/customers?${params}`);
    const body = await response.json();
    setLoading(false);
    if (!response.ok) return setError(body.error || "查询失败");
    setItems(body.data);
    setCount(body.count);
  }, [page, search, status, deleted, aiLevel, industry, target]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    fetch("/api/users/options")
      .then((response) => response.json())
      .then((body) => {
        setUsers(body.users || []);
        setRole(body.profile?.role || "");
      })
      .catch(() => undefined);
  }, []);

  function resetPage(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function toggle(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    const pageIds = items.map((item) => item.id);
    const all = pageIds.every((id) => checked.has(id));
    setChecked((current) => {
      const next = new Set(current);
      pageIds.forEach((id) => all ? next.delete(id) : next.add(id));
      return next;
    });
  }

  async function action(customer: Customer) {
    const restore = Boolean(customer.deleted_at);
    if (!restore && !confirm(`确认删除 ${customer.company_name}？`)) return;
    const response = await fetch(`/api/customers/${customer.id}${restore ? "/restore" : ""}`, { method: restore ? "POST" : "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      return setError(body.error || "操作失败");
    }
    setDetail(null);
    await load();
  }

  async function runBatch(actionName: "STAGE" | "ASSIGN") {
    const ids = [...checked];
    if (!ids.length) return;
    setBatchBusy(true);
    setError("");
    setProgress("正在处理批量操作...");
    const response = await fetch("/api/customers/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: actionName, status: batchStatus, user_id: assignee }),
    });
    const body = await response.json();
    setBatchBusy(false);
    if (!response.ok) {
      setProgress("");
      return setError(body.error || "批量操作失败");
    }
    setProgress(`完成 ${body.success_count}/${body.total_count} 个客户`);
    setChecked(new Set());
    await load();
  }

  async function batchAi() {
    const ids = [...checked];
    if (!ids.length) return;
    setBatchBusy(true);
    setError("");
    let success = 0;
    for (let index = 0; index < ids.length; index++) {
      setProgress(`深度AI分析 ${index + 1}/${ids.length}：抓取官网和Google证据后综合判断`);
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: ids[index] }),
      });
      if (response.ok) success++;
      else {
        const body = await response.json();
        if (body.error === "OPENAI_NOT_CONFIGURED") {
          setError("尚未配置 OPENAI_API_KEY");
          break;
        }
      }
    }
    setBatchBusy(false);
    setProgress(`AI分析完成 ${success}/${ids.length}`);
    setChecked(new Set());
    await load();
  }

  const totalPages = Math.max(1, Math.ceil(count / 10));

  return (
    <main className="min-h-screen p-5 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[.22em] text-indigo-400">Customer Center</p>
            <h1 className="mt-2 text-3xl font-semibold">客户管理中心</h1>
            <p className="mt-2 text-sm text-slate-400">客户资产、批量处理与销售流程统一管理</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/ai-screening" className="flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-violet-200"><Sparkles size={17} />AI筛选</Link>
            <Link href="/import" className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5"><Upload size={17} />导入</Link>
            <button onClick={() => setEditing(null)} className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 font-medium"><Plus size={17} />新增客户</button>
          </div>
        </header>

        <section className="mt-7 rounded-2xl border border-white/10 bg-white/[.035] p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 xl:col-span-2">
              <Search size={17} className="text-slate-500" />
              <input value={search} onChange={(event) => resetPage(setSearch, event.target.value)} placeholder="搜索公司、联系人、电话或邮箱" className="w-full bg-transparent py-2.5 outline-none" />
            </label>
            <Filter value={status} onChange={(value) => resetPage(setStatus, value)} label="全部状态" options={CUSTOMER_STATUSES} />
            <Filter value={aiLevel} onChange={(value) => resetPage(setAiLevel, value)} label="全部AI等级" options={AI_LEVELS} />
            <Filter value={industry} onChange={(value) => resetPage(setIndustry, value)} label="全部行业" options={AI_INDUSTRIES} />
            <select value={target} onChange={(event) => resetPage(setTarget, event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3">
              <option value="">全部目标客户</option>
              <option value="valid">有效（≥60）</option>
              <option value="invalid">无效（＜60）</option>
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => { setDeleted(!deleted); setPage(1); }} className={`rounded-xl border px-4 py-2 text-sm ${deleted ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-white/10"}`}>{deleted ? "查看正常客户" : "回收站"}</button>
            {checked.size > 0 && !deleted && (
              <>
                <span className="ml-2 text-sm text-indigo-300">已选 {checked.size} 项</span>
                <button disabled={batchBusy} onClick={batchAi} className="flex items-center gap-2 rounded-xl border border-violet-400/20 px-3 py-2 text-sm text-violet-200"><Bot size={15} />批量深度AI分析</button>
                <select value={batchStatus} onChange={(event) => setBatchStatus(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm">
                  <option value="CLAIMED">CLAIMED</option>
                  <option value="FOLLOWING">FOLLOWING</option>
                  <option value="QUOTE">QUOTE</option>
                  <option value="DEAL">DEAL</option>
                </select>
                <button disabled={batchBusy} onClick={() => runBatch("STAGE")} className="rounded-xl border border-white/10 px-3 py-2 text-sm">批量修改状态</button>
                {role === "ADMIN" && (
                  <>
                    <select value={assignee} onChange={(event) => setAssignee(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm">
                      <option value="">选择负责人</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                    </select>
                    <button disabled={batchBusy || !assignee} onClick={() => runBatch("ASSIGN")} className="flex items-center gap-2 rounded-xl border border-indigo-400/20 px-3 py-2 text-sm text-indigo-200"><Users size={15} />批量分配</button>
                  </>
                )}
              </>
            )}
          </div>
          {progress && <p className="mt-3 text-sm text-emerald-300">{progress}</p>}
          {error && <p className="mt-4 text-rose-300">{error}</p>}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-y border-white/10 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-3"><input type="checkbox" checked={items.length > 0 && items.every((item) => checked.has(item.id))} onChange={togglePage} aria-label="选择当前页" className="accent-indigo-500" /></th>
                  {["公司 / 联系人", "国家 / 行业", "联系方式", "AI", "状态", "创建时间", "操作"].map((heading) => <th key={heading} className="px-3 py-3 font-medium">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => (
                  <tr key={customer.id} onClick={() => setDetail(customer)} className="cursor-pointer border-b border-white/[.06] hover:bg-white/[.03]">
                    <td className="px-3"><input type="checkbox" checked={checked.has(customer.id)} onChange={() => toggle(customer.id)} onClick={(event) => event.stopPropagation()} aria-label={`选择${customer.company_name}`} className="accent-indigo-500" /></td>
                    <td className="px-3 py-4"><b>{customer.company_name}</b><div className="text-xs text-slate-500">{customer.contact_name || "—"}</div></td>
                    <td className="px-3">{customer.country || "—"}<div className="text-xs text-slate-500">{customer.industry || customer.category || "未分类"}</div></td>
                    <td className="px-3">{customer.phone || customer.whatsapp || "—"}<div className="text-xs text-slate-500">{customer.email || ""}</div></td>
                    <td className="px-3"><span className="font-semibold text-emerald-300">{customer.ai_score ?? "—"}</span><div className="text-xs text-slate-500">{customer.ai_level || "未评级"}</div></td>
                    <td className="px-3"><span className="rounded-full bg-indigo-400/10 px-2 py-1 text-xs text-indigo-300">{customer.status}</span></td>
                    <td className="px-3 text-slate-400">{new Date(customer.created_at).toLocaleDateString("zh-CN")}</td>
                    <td className="px-3">
                      <div className="flex gap-1">
                        <Link href={`/customers/${customer.id}`} onClick={(event) => event.stopPropagation()} className="rounded-lg px-2 py-1.5 text-xs text-indigo-300 hover:bg-white/10">CRM</Link>
                        <button onClick={(event) => { event.stopPropagation(); setEditing(customer); }} className="rounded-lg p-2 hover:bg-white/10" aria-label="编辑"><Pencil size={16} /></button>
                        <button onClick={(event) => { event.stopPropagation(); action(customer); }} className="rounded-lg p-2 hover:bg-white/10" aria-label={deleted ? "恢复" : "删除"}>{deleted ? <RotateCcw size={16} /> : <Trash2 size={16} />}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <p className="py-10 text-center text-slate-500">加载中...</p>}
            {!loading && !items.length && <p className="py-10 text-center text-slate-500">暂无客户</p>}
          </div>

          <footer className="mt-5 flex items-center justify-between text-sm text-slate-400">
            <span>共 {count} 条</span>
            <div className="flex items-center gap-3">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-white/10 p-2 disabled:opacity-30"><ChevronLeft size={16} /></button>
              <span>第 {page} / {totalPages} 页</span>
              <button disabled={page * 10 >= count} onClick={() => setPage(page + 1)} className="rounded-lg border border-white/10 p-2 disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
          </footer>
        </section>
      </div>

      {editing !== undefined && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#101522] p-6">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-semibold">{editing ? "编辑客户" : "新增客户"}</h2>
              <button onClick={() => setEditing(undefined)}><X /></button>
            </div>
            <CustomerForm customer={editing} onCancel={() => setEditing(undefined)} onDone={() => { setEditing(undefined); load(); }} />
          </section>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={() => setDetail(null)}>
          <aside onClick={(event) => event.stopPropagation()} className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#101522] p-7">
            <div className="flex justify-between">
              <h2 className="text-2xl font-semibold">{detail.company_name}</h2>
              <button onClick={() => setDetail(null)}><X /></button>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-5">
              {[["联系人", detail.contact_name], ["国家", detail.country], ["电话", detail.phone], ["WhatsApp", detail.whatsapp], ["邮箱", detail.email], ["行业", detail.industry], ["AI评分", detail.ai_score], ["AI等级", detail.ai_level], ["状态", detail.status], ["创建时间", new Date(detail.created_at).toLocaleString("zh-CN")]].map(([key, value]) => (
                <div key={String(key)}>
                  <p className="text-xs text-slate-500">{key}</p>
                  <p className="mt-1 break-words">{value ?? "—"}</p>
                </div>
              ))}
            </div>
            <div className="mt-7">
              <p className="text-xs text-slate-500">AI判断理由</p>
              <p className="mt-1 leading-7 text-slate-300">{detail.ai_reason || "尚未进行AI分析"}</p>
            </div>
            <Link href={`/customers/${detail.id}`} className="mt-7 block rounded-xl bg-indigo-500 px-5 py-3 text-center font-medium">进入客户CRM</Link>
          </aside>
        </div>
      )}
    </main>
  );
}

function Filter({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: readonly string[] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3">
      <option value="">{label}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
