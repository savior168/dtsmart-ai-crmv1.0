"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, FileSpreadsheet, LoaderCircle, Trash2, Upload } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { ConfirmDialog } from "@/components/ui/app-dialog";

type ImportDraft = { id: string; source_file_name: string; source_order_number: string | null; revision: number; status: string; converted_order_id: string | null; created_at: string };
const sizes = [10, 20, 50, 100, 300, 500];

export function PiImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportDraft[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<ImportDraft | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/import-drafts?page=${page}&page_size=${size}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "导入草稿加载失败");
      setRows(body.data || []);
      setCount(body.count || 0);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入草稿加载失败"); }
    finally { setLoading(false); }
  }, [page, size]);
  useEffect(() => { void load(); }, [load]);

  async function upload(file?: File) {
    if (!file || busy) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024) { setError("请选择2MB以内的.xlsx客户PI文件"); return; }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/orders/import-drafts", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "PI导入失败");
      window.location.assign(`/orders/import/${body.data.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "PI导入失败"); setBusy(false); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  async function deleteDraft() {
    const draft = deleting;
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/import-drafts/${draft.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: draft.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "删除失败");
      setDeleting(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setBusy(false); }
  }

  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1200px] space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-bold">导入PI订单</h1><Link href="/orders" className="rounded-lg border bg-white px-3 py-2 text-sm">返回PI订单</Link></header>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">从 Excel 导入</h2><p className="mt-1 text-sm text-slate-600">按模板填写，或上传系统导出的 PI 文件。导入后核对信息，再保存为 PI 草稿。支持 .xlsx，最大 2 MB。</p>
      <div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={() => window.location.assign("/api/orders/import-template?format=invoice")} className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm text-blue-700"><FileDown size={16}/>下载PI导入模板</button><input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => void upload(event.target.files?.[0])}/><button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin"/> : <Upload size={16}/>}选择文件并导入</button></div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </section>
    <section className="overflow-hidden rounded-xl border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><h2 className="font-semibold">我的导入记录</h2><label className="flex items-center gap-2 text-sm">每页<AppSelect aria-label="每页记录数" value={size} onChange={(event) => { setSize(Number(event.target.value)); setPage(1); }} className="h-9 rounded border px-2">{sizes.map((n) => <option key={n} value={n}>{n}</option>)}</AppSelect></label></div>
      {loading ? <div className="grid min-h-32 place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></div> : rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50"><tr><th className="px-4 py-3">订单编号</th><th className="px-4 py-3">来源文件</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">导入时间</th><th className="min-w-[140px] whitespace-nowrap px-4 py-3">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="px-4 py-3 font-medium">{row.source_order_number || "待补"}</td><td className="px-4 py-3">{row.source_file_name}</td><td className="px-4 py-3">{row.status === "PENDING" ? "待补全" : "已转为PI草稿"}</td><td className="px-4 py-3 text-slate-500">{new Date(row.created_at).toLocaleString("zh-CN")}</td><td className="whitespace-nowrap px-4 py-3">{row.status === "PENDING" ? <span className="flex flex-nowrap items-center gap-2"><Link className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-blue-700 hover:underline" href={`/orders/import/${row.id}`}><FileSpreadsheet size={14}/>核对并补全</Link><button type="button" title="删除导入草稿" aria-label={`删除导入草稿 ${row.source_order_number || row.source_file_name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-rose-100 text-rose-600 hover:bg-rose-50" onClick={() => setDeleting(row)}><Trash2 size={14}/></button></span> : row.converted_order_id ? <Link className="whitespace-nowrap text-blue-700 hover:underline" href={`/orders/${row.converted_order_id}`}>查看PI草稿</Link> : "—"}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-slate-500">暂无导入记录</p>}
      <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-600"><span>共 {count} 条</span><span className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((n) => n - 1)} className="rounded border px-3 py-1 disabled:opacity-40">上一页</button>{page} / {Math.max(1, Math.ceil(count / size))}<button disabled={page * size >= count} onClick={() => setPage((n) => n + 1)} className="rounded border px-3 py-1 disabled:opacity-40">下一页</button></span></div>
    </section>
    <ConfirmDialog open={Boolean(deleting)} title="删除待补全导入草稿？" description="只删除这条尚未转换的导入记录，不会删除原Excel文件，也不会影响已创建的正式PI。" confirmLabel="确认删除" danger onCancel={() => setDeleting(null)} onConfirm={() => void deleteDraft()}/>
  </div></main>;
}
