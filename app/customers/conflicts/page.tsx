"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, LoaderCircle } from "lucide-react";

type Conflict = {
  id: string;
  conflict_type: string;
  status: string;
  created_at: string;
  details?: { submitted?: Record<string, unknown> };
  owner?: { id: string; name: string } | null;
};

const value = (input: unknown) => String(input || "-");
const href = (input: unknown) => { const text = String(input || "").trim(); return !text ? "" : /^https?:\/\//i.test(text) ? text : `https://${text}`; };

export default function CustomerConflictsPage() {
  const [items, setItems] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const response = await fetch("/api/customer-conflicts");
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(body.error || "冲突客户加载失败"); return; }
    setItems(body.data || []); setError("");
  }
  useEffect(() => { void load(); }, []);

  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px]">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">客户管理 / 冲突客户</p><h1 className="mt-2 text-3xl font-bold">冲突客户</h1><p className="mt-2 text-sm text-slate-500">汇总您手动新增和批量导入时发现的跨用户重复客户；系统始终只保留一个客户主记录。</p></div><Link href="/customers" className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50">返回客户列表</Link></div>
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mr-2 inline-block" size={17}/>您可以查看自己提交的原始基本资料和当前归属人，但不能查看归属人的 AI 分析、跟进、保护或操作日志，也不能修改该客户。</div>
    {error && <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}<button onClick={() => void load()} className="ml-3 underline">重新加载</button></div>}
    <section className="mt-4 overflow-x-auto rounded-xl border bg-white shadow-sm"><table className="min-w-[1250px] w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["客户名称","联系人","国家/地区","电话","邮箱","官网","Google Maps","来源","当前归属人","状态","冲突时间"].map((item) => <th className="px-4 py-3 font-medium" key={item}>{item}</th>)}</tr></thead><tbody>{items.map((item) => { const row = item.details?.submitted || {}; return <tr className="border-t" key={item.id}><td className="px-4 py-3 font-medium">{value(row.company_name)}</td><td className="px-4 py-3">{value(row.contact_name)}</td><td className="px-4 py-3">{value(row.country)}</td><td className="px-4 py-3">{value(row.phone)}</td><td className="px-4 py-3">{value(row.email)}</td><td className="max-w-48 px-4 py-3">{href(row.website)?<a href={href(row.website)} target="_blank" rel="noreferrer" className="inline-flex max-w-44 items-center gap-1 text-blue-600"><span className="truncate">{value(row.website)}</span><ExternalLink size={12}/></a>:"-"}</td><td className="max-w-48 px-4 py-3">{href(row.google_url)?<a href={href(row.google_url)} target="_blank" rel="noreferrer" className="inline-flex max-w-44 items-center gap-1 text-blue-600"><span className="truncate">{value(row.google_url)}</span><ExternalLink size={12}/></a>:"-"}</td><td className="px-4 py-3">{value(row.source)}</td><td className="px-4 py-3">{item.owner?.name || "已归属其他用户"}</td><td className="px-4 py-3"><span className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">冲突</span></td><td className="px-4 py-3">{new Date(item.created_at).toLocaleString("zh-CN")}</td></tr>; })}</tbody></table>{loading && <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div>}{!loading && !items.length && <div className="p-12 text-center text-sm text-slate-400">暂无您新增或导入的冲突客户</div>}</section>
  </div></main>;
}
