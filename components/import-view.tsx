"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Info,
  RefreshCw,
  UploadCloud,
  Search,
  Trash2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import {
  mapImportRow,
  parseImportFile,
  type ImportRow,
} from "@/lib/import-parser";
import { downloadWorkbook } from "@/lib/xlsx-export";
import { customerIdentityKeys } from "@/lib/import-dedupe";
import { CountryLabel } from "@/components/country-label";

type MappedRow = ReturnType<typeof mapImportRow> & {
  preview_id: number;
  file_name: string;
  row_number: number;
  import_result?: "success" | "duplicate" | "error" | "conflict" | "failed";
  result_reason?: string;
  conflict_owner_name?: string;
};

function ImportCountry({ value }: { value?: string | null }) { return <CountryLabel value={value} />; }
type FailedRow = {
  id: number;
  file_name: string;
  row_number: number;
  reason: string;
  kind: "duplicate" | "error" | "failure";
  row?: MappedRow;
};
type Stats = {
  total_count: number;
  importable_count: number;
  success_count: number;
  duplicate_count: number;
  conflict_count?: number;
  error_count: number;
  failed_count: number;
  errors: string[];
};
type PreviewStats = { success_count: number; conflict_count: number };
const pageSizes = [10, 20, 30, 50, 100, 200, 300, 500];
const directoryProps = { webkitdirectory: "" } as Record<string, string>;
const LAST_IMPORT_RESULT_KEY = "dtsmart-last-import-result";
const IMPORT_TASK_KEY = "dtsmart-import-task";
const IMPORT_TASK_EVENT = "dtsmart-task-update";

type ImportSessionSnapshot = {
  files: File[];
  rows: MappedRow[];
  failed: FailedRow[];
  stats: Stats | null;
  previewStats: PreviewStats;
};

let importSessionSnapshot: ImportSessionSnapshot = {
  files: [],
  rows: [],
  failed: [],
  stats: null,
  previewStats: { success_count: 0, conflict_count: 0 },
};

type PersistedImportTask = {
  status?: "running" | "completed" | "failed";
  message?: string;
};

function readImportTask(): PersistedImportTask | null {
  try {
    return JSON.parse(window.localStorage.getItem(IMPORT_TASK_KEY) || "null");
  } catch {
    return null;
  }
}

function fileKey(file: File) {
  return `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;
}

function fileSelectionKey(file: File) {
  // File/folder selection may expose the same file through two browser entries
  // with different virtual paths. The selected-file list is intentionally
  // unique by filename, matching what the user sees in the UI.
  return file.name.trim().toLowerCase();
}

function dedupeSelectedFiles(selected: File[]) {
  const unique = new Map<string, File>();
  for (const file of selected) {
    if (file.size <= 0 || !/\.(xlsx|xls|csv)$/i.test(file.name)) continue;
    const key = fileSelectionKey(file);
    const existing = unique.get(key);
    // Some Windows folder pickers return a tiny/empty shadow entry beside the
    // real file. Keep the real (larger) file for the same logical path.
    if (!existing || file.size > existing.size) unique.set(key, file);
  }
  return Array.from(unique.values());
}

async function isReadableImportFile(file: File) {
  if (file.size <= 0 || !/\.(xlsx|xls|csv)$/i.test(file.name)) return false;
  try {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv")) {
      return (await file.slice(0, 4096).text()).replace(/^\uFEFF/, "").trim().length > 0;
    }
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isZip = header[0] === 0x50 && header[1] === 0x4b;
    const isOle = header.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
      .every((byte, index) => header[index] === byte);
    return lower.endsWith(".xlsx") ? isZip : isOle || isZip;
  } catch {
    return false;
  }
}

async function sanitizeSelectedFiles(selected: File[]) {
  const validated = await Promise.all(
    selected.map(async (file) => ({ file, valid: await isReadableImportFile(file) })),
  );
  return dedupeSelectedFiles(validated.filter((item) => item.valid).map((item) => item.file));
}

function normalizeUrl(value?: string | null) {
  const text = String(value || "").trim();
  if (
    !text ||
    (!/^https?:\/\//i.test(text) && !/^[\w.-]+\.[a-z]{2,}/i.test(text))
  )
    return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
function LinkCell({ value }: { value?: string | null }) {
  const href = normalizeUrl(value);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={value || ""}
      className="inline-flex max-w-[190px] items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
    >
      <span className="truncate">{value}</span>
      <ExternalLink size={13} className="shrink-0" />
    </a>
  ) : (
    <span className="text-slate-400">-</span>
  );
}
function identityKeys(row: MappedRow) {
  return customerIdentityKeys(row);
}

function Metric({
  label,
  value,
  tone,
  icon,
  href,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <div
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`}
      >
        {icon}
      </div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-bold text-slate-900">
          {value.toLocaleString()}
        </div>
      </div>
    </>
  );
  const className = "flex min-h-[84px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm";
  return href ? <Link href={href} className={`${className} transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md`}>{content}</Link> : <div className={className}>{content}</div>;
}

