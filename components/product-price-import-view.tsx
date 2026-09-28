"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, UploadCloud } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/app-dialog";
import { AppStatusBadge } from "@/components/ui/app-list";

type BatchSummary = { id: string; file_name: string; row_count: number; status: string; created_at: string; published_at: string | null };
type PriceRow = { source_row: number; sku: string; product_name: string | null; price_kind: string; currency: string; amount: number; minimum_quantity: number; effective_from: string; source_note: string; expected_amount: number | null; issues: string[] };
type BatchDetail = BatchSummary & { rows: PriceRow[] };
const labels: Record<string, string> = { PROCUREMENT: "采购价", PACKAGING: "包装费", OTHER_COST: "其他成本", SALE_REFERENCE: "美元销售参考价" };

export function ProductPriceImportView({ id }: { id?: string }) {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(id ? `/api/product-price-imports/${id}` : "/api/product-price-imports", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error || "调价批次加载失败");
      else if (id) { setDetail(body.data); setCanPublish(Boolean(body.can_publish)); }
      else setBatches(body.data || []);
    } catch { setError("网络异常，调价批次加载失败"); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError("");
    const form = new FormData(); form.set("file", file);
    try {
      const response = await fetch("/api/product-price-imports", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "调价预览失败"); return; }
      window.location.href = `/products/prices/import/${body.id}`;
    } catch { setError("网络异常，调价预览失败"); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!id) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/product-price-imports/${id}/publish`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "整批调价失败；请重新上传预览"); return; }
      setResult(`已更新 ${body.data?.updated ?? 0} 条价格，跳过 ${body.data?.unchanged ?? 0} 条未变价格。`);
      void load();
    } catch { setError("网络异常，无法确认是否提交；请刷新批次状态后再操作"); }
    finally { setBusy(false); setConfirm(false); }
  }

  const rows = detail?.rows || [];
  const issueCount = rows.filter((row) => row.issues.length).length;
  const changedCount = rows.filter((row) => !row.issues.length && row.expected_amount !== row.amount).length;
  return <main className="p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">批量更新产品价格</h1><p className="mt-1 text-sm text-slate-500">仅按系统 SKU 匹配商品；预览旧价和新价后确认，商品资料及历史报价不会被覆盖。</p></div>
      <div className="flex gap-2"><Link href="/products/prices" className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-700">返回产品价格表</Link>{!id?<Link href="/api/product-price-imports/template" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-blue-700"><Download size={17}/>下载调价模板</Link>:null}</div>
    </header>
    {error?<p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
    {result?<p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{result}</p>:null}
    {!id?<>
      <form onSubmit={upload} className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">选择已核准的 .xlsx 调价文件</label>
        <div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex h-10 min-w-72 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 text-sm text-blue-800"><FileSpreadsheet size={18}/><span className="truncate">{file?.name || "选择文件（最多 500 行、2MB）"}</span><input type="file" accept=".xlsx" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)}/></label><button disabled={!file || busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{busy?<LoaderCircle size={17} className="animate-spin"/>:<UploadCloud size={17}/>}上传并预览</button></div>
        <p className="mt-3 text-xs leading-5 text-slate-500">每行填写系统 SKU、价格项目、新价格、起订量、生效日期和可追溯来源。空白价格不会被视为 0；无需更新的价格项目不要填写。供应商编号不是系统 SKU。</p>
      </form>
      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b px-4 py-3 font-semibold">最近调价批次</div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["文件", "行数", "状态", "创建时间", "操作"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={5} className="h-40 text-center">加载中…</td></tr>:batches.length?batches.map((batch) => <tr key={batch.id} className="border-t"><td className="px-4 py-3">{batch.file_name}</td><td className="px-4 py-3">{batch.row_count}</td><td className="px-4 py-3"><AppStatusBadge status={batch.status}>{batch.status === "PUBLISHED" ? "已发布" : "待核对"}</AppStatusBadge></td><td className="px-4 py-3 text-slate-500">{new Date(batch.created_at).toLocaleString("zh-CN")}</td><td className="px-4 py-3"><Link className="font-medium text-blue-700" href={`/products/prices/import/${batch.id}`}>查看预览</Link></td></tr>):<tr><td colSpan={5} className="h-40 text-center text-slate-400">暂无调价批次</td></tr>}</tbody></table></div></section>
    </>:<>
      {detail?<section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{detail.file_name}</h2><p className="mt-1 text-sm text-slate-500">{rows.length} 行 · {issueCount} 行需修正 · {changedCount} 行价格变化</p></div><div className="flex items-center gap-3"><AppStatusBadge status={detail.status}>{detail.status === "PUBLISHED" ? "已发布" : "待核对"}</AppStatusBadge>{canPublish && detail.status === "REVIEW"?<button disabled={busy || issueCount > 0} onClick={() => setConfirm(true)} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{changedCount ? "确认整批更新" : "确认核对完成"}</button>:null}</div></div>{issueCount?<p className="mt-3 text-sm text-amber-700">存在未匹配或冲突行，整批不会生效。请修正原文件后重新上传。</p>:null}</section>:null}
      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["原文件行", "系统 SKU / 商品", "价格项目", "原价", "新价", "起订量", "生效日期", "价格来源", "核对结果"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={9} className="h-40 text-center">加载中…</td></tr>:rows.map((row) => <tr key={row.source_row} className="border-t align-middle"><td className="px-4 py-3">{row.source_row}</td><td className="px-4 py-3"><b className="text-blue-700">{row.sku}</b><small className="block text-slate-500">{row.product_name || "未匹配"}</small></td><td className="px-4 py-3">{labels[row.price_kind] || row.price_kind}</td><td className="px-4 py-3">{row.expected_amount === null ? "暂无" : `${row.currency} ${row.expected_amount}`}</td><td className="px-4 py-3 font-semibold">{row.currency} {row.amount}</td><td className="px-4 py-3">{row.minimum_quantity}</td><td className="px-4 py-3">{row.effective_from}</td><td className="max-w-56 px-4 py-3 break-words">{row.source_note}</td><td className={`px-4 py-3 ${row.issues.length ? "text-rose-700" : "text-emerald-700"}`}>{row.issues.length ? row.issues.join("；") : row.expected_amount === row.amount ? "价格未变，跳过" : "可更新"}</td></tr>)}</tbody></table></div></section>
      <ConfirmDialog open={confirm} title="确认整批更新产品价格" description={`将一次性更新 ${changedCount} 条价格并保留历史版本。若原价在预览后发生变化，整批自动拒绝；此操作不修改商品资料。`} confirmLabel="确认更新" busy={busy} onCancel={() => !busy && setConfirm(false)} onConfirm={() => void publish()}/>
    </>}
  </main>;
}
