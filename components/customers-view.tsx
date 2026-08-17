"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { Customer, CustomerStatus } from "@/lib/types";

const stageLabels: Record<CustomerStatus, string> = {
  UNCLAIMED: "新客户",
  CLAIMED: "意向客户",
  FOLLOWING: "意向客户",
  QUOTE: "报价中",
  DEAL: "成交客户",
  RELEASED: "无效客户",
};
const stageClass: Record<CustomerStatus, string> = {
  UNCLAIMED: "bg-slate-100 text-slate-700",
  CLAIMED: "bg-blue-50 text-blue-700",
  FOLLOWING: "bg-indigo-50 text-indigo-700",
  QUOTE: "bg-orange-50 text-orange-700",
  DEAL: "bg-emerald-50 text-emerald-700",
  RELEASED: "bg-slate-100 text-slate-500",
};
type ColumnKey =
  | "company_name"
  | "contact_name"
  | "country"
  | "ai_score"
  | "status"
  | "protection"
  | "last_contact_time"
  | "owner"
  | "phone"
  | "email"
  | "website_email"
  | "website_phone"
  | "website"
  | "google_url"
  | "source"
  | "updated_at";
const columns: { key: ColumnKey; label: string; locked?: boolean }[] = [
  { key: "company_name", label: "客户名称", locked: true },
  { key: "contact_name", label: "联系人" },
  { key: "country", label: "国家/地区", locked: true },
  { key: "ai_score", label: "AI评分" },
  { key: "status", label: "客户阶段", locked: true },
  { key: "protection", label: "保护状态" },
  { key: "last_contact_time", label: "最近跟进" },
  { key: "owner", label: "负责人", locked: true },
  { key: "phone", label: "联系电话" },
  { key: "email", label: "邮箱" },
  { key: "website_email", label: "官网邮箱" },
  { key: "website_phone", label: "官网电话" },
  { key: "website", label: "官网" },
  { key: "google_url", label: "Google Maps" },
  { key: "source", label: "数据来源" },
  { key: "updated_at", label: "更新时间" },
];
const defaults: ColumnKey[] = [
  "company_name",
  "country",
  "ai_score",
  "status",
  "last_contact_time",
  "owner",
  "phone",
  "email",
  "website",
  "google_url",
  "source",
  "updated_at",
];
const href = (value?: string | null) => {
  const text = String(value || "").trim();
  return text ? (/^https?:\/\//i.test(text) ? text : `https://${text}`) : "";
};
function Website({ value }: { value?: string | null }) {
  const target = href(value);
  if (!target) return <span className="text-slate-400">-</span>;
  return (
    <a
      href={target}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={value || ""}
      className="inline-flex max-w-28 items-center gap-1 truncate text-blue-600 hover:underline"
    >
      <span className="truncate">{value}</span>
      <ExternalLink size={12} />
    </a>
  );
}
function Score({ customer }: { customer: Customer }) {
  return customer.ai_score == null ? (
    <span className="text-slate-400">未筛选</span>
  ) : (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ${customer.ai_score >= 80 ? "bg-emerald-50 text-emerald-700" : customer.ai_score >= 65 ? "bg-blue-50 text-blue-700" : customer.ai_score >= 50 ? "bg-orange-50 text-orange-700" : "bg-rose-50 text-rose-600"}`}
    >
      {customer.ai_level || "-"} · {customer.ai_score}
    </span>
  );
}
function value(customer: Customer, key: ColumnKey) {
  if (key === "company_name") return customer.company_name || "-";
  if (key === "country") return customer.country || "-";
  if (key === "status") return stageLabels[customer.status] || customer.status;
  if (key === "protection") return "-";
  if (key === "owner") return customer.owner?.name || customer.owner_id || "-";
  if (key === "contact_name") return customer.contact_name || "-";
  if (key === "phone") return customer.phone || "-";
  if (key === "email") return customer.email || "-";
  if (key === "website_email") return customer.website_email || "-";
  if (key === "website_phone") return customer.website_phone || "-";
  if (key === "source")
    return customer.source === "EXCEL_IMPORT"
      ? "Excel导入"
      : customer.source || "-";
  if (key === "last_contact_time" || key === "updated_at")
    return customer[key]
      ? new Date(String(customer[key]))
          .toLocaleString("zh-CN", { hour12: false })
          .replace(/\//g, "-")
      : "未跟进";
  return "";
}

export function CustomersView() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [target, setTarget] = useState("");
  const [owner, setOwner] = useState("");
  const [owners, setOwners] = useState<
    Array<{ id: string; name: string | null; email: string }>
  >([]);
  const [aiPending, setAiPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Customer | null>(null);
  const [fields, setFields] = useState<ColumnKey[]>(defaults);
  const [draft, setDraft] = useState<ColumnKey[]>(defaults);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("customer-columns-v5") || "null",
      );
      if (Array.isArray(saved) && saved.length) {
        setFields(saved);
        setDraft(saved);
      }
    } catch {}
  }, []);
  useEffect(() => {
    fetch("/api/users/options")
      .then((response) => response.json())
      .then((body) => {
        if (Array.isArray(body.users)) setOwners(body.users);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("search") || "");
    setCountry(params.get("country") || "");
    setStatus(params.get("status") || "");
    setLevel(params.get("ai_level") || "");
    setTarget(params.get("target") || "");
    setOwner(params.get("owner_id") || "");
    setAiPending(params.get("ai_pending") === "true");
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      if (fieldRef.current && !fieldRef.current.contains(targetNode))
        setFieldOpen(false);
      if (newRef.current && !newRef.current.contains(targetNode))
        setNewOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      search,
      country,
      status,
      ai_level: level,
      target,
      owner_id: owner,
      ai_pending: String(aiPending),
      deleted: "false",
      sort: "updated_at",
      direction: "desc",
    });
    try {
      const response = await fetch(`/api/customers?${params}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "获取客户列表失败");
      window.history.replaceState(null, "", `/customers?${params.toString()}`);
      setRows(Array.isArray(body.data) ? body.data : []);
      setCount(Number(body.count || 0));
    } catch (reason) {
      setRows([]);
      setCount(0);
      setError(reason instanceof Error ? reason.message : "获取客户列表失败");
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    search,
    country,
    status,
    level,
    target,
    owner,
    aiPending,
  ]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const numbers = useMemo(
    () =>
      Array.from(
        { length: Math.min(5, pages) },
        (_, index) => Math.max(1, Math.min(page - 2, pages - 4)) + index,
      ),
    [page, pages],
  );
  const allPage = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const activeFilters = useMemo(
    () =>
      [
        search ? { key: "search", label: `关键词：${search}` } : null,
        country ? { key: "country", label: `国家/地区：${country}` } : null,
        level ? { key: "level", label: `AI等级：${level}` } : null,
        status
          ? {
              key: "status",
              label: `客户阶段：${stageLabels[status as CustomerStatus] || status}`,
            }
          : null,
        target
          ? {
              key: "target",
              label: `目标客户：${target === "valid" ? "有效" : "无效"}`,
            }
          : null,
        owner
          ? {
              key: "owner",
              label:
                owner === "unclaimed"
                  ? "负责人：未分配"
                  : `负责人：${owners.find((item) => item.id === owner)?.name || owners.find((item) => item.id === owner)?.email || "已分配"}`,
            }
          : null,
        aiPending ? { key: "aiPending", label: "待AI筛选" } : null,
      ].filter((item): item is { key: string; label: string } => Boolean(item)),
    [search, country, level, status, target, owner, aiPending, owners],
  );
  function clearFilter(key: string) {
    if (key === "search") setSearch("");
    if (key === "country") setCountry("");
    if (key === "level") setLevel("");
    if (key === "status") setStatus("");
    if (key === "target") setTarget("");
    if (key === "owner") setOwner("");
    if (key === "aiPending") setAiPending(false);
    setPage(1);
  }
  function reset() {
    setSearch("");
    setCountry("");
    setStatus("");
    setLevel("");
    setTarget("");
    setOwner("");
    setAiPending(false);
    setPage(1);
    setSelected(new Set());
  }
  function notify(message: string, type: "success" | "error" = "success") {
    window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { message, type } }));
  }
  async function remove(ids: string[]) {
    if (!ids.length) return;
    const response =
      ids.length === 1
        ? await fetch(`/api/customers/${ids[0]}`, { method: "DELETE" })
        : await fetch("/api/customers/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, action: "DELETE" }),
          });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "删除失败");
      notify(body.error || "删除失败，请稍后重试", "error");
      return;
    }
    if (Number(body.failed_count || 0) > 0 || Number(body.success_count || (body.ok ? 1 : 0)) === 0) {
      const message = body.results?.find?.((item: { error?: string }) => item.error)?.error || "部分客户未能移入回收站";
      setError(message);
      notify(message, "error");
    } else {
      notify(`已将 ${ids.length} 条客户移入回收站`);
    }
    setSelected(new Set());
    setDetail(null);
    setDeleteIds(null);
    await load();
  }
  async function updateStage(nextStatus: string) {
    if (!selected.size) return;
    const response = await fetch("/api/customers/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [...selected],
        action: "STAGE",
        status: nextStatus,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "批量更新阶段失败");
      notify(body.error || "批量更新阶段失败", "error");
      return;
    }
    if (Number(body.failed_count || 0) > 0) {
      const message = body.results?.find?.((item: { error?: string }) => item.error)?.error || "部分客户阶段没有更新";
      setError(message);
      notify(message, "error");
    } else notify(`已更新 ${body.success_count || selected.size} 条客户阶段`);
    setBulkOpen(false);
    setSelected(new Set());
    await load();
  }
  async function selectAllResults() {
    setSelectingAll(true);
    setError("");
    const params = new URLSearchParams({
      page: "1", pageSize: "5000", ids_only: "true", search, country, status,
      ai_level: level, target, owner_id: owner, ai_pending: String(aiPending),
      deleted: "false", sort: "updated_at", direction: "desc",
    });
    try {
      const response = await fetch(`/api/customers?${params}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "全选当前筛选结果失败");
      setSelected(new Set((body.data || []).map((item: Customer) => item.id)));
      notify(`已选择当前筛选结果的 ${Number(body.count || 0)} 条客户`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "全选当前筛选结果失败";
      setError(message);
      notify(message, "error");
    } finally {
      setSelectingAll(false);
    }
  }
  function exportData() {
    const header = fields.map(
      (key) => columns.find((item) => item.key === key)?.label || key,
    );
    const lines = rows.map((row) =>
      fields
        .map((key) =>
          JSON.stringify(
            key === "ai_score"
              ? row.ai_score == null
                ? "未筛选"
                : `${row.ai_level || "-"}-${row.ai_score}`
              : key === "website" || key === "google_url"
                ? row[key] || ""
                : value(row, key),
          ),
        )
        .join(","),
    );
    const blob = new Blob(
      ["\ufeff" + header.join(",") + "\n" + lines.join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "客户列表.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  return (
    <main className="min-h-screen bg-[#f5f8fc] px-5 py-6 lg:px-7">
      <div className="mx-auto max-w-[1800px]">
        <div className="flex items-end gap-5">
          <div>
            <div className="text-sm text-slate-500">
              客户管理&nbsp;&nbsp;/&nbsp;&nbsp;客户列表
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
              客户管理{" "}
              <span className="ml-4 text-base font-normal text-slate-500">
                统一管理、跟进和保护客户数据
              </span>
            </h1>
          </div>
          <span className="mb-1 text-lg text-slate-600">
            <b className="text-blue-600">{count}</b> 家客户
          </span>
        </div>
        <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700">
          <span className="mr-2 text-blue-600">◈</span>当前数据范围：当前用户 ·
          系统按登录权限自动确定 · 客户数已按主体去重
          <span className="float-right cursor-pointer text-blue-600">
            查看权限说明 ⓘ
          </span>
        </div>
        <nav className="mt-5 flex items-center gap-9 border-b border-slate-200 text-sm">
          <Link
            href="/customers"
            className="border-b-2 border-blue-600 pb-3 font-semibold text-blue-600"
          >
            客户列表
          </Link>
          <Link href="/followups" className="pb-3 text-slate-700">
            跟进待办{" "}
            <b className="ml-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
              —
            </b>
          </Link>
          <span className="pb-3 text-slate-500">
            保护到期{" "}
            <b className="ml-1 rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white">
              —
            </b>
          </span>
          <Link href="/customers/conflicts" className="pb-3 text-slate-700 hover:text-blue-600">
            冲突客户{" "}
            <b className="ml-1 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white">
              —
            </b>
          </Link>
        </nav>
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[300px] flex-1">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={17}
              />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => event.key === "Enter" && void load()}
                placeholder="搜索客户、联系人、电话或邮箱"
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="relative min-w-40">
              <input
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value);
                  setPage(1);
                }}
                placeholder="国家/地区"
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-3 pr-8 text-sm outline-none focus:border-blue-500"
              />
              <Search
                className="absolute right-3 top-2.5 text-slate-400"
                size={16}
              />
            </label>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="min-w-40 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            >
              <option value="">全部客户阶段</option>
              {(["UNCLAIMED", "CLAIMED", "QUOTE", "DEAL", "RELEASED"] as CustomerStatus[]).map((key) => (
                <option key={key} value={key}>
                  {stageLabels[key]}
                </option>
              ))}
            </select>
            <select
              value={level}
              onChange={(event) => {
                setLevel(event.target.value);
                setPage(1);
              }}
              className="min-w-36 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            >
              <option value="">全部AI等级</option>
              {["S", "A", "B", "C", "D"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setPage(1);
              }}
              className="min-w-40 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            >
              <option value="">全部目标客户</option>
              <option value="valid">有效目标</option>
              <option value="invalid">无效客户</option>
            </select>
            <select
              value={owner}
              onChange={(event) => {
                setOwner(event.target.value);
                setPage(1);
              }}
              className="min-w-36 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            >
              <option value="">全部负责人</option>
              <option value="unclaimed">未分配</option>
              {owners.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || item.email}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setAiPending((value) => !value);
                setPage(1);
              }}
              className={`rounded-lg border px-3 py-2.5 text-sm transition ${aiPending ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
            >
              待AI筛选
            </button>
            <button
              onClick={reset}
              className="min-w-36 rounded-lg border border-slate-200 px-4 py-2.5 text-sm hover:bg-slate-50"
            >
              重置
            </button>
          </div>
          {activeFilters.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">已应用筛选：</span>
              {activeFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.key}
                  onClick={() => clearFilter(filter.key)}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-100"
                >
                  {filter.label}
                  <X size={13} />
                </button>
              ))}
              <button
                type="button"
                onClick={reset}
                className="ml-1 text-xs font-medium text-blue-600 hover:underline"
              >
                清空全部
              </button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <div ref={newRef} className="relative">
              <button
                onClick={() => setNewOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus size={16} />
                新增客户⌄
              </button>
              {newOpen && (
                <div className="absolute left-0 top-11 z-40 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                  <Link
                    href="/customers/new"
                    className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"
                  >
                    <UserPlus size={20} className="mt-0.5 shrink-0 text-blue-600" />
                    <span><span className="block text-sm font-medium">手动新增</span><small className="text-slate-500">逐条录入客户资料</small></span>
                  </Link>
                  <Link
                    href="/import"
                    className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"
                  >
                    <FileSpreadsheet size={20} className="mt-0.5 shrink-0 text-emerald-600" />
                    <span><span className="block text-sm font-medium">Excel批量导入</span><small className="text-slate-500">
                      前往 数据导入 &gt; 上传文件
                    </small></span>
                  </Link>
                  <a
                    href="/api/import/template"
                    className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"
                  >
                    <Download size={20} className="mt-0.5 shrink-0 text-blue-600" />
                    <span><span className="block text-sm font-medium">下载Excel导入模板</span><small className="text-slate-500">
                      .csv · 含字段说明和示例数据
                    </small></span>
                  </a>
                  <div className="border-t px-3 py-2 text-xs text-slate-400">
                    请使用系统最新模板，勿修改第一行字段名称
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={exportData}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50"
            >
              <Download size={16} />
              导出数据
            </button>
            <div ref={fieldRef} className="relative">
              <button
                onClick={() => {
                  setDraft(fields);
                  setFieldOpen((value) => !value);
                }}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50"
              >
                <Settings2 size={16} />
                字段设置
              </button>
              {fieldOpen && (
                <div className="absolute left-0 top-11 z-40 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                  <b>字段显示设置</b>
                  <div className="mt-3 max-h-80 space-y-1 overflow-auto">
                    {columns.map((column) => (
                      <label
                        key={column.key}
                        className="flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={draft.includes(column.key)}
                          disabled={column.locked}
                          onChange={() =>
                            setDraft((current) =>
                              current.includes(column.key)
                                ? current.filter((item) => item !== column.key)
                                : [...current, column.key],
                            )
                          }
                        />
                        {column.label}
                        {column.locked && (
                          <span className="ml-auto text-xs text-slate-400">
                            固定
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-between border-t pt-3 text-xs">
                    <button
                      onClick={() => setDraft(columns.map((item) => item.key))}
                      className="text-blue-600"
                    >
                      全选
                    </button>
                    <button
                      onClick={() => setDraft(defaults)}
                      className="text-blue-600"
                    >
                      恢复默认
                    </button>
                    <button
                      onClick={() => {
                        setFields(draft.length ? draft : defaults);
                        localStorage.setItem(
                          "customer-columns-v5",
                          JSON.stringify(draft.length ? draft : defaults),
                        );
                        setFieldOpen(false);
                      }}
                      className="font-semibold text-blue-700"
                    >
                      保存选择
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void selectAllResults()}
              disabled={selectingAll || !count}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {selectingAll ? "正在全选..." : "全选筛选结果"}
            </button>
            <span className="ml-auto text-sm text-slate-600">已选择 {selected.size} 项</span>
            <button
              disabled={!selected.size}
              onClick={() => setBulkOpen((value) => !value)}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              <UserPlus size={16} />
              批量更新阶段
            </button>
            <button
              disabled={!selected.size}
              onClick={() => setDeleteIds([...selected])}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2.5 text-sm text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={16} />
              批量删除
            </button>
            {bulkOpen && (
              <select
                autoFocus
                onChange={(event) => void updateStage(event.target.value)}
                className="rounded-lg border border-blue-300 px-3 py-2.5 text-sm"
              >
                <option value="">选择客户阶段</option>
                <option value="UNCLAIMED">新客户</option>
                <option value="CLAIMED">意向客户</option>
                <option value="QUOTE">报价中</option>
                <option value="DEAL">成交客户</option>
                <option value="RELEASED">无效客户</option>
              </select>
            )}
          </div>
        </section>
        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            {error}
            <button className="ml-3 underline" onClick={() => void load()}>
              重新加载
            </button>
          </div>
        )}
        <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[calc(100vh-360px)] overflow-auto">
            <table className="w-full min-w-[1650px] table-fixed text-left text-sm">
              <thead className="sticky top-0 z-20 bg-[#eef5fb] text-xs text-slate-700">
                <tr>
                  <th className="sticky left-0 z-30 w-12 bg-[#eef5fb] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allPage}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          rows.forEach((row) =>
                            allPage ? next.delete(row.id) : next.add(row.id),
                          );
                          return next;
                        })
                      }
                    />
                  </th>
                  {fields.map((key) => (
                    <th
                      key={key}
                      className={`${key === "company_name" ? "sticky left-12 z-30 w-52 bg-[#eef5fb]" : "w-36"} px-3 py-3`}
                    >
                      {columns.find((column) => column.key === key)?.label}
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 w-32 bg-[#eef5fb] px-4 py-3">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setDetail(row)}
                    className="h-[72px] cursor-pointer border-t border-slate-100 hover:bg-blue-50/50"
                  >
                    <td className="sticky left-0 z-10 bg-white px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    {fields.map((key) => (
                      <td
                        key={key}
                        className={`${key === "company_name" ? "sticky left-12 z-10 bg-white" : ""} max-w-48 overflow-hidden px-3 py-3 align-middle`}
                        title={
                          key === "company_name" ? row.company_name : undefined
                        }
                      >
                        {key === "company_name" ? (
                          <Link
                            href={`/customers/${row.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="block truncate font-medium text-blue-600 hover:underline"
                          >
                            {row.company_name}
                            <small className="block truncate text-xs font-normal text-slate-500">
                              {row.industry || row.category || "-"}
                            </small>
                          </Link>
                        ) : key === "ai_score" ? (
                          <Score customer={row} />
                        ) : key === "status" ? (
                          <span
                            className={`rounded-md px-2 py-1 text-xs ${stageClass[row.status]}`}
                          >
                            {stageLabels[row.status] || row.status}
                          </span>
                        ) : key === "website" || key === "google_url" ? (
                          <Website value={row[key]} />
                        ) : (
                          value(row, key)
                        )}
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 bg-white px-4 py-3">
                      <Link
                        href={`/customers/${row.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="mr-2 inline-grid h-8 w-8 place-items-center rounded text-blue-600 hover:bg-blue-50"
                        title="编辑客户"
                        aria-label={`编辑${row.company_name}`}
                      >
                        <Pencil size={17} />
                      </Link>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteIds([row.id]);
                        }}
                        className="inline-grid h-8 w-8 place-items-center rounded text-rose-500 hover:bg-rose-50"
                        title="移入回收站"
                        aria-label={`删除${row.company_name}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && (
              <div className="p-12 text-center text-slate-500">
                正在加载客户...
              </div>
            )}
            {!loading && !rows.length && (
              <div className="p-12 text-center text-slate-500">
                暂无符合条件的客户
                <button
                  onClick={reset}
                  className="ml-3 text-blue-600 underline"
                >
                  清空筛选
                </button>
              </div>
            )}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-4 border-t px-5 py-4 text-sm">
            <span className="text-slate-600">共 <b className="text-slate-900">{count}</b> 家{selected.size ? <span className="ml-2 text-blue-600">，已勾选 {selected.size} 条</span> : null}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                className="rounded-lg border px-3 py-2 disabled:opacity-40"
              >
                上一页
              </button>
              {numbers.map((number) => (
                <button
                  key={number}
                  onClick={() => setPage(number)}
                  className={`h-9 min-w-9 rounded-lg border ${number === page ? "border-blue-600 bg-blue-600 text-white" : ""}`}
                >
                  {number}
                </button>
              ))}
              <button
                disabled={page >= pages}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-lg border px-3 py-2 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
            <div className="flex items-center gap-2"><label className="hidden text-slate-500 lg:block">跳转</label><input type="number" min={1} max={pages} defaultValue={page} key={page} onKeyDown={(event) => { if (event.key === "Enter") { const next = Number(event.currentTarget.value); if (Number.isFinite(next)) setPage(Math.min(pages, Math.max(1, next))); } }} className="h-9 w-16 rounded-lg border px-2 text-center" aria-label="跳转到指定页"/><span className="hidden text-slate-500 lg:block">/ {pages} 页</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-lg border px-3 py-2" aria-label="每页显示数量">{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} 条/页</option>)}</select></div>
          </footer>
        </section>
        {deleteIds && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/25 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-customer-title">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600"><Trash2 size={21} /></div>
              <h2 id="delete-customer-title" className="mt-4 text-lg font-semibold text-slate-900">确认移入回收站？</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">将把选中的 {deleteIds.length} 条客户移入回收站，客户资料和操作记录会被保留，可由有权限的用户恢复。</p>
              <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setDeleteIds(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">取消</button>
                <button type="button" onClick={() => void remove(deleteIds)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">确认删除</button>
              </div>
            </div>
          </div>
        )}
        {detail && (
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">客户详情</h2>
              <button onClick={() => setDetail(null)}>
                <X />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                AI评分
                <b className="mt-1 block text-2xl">{detail.ai_score ?? "-"}</b>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 text-center">
                AI等级
                <b className="mt-1 block text-2xl">{detail.ai_level || "-"}</b>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-center">
                客户阶段
                <b className="mt-1 block text-sm">
                  {stageLabels[detail.status]}
                </b>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <p>
                <span className="text-slate-500">公司名称：</span>
                {detail.company_name}
              </p>
              <p>
                <span className="text-slate-500">联系人：</span>
                {detail.contact_name || "-"}
              </p>
              <p>
                <span className="text-slate-500">电话：</span>
                {detail.phone || "-"}
              </p>
              <p>
                <span className="text-slate-500">邮箱：</span>
                {detail.email || "-"}
              </p>
              <p>
                <span className="text-slate-500">官网：</span>
                <Website value={detail.website} />
              </p>
              <p>
                <span className="text-slate-500">Google Maps：</span>
                <Website value={detail.google_url} />
              </p>
            </div>
            <Link
              href={`/customers/${detail.id}`}
              className="mt-6 block rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white"
            >
              查看完整详情
            </Link>
          </aside>
        )}
      </div>
    </main>
  );
}