export function ImportView() {
  const [files, setFiles] = useState<File[]>(() => importSessionSnapshot.files);
  const [rows, setRows] = useState<MappedRow[]>(() => importSessionSnapshot.rows);
  const [failed, setFailed] = useState<FailedRow[]>(() => importSessionSnapshot.failed);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(() => importSessionSnapshot.stats);
  const [previewStats, setPreviewStats] = useState<PreviewStats>(
    () => importSessionSnapshot.previewStats,
  );
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showFailures, setShowFailures] = useState(false);
  const [showFieldGuide, setShowFieldGuide] = useState(false);
  const [detailFilter, setDetailFilter] = useState<
    "all" | "success" | "duplicate" | "conflict" | "failed"
  >("all");
  const [detailSearch, setDetailSearch] = useState("");
  const [jumpPage, setJumpPage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<ImportSessionSnapshot>(importSessionSnapshot);

  useEffect(() => {
    // A persisted number-only result has no matching preview rows after a full
    // reload and therefore produces stale, misleading counters. In-memory
    // state still survives ordinary menu navigation; a new browser session
    // starts a clean import and all result counters remain zero.
    if (!importSessionSnapshot.rows.length) {
      window.localStorage.removeItem(LAST_IMPORT_RESULT_KEY);
    }
  }, []);

  useEffect(() => {
    const snapshot = { files, rows, failed, stats, previewStats };
    sessionRef.current = snapshot;
    importSessionSnapshot = snapshot;
  }, [files, rows, failed, stats, previewStats]);

  useEffect(() => {
    const syncTaskState = () => {
      const task = readImportTask();
      setBusy(task?.status === "running");
      if (task?.status === "failed" && task.message) setError(task.message);
      if (task?.status !== "running" && importSessionSnapshot.stats) {
        const snapshot = importSessionSnapshot;
        setFiles(snapshot.files);
        setRows(snapshot.rows);
        setFailed(snapshot.failed);
        setStats(snapshot.stats);
        setPreviewStats(snapshot.previewStats);
        sessionRef.current = snapshot;
      }
    };
    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") syncTaskState();
    };

    syncTaskState();
    window.addEventListener(IMPORT_TASK_EVENT, syncTaskState);
    window.addEventListener("focus", syncTaskState);
    window.addEventListener("pageshow", syncTaskState);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      window.removeEventListener(IMPORT_TASK_EVENT, syncTaskState);
      window.removeEventListener("focus", syncTaskState);
      window.removeEventListener("pageshow", syncTaskState);
      document.removeEventListener("visibilitychange", syncWhenVisible);
      const task = readImportTask();
      if (sessionRef.current.stats && task?.status !== "running") {
        importSessionSnapshot = {
          files: [],
          rows: [],
          failed: [],
          stats: null,
          previewStats: { success_count: 0, conflict_count: 0 },
        };
        window.localStorage.removeItem(LAST_IMPORT_RESULT_KEY);
      }
    };
  }, []);

  const filteredRows = useMemo(() => {
    const needle = detailSearch.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!stats || detailFilter === "all" || row.import_result === detailFilter) &&
        (!needle ||
          [
            row.company_name,
            row.contact_name,
            row.phone,
            row.email,
            row.website,
            row.google_url,
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(needle),
          )),
    );
  }, [rows, detailSearch, detailFilter, stats]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize],
  );
  const duplicateCount = failed.filter((item) => item.kind === "duplicate").length;
  const invalidCount = failed.filter((item) => item.kind === "error").length;
  const displayImportable = stats?.importable_count ?? rows.length;
  // A parsed/validated preview is not a successful database import.
  const displaySuccess = stats?.success_count ?? 0;
  const displayDuplicate = stats?.duplicate_count ?? duplicateCount;
  // “失败导入” means rows that passed preview validation but failed while
  // writing to the system. Invalid source rows stay in the failure details,
  // but are not added again here, preventing double counting and ensuring the
  // failed-import count cannot exceed the importable row count.
  const displayFailure = stats ? stats.failed_count : 0;
  const displayConflict = stats?.conflict_count ?? 0;
  const step = stats ? 3 : rows.length ? 2 : files.length ? 1 : 1;

  function downloadReport() {
    if (!stats) return;
    type ReportEntry = { row: MappedRow; status: "success" | "failed" | "duplicate" | "conflict"; reason: string };
    const entries: ReportEntry[] = [];
    rows.forEach((row) => {
      const status = row.import_result;
      if (status === "success" || status === "duplicate" || status === "conflict") entries.push({ row, status, reason: row.result_reason || "" });
      if (status === "failed" || status === "error") entries.push({ row, status: "failed", reason: row.result_reason || "导入失败" });
    });
    const existing = new Set(entries.map((item) => `${item.row.file_name.toLowerCase()}|${item.row.row_number}`));
    failed.forEach((item) => {
      if (!item.row || item.kind === "duplicate") return;
      const key = `${item.file_name.toLowerCase()}|${item.row_number}`;
      if (!existing.has(key)) entries.push({ row: item.row, status: "failed", reason: item.reason });
    });
    const rawHeaders: string[] = [];
    entries.forEach(({ row }) => {
      const raw = row.import_meta?.raw_data;
      if (raw && typeof raw === "object") Object.keys(raw).forEach((key) => { if (!rawHeaders.includes(key)) rawHeaders.push(key); });
    });
    const headers = ["文件", "原始行号", ...rawHeaders, "处理结果", "处理说明/失败原因"];
    const resultLabels = { success: "成功导入", failed: "失败导入", duplicate: "重复数据", conflict: "冲突客户" };
    const sheetRows = (status: ReportEntry["status"]) => [
      status === "conflict" ? [...headers.slice(0, -2), "当前归属人", ...headers.slice(-2)] : headers,
      ...entries.filter((item) => item.status === status).map(({ row, reason }) => {
        const raw = row.import_meta?.raw_data;
        const values = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const base = [row.file_name, row.row_number, ...rawHeaders.map((key) => values[key] ?? "")];
        return status === "conflict" ? [...base, row.conflict_owner_name || "已归属其他用户", resultLabels[status], reason] : [...base, resultLabels[status], reason];
      }),
    ];
    downloadWorkbook("完整导入报告.xlsx", [
      { name: "成功导入", rows: sheetRows("success") },
      { name: "失败导入", rows: sheetRows("failed") },
      { name: "重复数据", rows: sheetRows("duplicate") },
      { name: "冲突客户", rows: sheetRows("conflict") },
    ]);
  }

  function removeFile(target: File) {
    const remaining = files.filter((file) => fileKey(file) !== fileKey(target));
    setFiles(remaining);
    void parseSelectedFiles(remaining);
  }

  async function parseSelectedFiles(selected: File[]) {
    setBusy(true);
    setError("");
    setStats(null);
    setPreviewStats({ success_count: 0, conflict_count: 0 });
    window.localStorage.removeItem(LAST_IMPORT_RESULT_KEY);
    setDetailFilter("all");
    setDetailSearch("");
    setPage(1);
    const next: MappedRow[] = [];
    const bad: FailedRow[] = [];
    const seen = new Set<string>();
    let id = 1;
    let badId = 1;
    for (const file of selected) {
      try {
        const parsed: ImportRow[] = await parseImportFile(file);
        parsed.forEach((raw, index) => {
          const item = {
            ...mapImportRow(raw),
            preview_id: id,
            file_name: file.name,
            row_number: index + 2,
          } as MappedRow;
          const hasContact = [
            item.phone,
            item.email,
            item.website,
            item.google_url,
          ].some(Boolean);
          if (!item.company_name || !item.country || !hasContact) {
            bad.push({
              id: badId++,
              file_name: file.name,
              row_number: index + 2,
              reason: "缺少客户名称、国家或有效联系方式，已跳过",
              kind: "error",
              row: item,
            });
            return;
          }
          const keys = identityKeys(item);
          if (keys.some((key) => seen.has(key))) {
            bad.push({
              id: badId++,
              file_name: file.name,
              row_number: index + 2,
              reason: "客户身份重复，仅保留文件中最先出现的数据",
              kind: "duplicate",
              row: item,
            });
            return;
          }
          keys.forEach((key) => seen.add(key));
          next.push(item);
          id += 1;
        });
      } catch (reason) {
        bad.push({
          id: badId++,
          file_name: file.name,
          row_number: 0,
          reason: reason instanceof Error ? reason.message : "文件解析失败",
          kind: "error",
        });
      }
    }
    setRows(next);
    setFailed(bad);
    setPreviewStats({ success_count: 0, conflict_count: 0 });
    setBusy(false);
  }

  async function chooseFileList(list?: FileList | null) {
    const incoming = await sanitizeSelectedFiles(Array.from(list || []));
    if (!incoming.length) {
      setError("未读取到有效文件，请选择内容完整的 .xlsx、.xls 或 .csv 文件");
      return;
    }
    const merged = await sanitizeSelectedFiles([...files, ...incoming]);
    setFiles(merged);
    await parseSelectedFiles(merged);
  }

  function clearFiles() {
    setFiles([]);
    setRows([]);
    setFailed([]);
    setStats(null);
    setPreviewStats({ success_count: 0, conflict_count: 0 });
    window.localStorage.removeItem(LAST_IMPORT_RESULT_KEY);
    setPage(1);
    setDetailFilter("all");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function confirmImport() {
    if (!rows.length) return;
    setBusy(true);
    setError("");
    try {
      const bodyRows = rows.map(
        ({ preview_id, file_name, row_number, ...item }) => {
          void preview_id;
          return {
            ...item,
            import_meta: { ...(item.import_meta || {}), file_name, row_number },
          };
        },
      );
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename:
            files.length === 1
              ? files[0].name
              : `批量导入${files.length}个文件`,
          rows: bodyRows,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "导入失败，请稍后重试");
      const results = Array.isArray(body.results) ? body.results : [];
      const resultByRow = new Map<string, Record<string, unknown>>(
        results.map((item: Record<string, unknown>) => [
          `${String(item.file_name || "").toLowerCase()}|${Number(item.row_number || 0)}`,
          item,
        ]),
      );
      const completedRows = rows.map((row) => {
        const result = resultByRow.get(
          `${row.file_name.toLowerCase()}|${row.row_number}`,
        );
        return {
          ...row,
          import_result: String(result?.status || "success") as MappedRow["import_result"],
          result_reason: String(result?.reason || ""),
          conflict_owner_name: String(result?.owner_name || ""),
        };
      });
      completedRows.push(
        ...failed
          .filter((item) => item.kind === "duplicate" && item.row)
          .map((item) => ({
            ...item.row!,
            import_result: "duplicate" as const,
            result_reason: item.reason,
            conflict_owner_name: item.row!.conflict_owner_name || "",
          })),
      );
      const serverFailures = results
        .filter((item: Record<string, unknown>) => item.status === "failed")
        .map((item: Record<string, unknown>, index: number) => ({
          id: failed.length + index + 1,
          file_name: String(item.file_name || "导入文件"),
          row_number: Number(item.row_number || 0),
          reason: String(item.reason || "导入系统失败"),
          kind: "failure" as const,
        }));
      const completedFailures = [...failed, ...serverFailures];
      const completedStats: Stats = {
        total_count: rows.length + failed.length,
        importable_count: rows.length,
        success_count: Number(body.success_count || 0),
        duplicate_count: duplicateCount + Number(body.duplicate_count || 0),
        conflict_count: Number(body.conflict_count || 0),
        error_count: invalidCount + Number(body.error_count || 0),
        failed_count: Number(body.failed_count || serverFailures.length || 0),
        errors: Array.isArray(body.errors) ? body.errors.map(String) : [],
      };
      setRows(completedRows);
      setFailed(completedFailures);
      setStats(completedStats);
      const completedSnapshot = {
        files,
        rows: completedRows,
        failed: completedFailures,
        stats: completedStats,
        previewStats,
      };
      sessionRef.current = completedSnapshot;
      importSessionSnapshot = completedSnapshot;
      window.localStorage.setItem(
        LAST_IMPORT_RESULT_KEY,
        JSON.stringify({ stats: completedStats, failed: completedFailures }),
      );
      window.dispatchEvent(new Event(IMPORT_TASK_EVENT));
      setDetailFilter("all");
      setPage(1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "导入失败，请稍后重试",
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const headers = [
      "名称",
      "国家",
      "区号",
      "完整号码",
      "邮箱",
      "标签",
      "分类",
      "商店名称",
      "商店地址",
      "商店类型",
      "商店网址",
      "商店状态",
      "商家官网网址",
      "谷歌网址",
      "商店分数",
      "商品图片",
      "搜索关键词",
      "创建时间",
    ];
    const countries = [
      { name: "美国", code: "+1", domain: "us" },
      { name: "英国", code: "+44", domain: "uk" },
      { name: "德国", code: "+49", domain: "de" },
      { name: "法国", code: "+33", domain: "fr" },
      { name: "西班牙", code: "+34", domain: "es" },
      { name: "意大利", code: "+39", domain: "it" },
      { name: "荷兰", code: "+31", domain: "nl" },
      { name: "澳大利亚", code: "+61", domain: "au" },
      { name: "加拿大", code: "+1", domain: "ca" },
      { name: "印度", code: "+91", domain: "in" },
      { name: "阿联酋", code: "+971", domain: "ae" },
      { name: "新加坡", code: "+65", domain: "sg" },
      { name: "巴西", code: "+55", domain: "br" },
      { name: "墨西哥", code: "+52", domain: "mx" },
      { name: "日本", code: "+81", domain: "jp" },
    ];
    const industries = [
      "手机维修店",
      "手机配件批发商",
      "手机配件零售商",
      "手机进口商",
      "电脑维修店",
      "电脑配件批发商",
      "消费电子批发",
      "IT设备经销商",
      "电商零售",
      "通讯设备进口商",
    ];
    const csv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sampleRows = Array.from({ length: 500 }, (_, index) => {
      const country = countries[index % countries.length];
      const industry = industries[index % industries.length];
      const slug = `trade-${String(index + 1).padStart(3, "0")}-${country.domain}`;
      const phone = `${country.code} ${String(200000000 + index * 7919).slice(0, 10)}`;
      return [
        `${country.name}${industry}示例 ${index + 1}`,
        country.name,
        country.code,
        phone,
        `sales${index + 1}@${slug}.example.com`,
        `手机配件, ${industry}`,
        industry,
        `${country.name} ${industry} Store`,
        `${index + 1} Commerce Street`,
        industry,
        `https://shop.${slug}.example.com`,
        "营业中",
        `https://${slug}.example.com`,
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${country.name} ${industry} ${index + 1}`)}`,
        String(60 + (index % 40)),
        `https://images.example.com/products/${slug}.jpg`,
        `${industry}, mobile accessories, wholesale`,
        "2026-08-15",
      ]
        .map(csv)
        .join(",");
    });
    const blob = new Blob(
      [
        "\ufeff" +
          headers.map(csv).join(",") +
          "\n" +
          sampleRows.join("\n") +
          "\n",
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "客户导入模板.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="min-h-screen bg-[#f5f8fc] px-4 py-5 lg:px-8 lg:py-7">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            数据导入
          </h1>
          <div className="text-sm text-slate-500">
            支持 Excel、CSV 和文件夹批量导入
          </div>
        </div>
        <div className="mb-5 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center">
            <span
              className={`grid h-8 w-8 place-items-center rounded-full ${step >= 1 ? "bg-blue-600 text-white" : "bg-slate-100"}`}
            >
              1
            </span>
            <b className="ml-2 text-sm">选择文件</b>
          </div>
          <span className="h-px w-16 bg-blue-200 lg:w-44" />
          <div className="flex items-center">
            <span
              className={`grid h-8 w-8 place-items-center rounded-full ${step >= 2 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}
            >
              2
            </span>
            <b className="ml-2 text-sm">导入处理</b>
          </div>
          <span className="h-px w-16 bg-blue-200 lg:w-44" />
          <div className="flex items-center">
            <span
              className={`grid h-8 w-8 place-items-center rounded-full ${step >= 3 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}
            >
              3
            </span>
            <b className="ml-2 text-sm">导入结果</b>
          </div>
        </div>
        <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                已选择文件{" "}
                <span className="ml-1 text-sm font-normal text-slate-500">
                  {files.length} 个
                </span>
              </h2>
              <div className="flex gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                  <Plus size={16} />
                  添加文件
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(event) => {
                      const list = event.currentTarget.files;
                      void chooseFileList(list);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  <FolderOpen size={16} />
                  添加文件夹
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    {...directoryProps}
                    onChange={(event) => {
                      const list = event.currentTarget.files;
                      void chooseFileList(list);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="mt-4 max-h-[248px] space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {files.length ? (
                files.map((file) => (
                  <div
                    key={fileKey(file)}
                    className="flex items-center gap-3 rounded-md bg-white px-3 py-2 text-sm"
                  >
                    <FileSpreadsheet size={18} className="text-emerald-600" />
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={file.webkitRelativePath || file.name}
                    >
                      {file.webkitRelativePath || file.name}
                    </span>
                    <span className="text-slate-500">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    <span
                      className={busy ? "text-blue-600" : "text-emerald-600"}
                    >
                      {busy ? "解析中" : "已解析"}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(file)}
                      className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      title="移除文件"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-9 text-center text-sm text-slate-400">
                  <UploadCloud className="mx-auto mb-2 text-blue-500" />
                  通过上方两个入口添加 Excel/CSV
                  文件；重复选择的同一文件只保留一份
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                支持多次追加文件或文件夹，系统按文件名、大小和修改时间自动去重。
              </p>
              <button
                type="button"
                disabled={!files.length || busy}
                onClick={clearFiles}
                className="shrink-0 rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
              >
                清空全部
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">导入模板与说明</h2>
              <Info size={18} className="text-slate-400" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={downloadTemplate}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                <Download size={16} /> 下载导入模板
              </button>
              <button
                type="button"
                onClick={() => setShowFieldGuide(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              >
                <Info size={16} /> 查看字段说明
              </button>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-600">
              <li>• 必填：客户名称、国家/地区</li>
              <li>• 至少提供一种联系方式：电话、邮箱、官网或 Google Maps</li>
              <li>• 支持多文件和文件夹批量导入，系统自动合并预览</li>
              <li>• 名称+完整电话或名称+邮箱相同的数据只保留最先导入的一条</li>
            </ul>
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              <AlertTriangle className="mr-2 inline" size={16} />{" "}
              建议使用模板，可减少字段识别和格式错误。
            </div>
          </div>
        </section>
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="flex min-h-[84px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
                <FileSpreadsheet size={18} />
              </span>
              <div>
                <div className="text-xs text-slate-500">已选文件</div>
                <div className="mt-0.5 whitespace-nowrap text-xl font-bold text-slate-900">
                  {files.length.toLocaleString()} 个
                </div>
              </div>
          </div>
          <Metric
            label="可导入数据"
            value={displayImportable}
            tone="bg-blue-50 text-blue-600"
            icon={<FileSpreadsheet size={18} />}
          />
          <Metric
            label="成功导入"
            value={displaySuccess}
            tone="bg-emerald-50 text-emerald-600"
            icon={<CheckCircle2 size={18} />}
          />
          <Metric label="失败导入" value={displayFailure} tone="bg-rose-50 text-rose-600" icon={<AlertTriangle size={18} />} />
          <Metric label="重复数据" value={displayDuplicate} tone="bg-amber-50 text-amber-600" icon={<RefreshCw size={18} />} />
          <Metric label="冲突客户" value={displayConflict} tone="bg-orange-50 text-orange-600" icon={<ShieldAlert size={18} />} href="/customers?tab=conflicts" />
        </section>
        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertTriangle size={17} /> {error}
            <button
              onClick={() => setError("")}
              className="ml-auto font-medium underline"
            >
              关闭
            </button>
          </div>
        )}
        <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
            <div>
              <h2 className="text-lg font-semibold">
                {stats ? "本次导入明细" : "导入数据预览"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {stats
                  ? `成功 ${stats.success_count} 条，重复 ${stats.duplicate_count} 条，失败 ${stats.failed_count} 条，冲突 ${stats.conflict_count || 0} 条`
                  : `共 ${rows.length} 条可导入数据；当前仅完成解析预览，点击“确认导入”后才会写入系统`}
              </p>
            </div>
            <div className="flex gap-2">
              {stats ? (
                <button
                  onClick={() => setShowFailures(true)}
                  disabled={!stats.failed_count && !stats.error_count}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 disabled:opacity-40"
                >
                  查看失败原因
                </button>
              ) : null}
              {!stats ? (
                <button
                  disabled={busy || !rows.length}
                  onClick={() => void confirmImport()}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> 正在处理...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} /> 确认导入 {rows.length} 条
                    </>
                  )}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {stats ? (
                <>
                  <span className="text-sm font-medium text-slate-800">
                    按最终处理结果筛选
                  </span>
                  {[
                    ["all", "全部"],
                    ["success", "成功导入"],
                    ["duplicate", "重复数据"],
                    ["conflict", "冲突客户"],
                    ["failed", "导入失败"],
                  ].map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => {
                        setDetailFilter(key as typeof detailFilter);
                        setPage(1);
                      }}
                      className={`rounded-md border px-3 py-1.5 text-xs ${detailFilter === key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}
                    >
                      {label}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <label className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-2.5 text-slate-400"
                />
                <input
                  value={detailSearch}
                  onChange={(event) => {
                    setDetailSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="搜索客户名称、电话或邮箱"
                  className="w-64 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                />
              </label>
              <button
                type="button"
                onClick={downloadReport}
                disabled={!stats}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={14} />
                下载完整导入报告
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1640px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[190px]" />
                <col className="w-[120px]" />
                <col className="w-[160px]" />
                <col className="w-[200px]" />
                <col className="w-[210px]" />
                <col className="w-[210px]" />
                <col className="w-[180px]" />
                <col className="w-[150px]" />
                <col className="w-[210px]" />
              </colgroup>
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  {[
                    "客户名称",
                    "国家/地区",
                    "完整号码",
                    "邮箱",
                    "官网网址",
                    "谷歌网址",
                    "商店名称",
                    "商店类型",
                    "商品图片",
                  ].map((head) => (
                    <th
                      key={head}
                      className="whitespace-nowrap px-4 py-3 font-semibold"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.preview_id}
                    className="border-t border-slate-100 hover:bg-blue-50/40"
                  >
                    <td className="w-[190px] px-4 py-3 font-medium text-slate-800">
                      <span className="block truncate" title={row.company_name || ""}>{row.company_name || "-"}</span>
                      {row.import_result === "conflict" ? <span className="mt-1 block truncate text-xs font-semibold text-rose-600" title={`当前归属人：${row.conflict_owner_name || "已归属其他用户"}`}>当前归属人：{row.conflict_owner_name || "已归属其他用户"}</span> : null}
                    </td>
                    <td className="w-[150px] px-4 py-3"><ImportCountry value={row.country} /></td>
                    <td className="w-[160px] whitespace-nowrap px-4 py-3">
                      <span className="block truncate" title={row.phone || ""}>{row.phone || "-"}</span>
                    </td>
                    <td className="w-[200px] px-4 py-3">
                      <span className="block truncate" title={row.email || ""}>{row.email || "-"}</span>
                    </td>
                    <td className="overflow-hidden px-4 py-3">
                      <LinkCell value={row.website} />
                    </td>
                    <td className="overflow-hidden px-4 py-3">
                      <LinkCell value={row.google_url} />
                    </td>
                    <td className="w-[180px] px-4 py-3">
                      <span className="block truncate" title={String(row.import_meta?.store_name || "")}>{String(row.import_meta?.store_name || "-")}</span>
                    </td>
                    <td className="w-[150px] px-4 py-3">
                      <span className="block truncate" title={String(row.import_meta?.store_type || "")}>{String(row.import_meta?.store_type || "-")}</span>
                    </td>
                    <td className="w-[210px] overflow-hidden px-4 py-3">
                      <LinkCell
                        value={String(row.import_meta?.product_image || "")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length && (
              <div className="p-16 text-center text-slate-400">
                {detailFilter === "all" && !rows.length
                  ? "请先上传 Excel 或 CSV 文件"
                  : "没有匹配的导入记录"}
              </div>
            )}
          </div>
          <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-200 p-4 text-sm text-slate-600">
            <span className="mr-2">
              共 {filteredRows.length.toLocaleString()} 条
            </span>
            <button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 disabled:opacity-40"
            >
              上一页
            </button>
            {Array.from(
              { length: Math.min(pages, 3) },
              (_, index) => index + 1,
            ).map((number) => (
              <button
                key={number}
                onClick={() => setPage(number)}
                className={`min-w-9 rounded-lg border px-3 py-2 ${page === number ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white hover:bg-blue-50"}`}
              >
                {number}
              </button>
            ))}
            {pages > 4 && (
              <>
                <span className="px-1 text-slate-400">...</span>
                <button
                  onClick={() => setPage(pages)}
                  className={`min-w-9 rounded-lg border px-3 py-2 ${page === pages ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white hover:bg-blue-50"}`}
                >
                  {pages}
                </button>
              </>
            )}
            <button
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 disabled:opacity-40"
            >
              下一页
            </button>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size} 条/页
                </option>
              ))}
            </select>
            <label className="ml-2 inline-flex items-center gap-2">
              跳至
              <input
                value={jumpPage}
                onChange={(event) =>
                  setJumpPage(event.target.value.replace(/\\D/g, ""))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const target = Math.min(
                      pages,
                      Math.max(1, Number(jumpPage) || 1),
                    );
                    setPage(target);
                    setJumpPage("");
                  }
                }}
                className="w-16 rounded-lg border border-slate-200 px-2 py-2"
                inputMode="numeric"
              />
              页
            </label>
          </footer>
        </section>
        {showFailures && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4">
            <section className="max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b p-5">
                <div>
                  <h3 className="text-lg font-semibold">导入失败原因</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    失败数据不会写入客户表，可修正后重新导入。
                  </p>
                </div>
                <button
                  onClick={() => setShowFailures(false)}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  关闭
                </button>
              </div>
              <div className="max-h-[60vh] overflow-auto p-5">
                {failed.some((item) => item.kind === "failure") ? (
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="pb-3">文件</th>
                        <th className="pb-3">行号</th>
                        <th className="pb-3">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failed.filter((item) => item.kind === "failure").map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="py-3">{item.file_name}</td>
                          <td>{item.row_number || "-"}</td>
                          <td className="text-rose-600">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-12 text-center text-slate-400">
                    暂无失败数据
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
        {showFieldGuide && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4" onMouseDown={() => setShowFieldGuide(false)}>
            <section className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">导入字段说明</h3>
                  <p className="mt-1 text-sm text-slate-500">建议下载并使用系统模板，字段识别更准确。</p>
                </div>
                <button type="button" onClick={() => setShowFieldGuide(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">关闭</button>
              </div>
              <div className="grid gap-4 p-6 text-sm text-slate-600 sm:grid-cols-2">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <div className="font-semibold text-blue-800">必要字段</div>
                  <p className="mt-2">客户名称、国家/地区必须填写。</p>
                  <p className="mt-1">电话、邮箱、官网网址、谷歌网址至少填写一项。</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">重复判断</div>
                  <p className="mt-2">客户名称 + 完整号码，或客户名称 + 邮箱完全相同时，只保留最先出现的一条。</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 sm:col-span-2">
                  <div className="font-semibold text-slate-900">支持字段</div>
                  <p className="mt-2 leading-7">客户名称、国家/地区、区号、完整号码、邮箱、标签、分类、商店名称、商店地址、商店类型、商店网址、商店状态、官网网址、谷歌网址、商店分数、商品图片、搜索关键词、创建时间。</p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
