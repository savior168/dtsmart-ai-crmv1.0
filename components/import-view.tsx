"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, FileSpreadsheet, FolderOpen, Home, UploadCloud } from "lucide-react";
import { mapImportRow, parseImportFile, type ImportRow } from "@/lib/import-parser";

type MappedRow = ReturnType<typeof mapImportRow> & {
  preview_id: number;
  file_name: string;
  row_number: number;
};

type FailedRow = {
  id: number;
  file_name: string;
  row_number: number;
  reason: string;
};

type Stats = {
  total_count: number;
  success_count: number;
  duplicate_count: number;
  failed_count: number;
  errors: string[];
};

const pageSizeOptions = [10, 20, 50, 100];

function normalizeUrl(value?: string | null) {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isSupported(file: File) {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
}

function hasRequiredData(row: MappedRow) {
  return Boolean(row.company_name || row.country || row.phone || row.email || row.website || row.google_url);
}

function duplicateKey(row: MappedRow) {
  const name = String(row.company_name || "").trim().toLowerCase();
  const phone = String(row.phone || "").replace(/[^\d+]/g, "");
  const email = String(row.email || "").trim().toLowerCase();
  if (name && phone) return `name-phone:${name}|${phone}`;
  if (name && email) return `name-email:${name}|${email}`;
  return "";
}

function toApiRow({ preview_id, file_name, row_number, ...row }: MappedRow) {
  void preview_id;
  return { ...row, import_meta: { ...(row.import_meta || {}), file_name, row_number } };
}

function LinkCell({ value, label }: { value?: string | null; label: string }) {
  const url = normalizeUrl(value);
  if (!url) return <span className="text-slate-500">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-100">
      {label}
      <ExternalLink size={13} />
    </a>
  );
}

