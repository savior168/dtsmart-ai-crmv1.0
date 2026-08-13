"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Home, UploadCloud } from "lucide-react";
import { mapImportRow, parseImportFile, type ImportRow } from "@/lib/import-parser";

type Stats = { total_count: number; success_count: number; duplicate_count: number; failed_count: number; errors: string[] };

export function ImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<ImportRow[]>([]);
  const [mapped, setMapped] = useState<ReturnType<typeof mapImportRow>[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  async function choose(f?: File) {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return setError("仅支持 xlsx 或 csv 文件");
    setBusy(true);
    setError("");
    setStats(null);
    try {
      const rows = await parseImportFile(f);
      setFile(f);
      setRaw(rows);
      setMapped(rows.map(mapImportRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!file || !mapped.length) return;
    setBusy(true);
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, rows: mapped }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error || "导入失败");
    setStats(body);
  }

  return (
    <main className="min-h-screen p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
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
          <h1 className="mt-2 text-3xl font-semibold">Excel 客户导入</h1>
          <p className="mt-2 text-sm text-slate-400">读取所有工作表，按名称+电话或名称+邮箱去重后批量保存。</p>
        </header>

        {!stats && (
          <section className="mt-7 rounded-2xl border border-white/10 bg-white/[.035] p-6">
            <label className="grid min-h-52 cursor-pointer place-items-center rounded-2xl border border-dashed border-indigo-400/30 bg-indigo-400/[.04] text-center hover:bg-indigo-400/[.07]">
              <div>
                <UploadCloud className="mx-auto text-indigo-300" size={36} />
                <p className="mt-4 font-medium">选择 XLSX 或 CSV 文件</p>
                <p className="mt-2 text-sm text-slate-500">支持中文表头，XLSX 会读取所有工作表并自动去重。</p>
                {file && <p className="mt-3 text-sm text-indigo-300">{file.name} · {raw.length} 条可导入数据</p>}
              </div>
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(event) => choose(event.target.files?.[0])} />
            </label>
            {error && <p className="mt-4 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
            {mapped.length > 0 && (
              <>
                <div className="mt-6 flex items-center justify-between">
                  <h2 className="font-semibold">数据预览（前 20 行）</h2>
                  <button disabled={busy} onClick={confirm} className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium disabled:opacity-50">
                    {busy ? "正在导入..." : `确认导入 ${mapped.length} 条`}
                  </button>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="border-y border-white/10 text-xs text-slate-500">
                      <tr>{["名称", "国家", "电话", "邮箱", "分类", "标签", "官网", "评分"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
                    </thead>
                    <tbody>
                      {mapped.slice(0, 20).map((row, index) => (
                        <tr key={index} className="border-b border-white/[.06]">
                          <td className="px-3 py-3 font-medium">{row.company_name || <span className="text-rose-300">缺少名称</span>}</td>
                          <td className="px-3">{row.country || "—"}</td>
                          <td className="px-3">{row.phone || "—"}</td>
                          <td className="px-3">{row.email || "—"}</td>
                          <td className="px-3">{row.category || "—"}</td>
                          <td className="px-3">{row.tags.join("、") || "—"}</td>
                          <td className="max-w-40 truncate px-3">{row.website || "—"}</td>
                          <td className="px-3">{row.ai_score ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {stats && (
          <section className="mt-7 rounded-2xl border border-emerald-400/20 bg-emerald-400/[.05] p-8 text-center">
            <CheckCircle2 className="mx-auto text-emerald-300" size={44} />
            <h2 className="mt-4 text-2xl font-semibold">导入完成</h2>
            <div className="mx-auto mt-7 grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4">
              {[["总数量", stats.total_count], ["成功", stats.success_count], ["重复", stats.duplicate_count], ["失败", stats.failed_count]].map(([key, value]) => (
                <div key={String(key)} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <strong className="text-2xl">{value}</strong>
                  <p className="mt-1 text-xs text-slate-400">{key}</p>
                </div>
              ))}
            </div>
            {stats.errors?.length > 0 && <div className="mx-auto mt-5 max-w-3xl rounded-xl bg-rose-400/10 p-4 text-left text-sm text-rose-300">{stats.errors.slice(0, 10).map((item) => <p key={item}>{item}</p>)}</div>}
            <div className="mt-7 flex justify-center gap-3">
              <button onClick={() => { setStats(null); setRaw([]); setMapped([]); setFile(null); }} className="rounded-xl border border-white/10 px-5 py-2.5">继续导入</button>
              <Link href="/customers" className="rounded-xl bg-indigo-500 px-5 py-2.5">查看客户</Link>
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-white/10 p-5">
          <div className="flex gap-3">
            <FileSpreadsheet className="text-indigo-300" />
            <div>
              <h3 className="font-medium">支持字段</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">名称、国家、区号、完整号码、邮箱、标签、分类、商店名称、商店地址、商店类型、商店状态、商家官网网址、谷歌网址、商店分数、商品图片、搜索关键词、创建时间。</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
