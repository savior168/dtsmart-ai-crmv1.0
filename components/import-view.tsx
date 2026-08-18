"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download,
  ExternalLink, FileSpreadsheet, FolderOpen, Info, RefreshCw, UploadCloud, Search, Trash2, Plus, ShieldAlert,
} from "lucide-react";
import { mapImportRow, parseImportFile, type ImportRow } from "@/lib/import-parser";

type MappedRow = ReturnType<typeof mapImportRow> & { preview_id: number; file_name: string; row_number: number };
type FailedRow = { id: number; file_name: string; row_number: number; reason: string };
type Stats = { total_count: number; success_count: number; duplicate_count: number; conflict_count?: number; failed_count: number; errors: string[] };
type ImportTask = { id: string; filename: string; total_count: number; success_count: number; duplicate_count: number; failed_count: number; created_at: string };
type FileStat = { filename: string; total: number; success: number; duplicate: number; conflict: number; failed: number };
const pageSizes = [10, 20, 50, 100];
const directoryProps = { webkitdirectory: "true", directory: "true" } as Record<string, string>;

function normalizeUrl(value?: string | null) {
  const text = String(value || "").trim();
  if (!text || (!/^https?:\/\//i.test(text) && !/^[\w.-]+\.[a-z]{2,}/i.test(text))) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
function LinkCell({ value }: { value?: string | null }) {
  const href = normalizeUrl(value);
  return href ? <a href={href} target="_blank" rel="noreferrer" title={value || ""} className="inline-flex max-w-[220px] items-center gap-1 break-all text-blue-600 hover:text-blue-800 hover:underline">{value}<ExternalLink size={13} /></a> : <span className="text-slate-400">-</span>;
}
function identityKeys(row: MappedRow) {
  const name = String(row.company_name || "").trim().toLowerCase();
  const phone = String(row.phone || "").replace(/[\s\-()]/g, "");
  const email = String(row.email || "").trim().toLowerCase();
  return [name && phone ? `${name}|phone:${phone}` : "", name && email ? `${name}|email:${email}` : ""].filter(Boolean);
}

function Metric({ label, value, sub, tone, icon }: { label: string; value: number; sub?: string; tone: string; icon: React.ReactNode }) {
  return <div className="min-h-[108px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>{sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}</div><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</div></div></div>;
}

export function ImportView() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<MappedRow[]>([]);
  const [failed, setFailed] = useState<FailedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showFailures, setShowFailures] = useState(false);
  const [recentTasks, setRecentTasks] = useState<ImportTask[]>([]);
  const [taskRefreshing, setTaskRefreshing] = useState(false);
  const [detailFilter, setDetailFilter] = useState<"all" | "success" | "duplicate" | "conflict" | "failed">("all");
  const [detailSearch, setDetailSearch] = useState("");
  const [jumpPage, setJumpPage] = useState("");
  const [hasImportTask, setHasImportTask] = useState(false);

  async function refreshTasks() {
    setTaskRefreshing(true);
    try {
      const response = await fetch("/api/import", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(body.tasks)) setRecentTasks(body.tasks);
    } finally { setTaskRefreshing(false); }
  }
  useEffect(() => {
    setHasImportTask(window.sessionStorage.getItem("dtsmart-import-started") === "1");
    void refreshTasks();
    const timer = window.setInterval(() => void refreshTasks(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredRows = useMemo(() => {
    const needle = detailSearch.trim().toLowerCase();
    if (detailFilter === "duplicate" || detailFilter === "conflict" || detailFilter === "failed") return [];
    return rows.filter((row) => !needle || [row.company_name, row.contact_name, row.phone, row.email, row.website, row.google_url].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [rows, detailSearch, detailFilter]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = useMemo(() => filteredRows.slice((page - 1) * pageSize, page * pageSize), [filteredRows, page, pageSize]);
  const duplicateCount = failed.filter((item) => item.reason.includes("重复")).length;
  const invalidCount = failed.length - duplicateCount;
  const step = stats ? 3 : rows.length ? 2 : files.length ? 1 : 1;
  const fileStats = useMemo<FileStat[]>(() => files.map((file) => {
    const filename = file.name;
    const valid = rows.filter((row) => row.file_name === filename).length;
    const fileFailures = failed.filter((item) => item.file_name === filename);
    const duplicate = fileFailures.filter((item) => item.reason.includes("重复")).length;
    const failedCount = fileFailures.length - duplicate;
    return { filename, total: valid + fileFailures.length, success: stats ? Math.max(0, valid - Math.round((stats.failed_count || 0) * (valid / Math.max(1, rows.length)))) : 0, duplicate: duplicate + (stats ? Math.round((stats.duplicate_count || 0) * (valid / Math.max(1, rows.length))) : 0), conflict: stats ? Math.round((stats.conflict_count || 0) * (valid / Math.max(1, rows.length))) : 0, failed: failedCount + (stats ? Math.round((stats.failed_count || 0) * (valid / Math.max(1, rows.length))) : 0) };
  }), [files, rows, failed, stats]);

  function downloadReport() {
    const headers = ["结果", "文件", "行号", "客户名称", "国家/地区", "完整号码", "邮箱", "官网网址", "Google地图网址", "原因"];
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const successLines = rows.map((row) => ["成功导入", row.file_name, row.row_number, row.company_name, row.country, row.phone, row.email, row.website, row.google_url, ""]);
    const failedLines = failed.map((item) => ["导入失败", item.file_name, item.row_number, "", "", "", "", "", "", item.reason]);
    const csv = [headers, ...successLines, ...failedLines].map((line) => line.map(quote).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); link.download = "导入明细报告.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  function removeFile(fileName: string) {
    const remaining = files.filter((file) => file.name !== fileName);
    setFiles(remaining);
    setRows((current) => current.filter((row) => row.file_name !== fileName));
    setFailed((current) => current.filter((item) => item.file_name !== fileName));
    setStats(null); setPage(1);
  }

  async function chooseFileList(list?: FileList | null) {
    const selected = Array.from(new Map(Array.from(list || []).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name)).map((file) => [`${file.name}|${file.size}|${file.lastModified}`, file])).values());
    if (!selected.length) { setError("请选择 .xlsx、.xls 或 .csv 文件"); return; }
    setBusy(true); setError(""); setStats(null); setDetailFilter("all"); setDetailSearch(""); setFiles(selected); setPage(1);
    const next: MappedRow[] = []; const bad: FailedRow[] = []; const seen = new Set<string>(); let id = 1; let badId = 1;
    for (const file of selected) {
      try {
        const parsed: ImportRow[] = await parseImportFile(file);
        parsed.forEach((raw, index) => {
          const item = { ...mapImportRow(raw), preview_id: id, file_name: file.name, row_number: index + 2 } as MappedRow;
          const hasContact = [item.phone, item.email, item.website, item.google_url].some(Boolean);
          if (!item.company_name || !item.country || !hasContact) {
            bad.push({ id: badId++, file_name: file.name, row_number: index + 2, reason: "缺少客户名称、国家或有效联系方式，已跳过" }); return;
          }
          const keys = identityKeys(item);
          if (keys.some((key) => seen.has(key))) { bad.push({ id: badId++, file_name: file.name, row_number: index + 2, reason: "名称+电话或名称+邮箱重复，仅保留最先导入的数据" }); return; }
          keys.forEach((key) => seen.add(key)); next.push(item); id += 1;
        });
      } catch (reason) { bad.push({ id: badId++, file_name: file.name, row_number: 0, reason: reason instanceof Error ? reason.message : "文件解析失败" }); }
    }
    setRows(next); setFailed(bad); setBusy(false);
  }

  async function confirmImport() {
    if (!rows.length) return;
    setBusy(true); setError("");
    setHasImportTask(true); window.sessionStorage.setItem("dtsmart-import-started", "1");
    try {
      const bodyRows = rows.map(({ preview_id, file_name, row_number, ...item }) => { void preview_id; return { ...item, import_meta: { ...(item.import_meta || {}), file_name, row_number } }; });
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: files.length === 1 ? files[0].name : `批量导入${files.length}个文件`, rows: bodyRows }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "导入失败，请稍后重试");
      setStats(body); setShowFailures(Boolean(body.failed_count || failed.length));
      await refreshTasks();
      window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { type: "success", message: `导入完成：成功 ${body.success_count} 条，失败 ${body.failed_count} 条` } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败，请稍后重试"); }
    finally { setBusy(false); }
  }

  function downloadTemplate() {
    const headers = ["名称", "国家", "区号", "完整号码", "邮箱", "标签", "分类", "商店名称", "商店地址", "商店类型", "商店状态", "商家官网网址", "谷歌网址", "商店分数", "商品图片", "搜索关键词", "创建时间"];
    const countries = [{ name: "美国", code: "+1", domain: "us" }, { name: "英国", code: "+44", domain: "uk" }, { name: "德国", code: "+49", domain: "de" }, { name: "法国", code: "+33", domain: "fr" }, { name: "西班牙", code: "+34", domain: "es" }, { name: "意大利", code: "+39", domain: "it" }, { name: "荷兰", code: "+31", domain: "nl" }, { name: "澳大利亚", code: "+61", domain: "au" }, { name: "加拿大", code: "+1", domain: "ca" }, { name: "印度", code: "+91", domain: "in" }, { name: "阿联酋", code: "+971", domain: "ae" }, { name: "新加坡", code: "+65", domain: "sg" }, { name: "巴西", code: "+55", domain: "br" }, { name: "墨西哥", code: "+52", domain: "mx" }, { name: "日本", code: "+81", domain: "jp" }];
    const industries = ["手机维修店", "手机配件批发商", "手机配件零售商", "手机进口商", "电脑维修店", "电脑配件批发商", "消费电子批发", "IT设备经销商", "电商零售", "通讯设备进口商"];
    const csv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sampleRows = Array.from({ length: 500 }, (_, index) => { const country = countries[index % countries.length]; const industry = industries[index % industries.length]; const slug = `trade-${String(index + 1).padStart(3, "0")}-${country.domain}`; const phone = `${country.code} ${String(200000000 + index * 7919).slice(0, 10)}`; return [
      `${country.name}${industry}示例 ${index + 1}`, country.name, country.code, phone, `sales${index + 1}@${slug}.example.com`, `手机配件, ${industry}`, industry, `${country.name} ${industry} Store`, `${index + 1} Commerce Street`, industry, "营业中", `https://${slug}.example.com`, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${country.name} ${industry} ${index + 1}`)}`, String(60 + index % 40), `https://images.example.com/products/${slug}.jpg`, `${industry}, mobile accessories, wholesale`, "2026-08-15"].map(csv).join(","); });
    const blob = new Blob(["\ufeff" + headers.map(csv).join(",") + "\n" + sampleRows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "客户导入模板.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  return <main className="min-h-screen bg-[#f5f8fc] px-4 py-5 lg:px-8 lg:py-7"><div className="mx-auto max-w-[1600px]">
    <div className="mb-5 flex items-center justify-between"><h1 className="text-3xl font-bold tracking-tight text-slate-900">数据导入</h1><div className="text-sm text-slate-500">支持 Excel、CSV 和文件夹批量导入</div></div>
    <div className="mb-5 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"><div className="flex items-center"><span className={`grid h-8 w-8 place-items-center rounded-full ${step >= 1 ? "bg-blue-600 text-white" : "bg-slate-100"}`}>1</span><b className="ml-2 text-sm">选择文件</b></div><span className="h-px w-16 bg-blue-200 lg:w-44" /><div className="flex items-center"><span className={`grid h-8 w-8 place-items-center rounded-full ${step >= 2 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>2</span><b className="ml-2 text-sm">导入处理</b></div><span className="h-px w-16 bg-blue-200 lg:w-44" /><div className="flex items-center"><span className={`grid h-8 w-8 place-items-center rounded-full ${step >= 3 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>3</span><b className="ml-2 text-sm">导入结果</b></div></div>
    <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><h2 className="text-lg font-semibold">导入文件</h2></div><div className="flex justify-end"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"><Plus size={16} /> {files.length ? "重新添加文件/文件夹" : "添加文件/文件夹"}<input type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" {...directoryProps} onChange={(event) => void chooseFileList(event.target.files)} /></label></div></div><div className="mt-4 max-h-[248px] space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">{files.length ? files.map((file) => <div key={`${file.name}-${file.size}`} className="flex items-center gap-3 rounded-md bg-white px-3 py-2 text-sm"><FileSpreadsheet size={18} className="text-emerald-600" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-slate-500">{(file.size / 1024).toFixed(0)} KB</span><span className="text-emerald-600">{busy ? "处理中" : "已处理"}</span><button type="button" onClick={() => removeFile(file.name)} className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600" title="移除文件"><Trash2 size={15} /></button></div>) : <div className="py-9 text-center text-sm text-slate-400"><UploadCloud className="mx-auto mb-2 text-blue-500" />请选择一个或多个 Excel/CSV 文件，也可直接选择文件夹</div>}</div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">单文件 ≤ 5 MB · 所有文件合计 ≤ 30 MB<br />支持一次选择多个文件或文件夹，系统自动读取 Excel / CSV。</p><button type="button" disabled={!files.length || busy} onClick={() => { setFiles([]); setRows([]); setFailed([]); setStats(null); setPage(1); }} className="shrink-0 rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40">一键清空已选文件</button></div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">导入模板与说明</h2><Info size={18} className="text-slate-400" /></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"><Download size={16} /> 下载导入模板</button><button onClick={() => setError("字段说明：名称、国家及电话/邮箱/官网/Google 地图至少一项联系方式") } className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><Info size={16} /> 查看字段说明</button></div><ul className="mt-5 space-y-3 text-sm text-slate-600"><li>• 必填：客户名称、国家/地区</li><li>• 至少提供一种联系方式：电话、邮箱、官网或 Google Maps</li><li>• 支持多文件和文件夹批量导入，系统自动合并预览</li><li>• 名称+完整电话或名称+邮箱相同的数据只保留最先导入的一条</li></ul><div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"><AlertTriangle className="mr-2 inline" size={16} /> 建议使用模板，可减少字段识别和格式错误。</div></div></section>
    <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><div className="min-h-[108px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="text-sm text-slate-500">本次导入概览</div><div className="mt-2 text-sm text-slate-700">已读取 {files.length} 个文件，共 <span className="font-semibold text-slate-900">{(rows.length + failed.length).toLocaleString()}</span> 条数据</div></div><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><FileSpreadsheet size={20} /></div></div></div><Metric label="成功导入" value={stats?.success_count ?? 0} sub="点击查看明细" tone="bg-emerald-50 text-emerald-600" icon={<CheckCircle2 size={20} />} /><Metric label="重复客户" value={duplicateCount + (stats?.duplicate_count || 0)} sub="点击查看明细" tone="bg-amber-50 text-amber-600" icon={<RefreshCw size={20} />} /><Metric label="冲突客户" value={stats?.conflict_count || 0} sub="点击查看明细" tone="bg-orange-50 text-orange-600" icon={<ShieldAlert size={20} />} /><Metric label="导入失败" value={invalidCount + (stats?.failed_count || 0)} sub="点击查看失败原因" tone="bg-rose-50 text-rose-600" icon={<AlertTriangle size={20} />} /></section>
    {error && <div className="mt-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><AlertTriangle size={17} /> {error}<button onClick={() => { setError(""); void refreshTasks(); }} className="ml-auto font-medium underline">重新加载</button></div>}
    {hasImportTask && recentTasks.length > 0 && <section className="mt-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">导入任务进度</h2><p className="mt-1 text-xs text-slate-500">切换页面后任务仍会保留，返回本页可继续查看真实统计</p></div><button onClick={() => void refreshTasks()} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs text-blue-700">{taskRefreshing ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}刷新</button></div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{recentTasks.slice(0, 4).map((task) => { const processed = task.success_count + task.duplicate_count + task.failed_count; const progress = task.total_count ? Math.min(100, Math.round(processed / task.total_count * 100)) : 0; return <div key={task.id} className="rounded-lg border border-blue-100 bg-white p-3"><div className="flex items-center justify-between gap-2 text-xs"><span className="max-w-[180px] truncate font-medium text-slate-700" title={task.filename}>{task.filename}</span><span className="text-emerald-600">{progress >= 100 ? "已完成" : `${progress}%`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-2 text-xs text-slate-500">成功 {task.success_count} · 重复 {task.duplicate_count} · 失败 {task.failed_count}</div></div>; })}</div><div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-blue-100 bg-white p-2">{stats && fileStats.length > 1 && fileStats.map((item) => <div key={item.filename} className="flex items-center gap-3 border-b border-slate-100 px-2 py-2 text-xs last:border-0"><span className="min-w-0 flex-1 truncate" title={item.filename}>{item.filename}</span><span className="text-emerald-600">成功 {item.success}</span><span className="text-amber-600">重复 {item.duplicate}</span><span className="text-orange-600">冲突 {item.conflict}</span><span className="text-rose-600">失败 {item.failed}</span></div>)}</div></section>}<section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5"><div><h2 className="text-lg font-semibold">{stats ? "本次导入明细" : "导入数据预览"}</h2><p className="mt-1 text-sm text-slate-500">{stats ? `成功 ${stats.success_count} 条，重复 ${stats.duplicate_count} 条，冲突 ${stats.conflict_count || 0} 条，失败 ${stats.failed_count} 条` : `共 ${rows.length} 条可导入数据，重复与缺失数据可在筛选中查看`}</p></div><div className="flex gap-2"><button onClick={() => setShowFailures(true)} disabled={!failed.length && !stats?.failed_count} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 disabled:opacity-40">查看失败原因</button><button disabled={busy || !rows.length} onClick={() => void confirmImport()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><RefreshCw size={16} className="animate-spin" /> 正在处理...</> : <><CheckCircle2 size={16} /> 确认导入 {rows.length} 条</>}</button></div></div>{stats && <div className="m-4 flex flex-wrap items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><CheckCircle2 size={18} /> 导入完成：成功 {stats.success_count} 条，重复 {stats.duplicate_count} 条，失败 {stats.failed_count} 条 {stats.failed_count > 0 && <button onClick={() => setShowFailures(true)} className="font-medium underline">查看失败原因</button>}</div>}<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-slate-800">按最终处理结果筛选</span>{[["all","全部"],["success","成功导入"],["duplicate","重复客户"],["conflict","冲突客户"],["failed","导入失败"]].map(([key,label]) => <button type="button" key={key} onClick={() => { setDetailFilter(key as typeof detailFilter); setPage(1); if (key === "duplicate" || key === "conflict" || key === "failed") setShowFailures(true); }} className={`rounded-md border px-3 py-1.5 text-xs ${detailFilter === key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}>{label}</button>)}</div><div className="flex items-center gap-2"><label className="relative"><Search size={14} className="absolute left-3 top-2.5 text-slate-400" /><input value={detailSearch} onChange={(event) => { setDetailSearch(event.target.value); setPage(1); }} placeholder="搜索客户名称、电话或邮箱" className="w-64 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500" /></label><button type="button" onClick={downloadReport} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs text-blue-700 hover:bg-blue-50"><Download size={14} />下载完整导入报告</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1550px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr>{["客户名称", "国家/地区", "完整号码", "邮箱", "官网网址", "Google 地图网址", "分类", "商店名称", "商品图片", "来源文件"].map((head) => <th key={head} className="whitespace-nowrap px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody>{visibleRows.map((row) => <tr key={row.preview_id} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="max-w-52 px-4 py-3 font-medium text-slate-800">{row.company_name || "-"}</td><td className="px-4 py-3">{row.country || "-"}</td><td className="px-4 py-3 whitespace-nowrap">{row.phone || "-"}</td><td className="max-w-56 break-all px-4 py-3">{row.email || "-"}</td><td className="px-4 py-3"><LinkCell value={row.website} /></td><td className="px-4 py-3"><LinkCell value={row.google_url} /></td><td className="max-w-48 break-words px-4 py-3">{row.category || "-"}</td><td className="px-4 py-3">{String(row.import_meta?.store_name || "-")}</td><td className="px-4 py-3"><LinkCell value={String(row.import_meta?.product_image || "")} /></td><td className="max-w-48 truncate px-4 py-3 text-slate-500" title={row.file_name}>{row.file_name}</td></tr>)}</tbody></table>{!visibleRows.length && <div className="p-16 text-center text-slate-400">{detailFilter === "all" && !rows.length ? "请先上传 Excel 或 CSV 文件" : "没有匹配的导入记录"}</div>}</div><footer className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-200 p-4 text-sm text-slate-600"><span className="mr-2">共 {filteredRows.length.toLocaleString()} 条</span><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 disabled:opacity-40">上一页</button>{Array.from({ length: Math.min(pages, 3) }, (_, index) => index + 1).map((number) => <button key={number} onClick={() => setPage(number)} className={`min-w-9 rounded-lg border px-3 py-2 ${page === number ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white hover:bg-blue-50"}`}>{number}</button>)}{pages > 4 && <><span className="px-1 text-slate-400">...</span><button onClick={() => setPage(pages)} className={`min-w-9 rounded-lg border px-3 py-2 ${page === pages ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white hover:bg-blue-50"}`}>{pages}</button></>}<button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 disabled:opacity-40">下一页</button><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2">{pageSizes.map((size) => <option key={size} value={size}>{size} 条/页</option>)}</select><label className="ml-2 inline-flex items-center gap-2">跳至<input value={jumpPage} onChange={(event) => setJumpPage(event.target.value.replace(/\\D/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") { const target = Math.min(pages, Math.max(1, Number(jumpPage) || 1)); setPage(target); setJumpPage(""); } }} className="w-16 rounded-lg border border-slate-200 px-2 py-2" inputMode="numeric" />页</label></footer></section>
    {showFailures && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4"><section className="max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-5"><div><h3 className="text-lg font-semibold">失败与重复明细</h3><p className="mt-1 text-sm text-slate-500">失败数据不会写入客户表，可修正后重新导入。</p></div><button onClick={() => setShowFailures(false)} className="rounded-lg border px-3 py-2 text-sm">关闭</button></div><div className="max-h-[60vh] overflow-auto p-5">{failed.length ? <table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="pb-3">文件</th><th className="pb-3">行号</th><th className="pb-3">原因</th></tr></thead><tbody>{failed.map((item) => <tr key={item.id} className="border-t"><td className="py-3">{item.file_name}</td><td>{item.row_number || "-"}</td><td className="text-rose-600">{item.reason}</td></tr>)}</tbody></table> : <div className="py-12 text-center text-slate-400">暂无失败数据</div>}</div></section></div>}
  </div></main>;
}
