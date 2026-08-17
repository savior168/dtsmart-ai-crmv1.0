"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, LoaderCircle } from "lucide-react";

type Conflict = {
  id: string;
  conflict_type: string;
  status: string;
  created_at: string;
  details?: { submitted?: Record<string, unknown> };
};

const value = (input: unknown) => String(input || "-");

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
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">客户管理 / 冲突客户</p><h1 className="mt-2 text-3xl font-bold">冲突客户</h1><p className="mt-2 text-sm text-slate-500">系统仅保留一个客户主记录；此处展示您提交时的基本字段快照。</p></div><Link href="/customers" className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50">返回客户列表</Link></div>
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mr-2 inline-block" size={17}/>冲突客户仅供核对导入数据。您不能查看归属人的 AI 分析、跟进、保护或操作日志，也不能修改该客户。</div>
    {error && <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}<button onClick={() => void load()} className="ml-3 underline">重新加载</button></div>}
    <section className="mt-4 overflow-x-auto rounded-xl border bg-white shadow-sm"><table className="min-w-[1100px] w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["客户名称","联系人","国家/地区","电话","邮箱","官网","Google Maps","来源","冲突时间"].map((item) => <th className="px-4 py-3 font-medium" key={item}>{item}</th>)}</tr></thead><tbody>{items.map((item) => { const row = item.details?.submitted || {}; return <tr className="border-t" key={item.id}><td className="px-4 py-3 font-medium">{value(row.company_name)}</td><td className="px-4 py-3">{value(row.contact_name)}</td><td className="px-4 py-3">{value(row.country)}</td><td className="px-4 py-3">{value(row.phone)}</td><td className="px-4 py-3">{value(row.email)}</td><td className="max-w-48 break-all px-4 py-3 text-blue-600">{value(row.website)}</td><td className="max-w-48 break-all px-4 py-3 text-blue-600">{value(row.google_url)}</td><td className="px-4 py-3">{value(row.source)}</td><td className="px-4 py-3">{new Date(item.created_at).toLocaleString("zh-CN")}</td></tr>; })}</tbody></table>{loading && <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div>}{!loading && !items.length && <div className="p-12 text-center text-sm text-slate-400">暂无您导入的冲突客户</div>}</section>
  </div></main>;
}