export function ImportView() {
  const [files, setFiles] = useState<File[]>([]);
  const [mapped, setMapped] = useState<MappedRow[]>([]);
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [showFailures, setShowFailures] = useState(false);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return mapped.slice(start, start + pageSize);
  }, [mapped, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(mapped.length / pageSize));

  async function choose(fileList?: FileList | null) {
    const selected = Array.from(fileList || []).filter(isSupported);
    if (!selected.length) {
      setError("请选择 Excel 或 CSV 文件，支持 .xlsx、.xls、.csv，也支持选择文件夹。");
      return;
    }

    setBusy(true);
    setError("");
    setStats(null);
    setFiles(selected);
    setPage(1);

    const nextRows: MappedRow[] = [];
    const nextFailures: FailedRow[] = [];
    const seen = new Set<string>();
    let previewId = 1;
    let failureId = 1;

    for (const file of selected) {
      try {
        const rows: ImportRow[] = await parseImportFile(file);
        rows.forEach((row, index) => {
          const item = { ...mapImportRow(row), preview_id: previewId, file_name: file.name, row_number: index + 2 };
          if (!hasRequiredData(item)) {
            nextFailures.push({
              id: failureId++,
              file_name: file.name,
              row_number: index + 2,
              reason: "名称、国家、完整号码、邮箱、商家官网网址、谷歌网址均为空，已自动剔除",
            });
            return;
          }

          const key = duplicateKey(item);
          if (key && seen.has(key)) {
            nextFailures.push({
              id: failureId++,
              file_name: file.name,
              row_number: index + 2,
              reason: "重复数据：名称+完整号码或名称+邮箱已存在，本次剔除",
            });
            return;
          }
          if (key) seen.add(key);
          nextRows.push({ ...item, preview_id: previewId++ });
        });
      } catch (event) {
        nextFailures.push({
          id: failureId++,
          file_name: file.name,
          row_number: 0,
          reason: event instanceof Error ? event.message : "文件解析失败",
        });
      }
    }

    setMapped(nextRows);
    setFailedRows(nextFailures);
    setBusy(false);
  }

  async function confirm() {
    if (!mapped.length) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: files.length === 1 ? files[0].name : `批量导入 ${files.length} 个文件`,
        rows: mapped.map(toApiRow),
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error || "导入失败");
      return;
    }
    setStats(body);
    if (body.failed_count > 0 || failedRows.length > 0) setShowFailures(true);
  }

  return (
    <main className="min-h-screen p-5 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap gap-2">
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-400/10 px-4 py-2.5 text-sm text-indigo-200 hover:bg-indigo-400/15">
            <Home size={16} />
            返回数据总览
          </Link>
          <Link href="/customers" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[.06]">
            <ArrowLeft size={16} />
            返回客户列表
          </Link>
        </div>

        <header>
          <p className="text-xs uppercase tracking-[.22em] text-indigo-400">Data Import</p>
          <h1 className="mt-2 text-3xl font-semibold">客户批量导入</h1>
          <p className="mt-2 text-sm text-slate-400">支持一次选择多个 Excel/CSV 文件，也支持选择文件夹，自动读取文件夹下所有 Excel 和 CSV 数据。</p>
        </header>

        <section className="mt-7 rounded-2xl border border-white/10 bg-white/[.035] p-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <label className="grid min-h-48 cursor-pointer place-items-center rounded-2xl border border-dashed border-indigo-400/30 bg-indigo-400/[.04] text-center hover:bg-indigo-400/[.07]">
              <div>
                <UploadCloud className="mx-auto text-indigo-300" size={36} />
                <p className="mt-4 font-medium">选择多个 Excel / CSV 文件</p>
                <p className="mt-2 text-sm text-slate-500">支持 .xlsx、.xls、.csv</p>
              </div>
              <input type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => choose(event.target.files)} />
            </label>
            <label className="grid min-h-48 cursor-pointer place-items-center rounded-2xl border border-dashed border-cyan-400/30 bg-cyan-400/[.04] text-center hover:bg-cyan-400/[.07]">
              <div>
                <FolderOpen className="mx-auto text-cyan-300" size={36} />
                <p className="mt-4 font-medium">选择文件夹导入</p>
                <p className="mt-2 text-sm text-slate-500">自动读取文件夹下所有 Excel/CSV 文件</p>
              </div>
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.csv"
                className="hidden"
                // @ts-expect-error webkitdirectory is supported by Chromium-based browsers.
                webkitdirectory="true"
                onChange={(event) => choose(event.target.files)}
              />
            </label>
          </div>

          <div className="mt-5 grid gap-3 text-sm text-slate-400 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 p-4">已选文件：<span className="text-white">{files.length}</span></div>
            <div className="rounded-xl border border-white/10 p-4">可导入：<span className="text-emerald-300">{mapped.length}</span></div>
            <button onClick={() => setShowFailures(true)} className="rounded-xl border border-white/10 p-4 text-left hover:bg-white/[.06]">
              失败/剔除：<span className="text-rose-300">{failedRows.length + (stats?.failed_count || 0)}</span>
            </button>
          </div>

          {error && <p className="mt-4 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.035] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">导入预览</h2>
              <p className="mt-1 text-sm text-slate-500">默认每页 50 条，可切换 10 / 20 / 50 / 100 条。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              >
                {pageSizeOptions.map((size) => <option key={size} value={size}>{size} 条/页</option>)}
              </select>
              <button disabled={busy || !mapped.length} onClick={confirm} className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium disabled:opacity-50">
                {busy ? "处理中..." : `确认导入 ${mapped.length} 条`}
              </button>
            </div>
          </div>

          {stats && (
            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[.05] p-4 text-sm text-emerald-200">
              <CheckCircle2 className="mr-2 inline" size={18} />
              导入成功 {stats.success_count} 条，重复 {stats.duplicate_count} 条，失败 {stats.failed_count} 条。
              {(stats.failed_count > 0 || failedRows.length > 0) && <button onClick={() => setShowFailures(true)} className="ml-3 underline">查看失败原因</button>}
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1500px] text-left text-sm">
              <thead className="border-y border-white/10 text-xs text-slate-500">
                <tr>
                  {["ID", "名称", "国家", "完整号码", "邮箱", "商家官网网址", "谷歌网址", "分类", "商店名称", "商品图片", "来源文件"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.preview_id} className="border-b border-white/[.06]">
                    <td className="px-3 py-3 text-slate-400">{row.preview_id}</td>
                    <td className="px-3 py-3 font-medium">{row.company_name || <span className="text-rose-300">缺少名称</span>}</td>
                    <td className="px-3">{row.country || "—"}</td>
                    <td className="px-3">{row.phone || "—"}</td>
                    <td className="px-3">{row.email || "—"}</td>
                    <td className="px-3"><LinkCell value={row.website} label="打开官网" /></td>
                    <td className="px-3"><LinkCell value={row.google_url} label="打开Google" /></td>
                    <td className="px-3">{row.category || "—"}</td>
                    <td className="px-3">{String(row.import_meta?.store_name || "—")}</td>
                    <td className="px-3"><LinkCell value={String(row.import_meta?.product_image || "")} label="查看图片" /></td>
                    <td className="max-w-52 truncate px-3">{row.file_name}</td>
                  </tr>
                ))}
                {!pageRows.length && (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center text-slate-500">请先上传文件或文件夹。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
            <span>第 {page} / {totalPages} 页，共 {mapped.length} 条</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">下一页</button>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 p-5">
          <div className="flex gap-3">
            <FileSpreadsheet className="text-indigo-300" />
            <div>
              <h3 className="font-medium">必填与剔除规则</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">名称、国家、完整号码、邮箱、商家官网网址、谷歌网址如果全部为空，则自动剔除不导入。重复数据按“名称+完整号码”或“名称+邮箱”判断，只保留第一条。</p>
            </div>
          </div>
        </section>
      </div>

      {showFailures && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div className="flex items-center gap-2">
                <AlertCircle className="text-rose-300" size={20} />
                <h3 className="font-semibold">失败/剔除原因</h3>
              </div>
              <button onClick={() => setShowFailures(false)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/[.06]">关闭</button>
            </div>
            <div className="max-h-[60vh] overflow-auto p-5">
              {[...failedRows, ...(stats?.errors || []).map((reason, index) => ({ id: failedRows.length + index + 1, file_name: "数据库导入", row_number: 0, reason }))].length ? (
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-y border-white/10 text-xs text-slate-500">
                    <tr><th className="px-3 py-3">ID</th><th className="px-3">文件</th><th className="px-3">行号</th><th className="px-3">原因</th></tr>
                  </thead>
                  <tbody>
                    {[...failedRows, ...(stats?.errors || []).map((reason, index) => ({ id: failedRows.length + index + 1, file_name: "数据库导入", row_number: 0, reason }))].map((item) => (
                      <tr key={`${item.file_name}-${item.id}-${item.reason}`} className="border-b border-white/[.06]">
                        <td className="px-3 py-3">{item.id}</td>
                        <td className="px-3">{item.file_name}</td>
                        <td className="px-3">{item.row_number || "—"}</td>
                        <td className="px-3 text-rose-200">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-10 text-center text-slate-400">暂无失败数据。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
