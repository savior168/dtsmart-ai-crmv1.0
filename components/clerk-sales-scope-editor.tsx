"use client";

import { useEffect, useState } from "react";

type Seller = { id: string; name: string | null; email: string; role: string; status: string };

export function ClerkSalesScopeEditor({ clerkId }: { clerkId: string }) {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/users/${clerkId}/clerk-scope`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "授权范围加载失败");
        return body as { sellers: Seller[]; sales_user_ids: string[] };
      })
      .then((body) => {
        if (!active) return;
        setSellers(body.sellers);
        setAssigned(body.sales_user_ids);
        setInitial(body.sales_user_ids);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "授权范围加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clerkId]);

  const changed = [...assigned].sort().join(",") !== [...initial].sort().join(",");
  const visible = sellers.filter((seller) => `${seller.name || ""} ${seller.email}`.toLowerCase().includes(search.toLowerCase()));
  async function save() {
    if (!changed || !reason.trim()) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/users/${clerkId}/clerk-scope`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_user_ids: assigned, reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "授权范围保存失败");
      setInitial(assigned);
      setReason("");
      setSuccess("已保存，后续请求立即按新范围生效。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "授权范围保存失败"); }
    finally { setSaving(false); }
  }

  return <details className="mx-5 mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm">
    <summary className="cursor-pointer font-semibold text-slate-900">制单员 · 可服务的销售员范围 {loading ? "加载中…" : `（已授权 ${assigned.length} 人）`}</summary>
    <p className="mt-2 text-xs leading-5 text-slate-600">勾选后可为该销售员或主管的客户创建 PI，并查看其 PI 及备货单；不代替“创建/查看”页面权限。未勾选者不能制单或查看，即使知道单据链接。已停用销售员仅供历史单据范围维护。</p>
    {error ? <p role="alert" className="mt-3 text-rose-700">{error}</p> : null}
    {success ? <p role="status" className="mt-3 text-emerald-700">{success}</p> : null}
    {!loading ? <>
      <input aria-label="搜索可授权销售员" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名或邮箱" className="mt-3 h-9 w-full rounded-lg border border-slate-200 bg-white px-3" />
      <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border bg-white p-2">
        {visible.map((seller) => <label key={seller.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
          <input type="checkbox" checked={assigned.includes(seller.id)} onChange={(event) => setAssigned((current) => event.target.checked ? [...current, seller.id] : current.filter((id) => id !== seller.id))} />
          <span>{seller.name || seller.email}</span><span className="text-xs text-slate-500">{seller.role === "SUPERVISOR" ? "主管" : "销售员"}{seller.status !== "ACTIVE" ? " · 已停用" : ""}</span>
        </label>)}
        {!visible.length ? <p className="p-2 text-slate-500">没有匹配的销售员</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="制单范围变更原因" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="填写授权或撤权原因" className="h-9 min-w-48 flex-1 rounded-lg border border-slate-200 bg-white px-3" />
        <button type="button" disabled={!changed || !reason.trim() || saving} onClick={() => void save()} className="h-9 rounded-lg bg-blue-600 px-4 text-white disabled:opacity-50">{saving ? "保存中…" : "保存范围"}</button>
      </div>
    </> : null}
  </details>;
}
