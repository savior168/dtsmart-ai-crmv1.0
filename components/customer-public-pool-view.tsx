"use client";

import Link from "next/link";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Globe2,
  LoaderCircle,
  MapPin,
  Paperclip,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { CountryLabel } from "@/components/country-label";
import {
  AppDialog,
  ConfirmDialog,
  DialogActions as SharedDialogActions,
} from "@/components/ui/app-dialog";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppTabs } from "@/components/ui/app-tabs";
import { CustomerForm } from "@/components/customer-form";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";
import { customerSourceLabel } from "@/lib/customers/source-display";
import {
  CUSTOMER_LIST_COLUMNS,
  CUSTOMER_LIST_DEFAULT_COLUMNS,
  customerListSortField,
  normalizeCustomerListColumns,
  type CustomerListColumn,
} from "@/lib/customers/list-fields";
import { downloadCustomerWorkbook } from "@/lib/customer-export";
import type { UserRole } from "@/lib/auth/permissions";
import { appFieldClass } from "@/components/ui/app-list";
import { customerIndustryDisplay } from "@/lib/customers/industry-display";
import { AttachmentPreview } from "@/components/ui/attachment-preview";

type Role = UserRole;
type Tab =
  | "available"
  | "claimed"
  | "pending"
  | "renewals"
  | "handover"
  | "history";
type Owner = { id: string; name: string | null; email: string };
type PoolRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  country: string | null;
  address: string | null;
  industry: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website_email: string | null;
  website_phone: string | null;
  website: string | null;
  google_url: string | null;
  ai_level: string | null;
  ai_score: number | null;
  ai_screening_done?: boolean | null;
  business_scope: string | null;
  owner_id: string | null;
  owner: Owner | null;
  created_by?: string | null;
  creator?: Owner | null;
  pool_status: string | null;
  status: string;
  followup_status: string | null;
  last_contact_time: string | null;
  source: string | null;
  source_batch?: string | null;
  source_batch_id?: string | null;
  created_at: string;
  updated_at: string;
  contact_masked: boolean;
  can_claim: boolean;
  can_open_customer: boolean;
  protection?: { expire_date?: string; extension_count?: number } | null;
  my_supplements?: Array<{ id: string; field_name: string; value_raw: string; source_type: string; source_batch?: string | null; source_row?: number | null; created_at: string }>;
};
type AssignmentOptions = {
  assignees: Owner[];
  inactive_users: Array<Owner & { status: string; customer_count: number }>;
};
type PoolFilterOptions = {
  industries: Array<{ value: string; label: string; values: string[]; tone: "verified" | "raw" | "mixed" }>;
  owners: Owner[];
  sources: Array<{ value: string; label: string }>;
  batches: Array<{ value: string; label: string; source: string }>;
  screening_tasks: Array<{ value: string; label: string; customer_count: number }>;
};
type Renewal = {
  id: string;
  renewal_number: number;
  reason: string;
  next_plan: string;
  evidence_attachment_id: string;
  created_at: string;
  customer?: { company_name?: string; country?: string } | null;
  owner?: Owner | null;
};
type History = {
  id: string;
  batch_id: string;
  customer_id: string;
  batch_number: string;
  batch_name: string;
  reason_type: string;
  reason: string;
  mode: string;
  customer_count: number;
  created_at: string;
  source?: Owner | null;
  target?: Owner | null;
  creator?: Owner | null;
  previous_owner?: Owner | null;
  next_owner?: Owner | null;
  current_owner?: Owner | null;
  customer?: {
    id: string;
    company_name: string;
    contact_name?: string | null;
    country?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    google_url?: string | null;
    status?: string | null;
    pool_status?: string | null;
  } | null;
};

const tabLabels: Record<Tab, string> = {
  available: "待认领客户",
  claimed: "认领记录",
  pending: "待管理员分配",
  renewals: "续期审批",
  handover: "离职交接",
  history: "分配记录",
};
const tabDescriptions: Record<Tab, string> = {
  available: "无归属，可提交真实联系凭证认领",
  claimed: "查询历史归属，不属于可再次认领列表",
  pending: "到期且有业务记录或账号停用的数据",
  renewals: "审核销售员第三次及后续续期申请",
  handover: "转移停用或离职账号的全部业务数据",
  history: "追溯公海分配和离职交接批次",
};
const field = appFieldClass;
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "操作失败");
  return body;
}
const displayUser = (user?: Owner | null) =>
  user ? user.name || user.email : "—";
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

const poolStageLabels: Record<string, string> = { UNCLAIMED: "待认领", CLAIMED: "潜在客户", FOLLOWING: "意向客户", QUOTE: "报价中", DEAL: "成交客户", RELEASED: "无效客户" };
const followupLabels: Record<string, string> = { WAITING_CONTACT: "待联系", CONTACTED: "已联系", REPLIED: "已回复", NEEDS_FOLLOWUP: "需跟进", PAUSED: "暂缓", CLOSED: "已结束" };
const POOL_DEFAULT_FIELDS: Record<"available" | "claimed" | "pending", CustomerListColumn[]> = {
  available: ["company_name", "country", "ai_score", "phone", "email", "website", "google_url", "source"],
  claimed: ["company_name", "country", "ai_score", "owner", "status", "followup_status", "protection", "last_contact_time"],
  pending: ["company_name", "country", "ai_score", "phone", "email", "source", "updated_at"],
};
function poolText(row: PoolRow, key: CustomerListColumn) {
  if (key === "company_name") return row.company_name || "—";
  if (key === "contact_name") return row.contact_name || "—";
  if (key === "country") return row.country || "—";
  if (key === "industry") return customerIndustryDisplay(row).text;
  if (key === "ai_score") return row.ai_score == null ? "未筛选" : `${row.ai_level || "—"} · ${row.ai_score}`;
  if (key === "status") return poolStageLabels[row.status] || row.status || "—";
  if (key === "followup_status") return followupLabels[row.followup_status || "WAITING_CONTACT"] || "待联系";
  if (key === "protection") return row.protection?.expire_date ? `至 ${new Date(row.protection.expire_date).toLocaleDateString("zh-CN")}` : "—";
  if (key === "last_contact_time") return formatDate(row.last_contact_time);
  if (key === "owner") return displayUser(row.owner);
  if (key === "phone") return row.phone || "—";
  if (key === "email") return row.email || "—";
  if (key === "website_email") return row.website_email || "—";
  if (key === "website_phone") return row.website_phone || "—";
  if (key === "website") return row.website || "—";
  if (key === "google_url") return row.google_url || "—";
  if (key === "source") return row.source === "EXCEL_IMPORT" ? "Excel导入" : row.source || "—";
  if (key === "updated_at") return formatDate(row.updated_at);
  return "—";
}

// Keep the exact same score thresholds and visual language as “我的客户”.
function PoolScore({ row }: { row: PoolRow }) {
  if (row.ai_score == null) return <span className="text-slate-400">未筛选</span>;
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${row.ai_score >= 80 ? "bg-emerald-50 text-emerald-700" : row.ai_score >= 65 ? "bg-blue-50 text-blue-700" : row.ai_score >= 50 ? "bg-orange-50 text-orange-700" : "bg-rose-50 text-rose-600"}`}>{row.ai_level || "-"} · {row.ai_score}</span>;
}

function PoolValue({ row, field, showSupplements }: { row: PoolRow; field: CustomerListColumn; showSupplements?: (row: PoolRow) => void }) {
  if (field === "company_name") {
    const industry = customerIndustryDisplay(row);
    return <span className="block min-w-0"><span className="block truncate font-medium text-blue-700">{row.company_name}</span><small className={`mt-0.5 block truncate text-xs font-normal ${industry.verified ? "text-emerald-600" : "text-slate-500"}`} title={industry.title}>{industry.verified ? "AI核验：" : "原始类别："}{industry.text}</small>{row.my_supplements?.length ? <button type="button" onClick={(event) => { event.stopPropagation(); showSupplements?.(row); }} className="mt-1 inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-xs font-normal text-blue-700 transition hover:bg-blue-100 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-200" title="查看仅自己可见的补充资料">我的补充 {row.my_supplements.length} 项</button> : null}</span>;
  }
  if (field === "country") return <CountryLabel value={row.country}/>;
  if (field === "ai_score") return <PoolScore row={row}/>;
  if (field === "source") return <span className="block min-w-0"><span className="block truncate">{customerSourceLabel(row.source)}</span><small className="mt-0.5 block truncate text-xs text-slate-500" title={displayUser(row.creator)}>由：{displayUser(row.creator)}</small></span>;
  if (field === "website" || field === "google_url") {
    const raw = field === "website" ? row.website : row.google_url;
    const target = String(raw || "").trim();
    if (!target) return <span className="text-slate-400">—</span>;
    const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    const isWebsite = field === "website";
    return <a href={url} target="_blank" rel="noreferrer" title={isWebsite ? "打开企业官网" : "打开 Google Maps"} className="group inline-flex max-w-40 items-center gap-2 truncate text-blue-700 hover:text-blue-800"><span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors ${isWebsite ? "bg-sky-50 text-sky-600 group-hover:bg-sky-100" : "bg-rose-50 text-rose-600 group-hover:bg-rose-100"}`}>{isWebsite ? <Globe2 size={14} strokeWidth={2.25}/> : <MapPin size={14} strokeWidth={2.25}/>}</span><span className="truncate group-hover:underline">{target}</span></a>;
  }
  return <span className="line-clamp-2">{poolText(row, field)}</span>;
}

export function CustomerPublicPoolView({ initialRole = "SALES" }: { initialRole?: Role }) {
  const [tab, setTab] = useState<Tab>("available");
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [role, setRole] = useState<Role>(initialRole);
  const [count, setCount] = useState<number | null>(null);
  const [tabCounts, setTabCounts] = useState<Partial<Record<Tab, number>>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState("");
  const [focusedCustomerId, setFocusedCustomerId] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [industryOpen, setIndustryOpen] = useState(false);
  const [aiLevel, setAiLevel] = useState("");
  const [aiStatus, setAiStatus] = useState<"all" | "done" | "pending" | "failed">("all");
  const [target, setTarget] = useState("");
  const [customerStatus, setCustomerStatus] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sourceBatch, setSourceBatch] = useState("");
  const [screeningTaskIds, setScreeningTaskIds] = useState<string[]>([]);
  const [screeningTaskOpen, setScreeningTaskOpen] = useState(false);
  const [sort, setSort] = useState("updated_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [fields, setFields] = useState<CustomerListColumn[]>(POOL_DEFAULT_FIELDS.available);
  const [draftFields, setDraftFields] = useState<CustomerListColumn[]>(POOL_DEFAULT_FIELDS.available);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const newRef = useRef<HTMLDivElement>(null);
  const industryRef = useRef<HTMLDivElement>(null);
  const screeningTaskRef = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const [filterOptions, setFilterOptions] = useState<PoolFilterOptions>({
    industries: [],
    owners: [],
    sources: [],
    batches: [],
    screening_tasks: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [claim, setClaim] = useState<PoolRow | null>(null);
  const [supplementRow, setSupplementRow] = useState<PoolRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const orderedFieldOptions = useMemo(() => {
    const ordered = draftFields.map((key) => CUSTOMER_LIST_COLUMNS.find((column) => column.key === key)).filter((column): column is (typeof CUSTOMER_LIST_COLUMNS)[number] => Boolean(column));
    CUSTOMER_LIST_COLUMNS.forEach((column) => { if (!draftFields.includes(column.key)) ordered.push(column); });
    return ordered;
  }, [draftFields]);
  const appendIndustryFilters = useCallback((params: URLSearchParams) => {
    for (const value of industries) {
      const option = filterOptions.industries.find((item) => item.value === value);
      for (const filterValue of option?.values || []) params.append("industry", filterValue);
    }
  }, [filterOptions.industries, industries]);
  const load = useCallback(async () => {
    if (!["available", "claimed", "pending"].includes(tab)) {
      setLoading(false);
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        tab,
        page: String(page),
        page_size: String(pageSize),
      });
      if (query.trim()) params.set("q", query.trim());
      if (focusedCustomerId) params.set("customer_id", focusedCustomerId);
      appendIndustryFilters(params);
      if (aiLevel) params.set("ai_level", aiLevel);
      if (aiStatus !== "all") params.set("ai_status", aiStatus);
      if (target) params.set("target", target);
      if (customerStatus && tab === "claimed") params.set("status", customerStatus);
      if (ownerId && tab === "claimed") params.set("owner_id", ownerId);
      if (sourceType) params.set("source_type", sourceType);
      if (sourceBatch) params.set("source_batch", sourceBatch);
      for (const taskId of screeningTaskIds) params.append("ai_task_id", taskId);
      params.set("sort", sort);
      params.set("direction", direction);
      const body = await api(`/api/customers/public-pool?${params}`);
      if (version !== requestVersion.current) return;
      const nextCount = Number(body.count || 0);
      setRows(body.data || []);
      setCount(nextCount);
      setTabCounts((current) => ({ ...current, [tab]: nextCount }));
      setRole(body.role || "SALES");
      setSelected(new Set());
    } catch (caught) {
      if (version === requestVersion.current) setError(caught instanceof Error ? caught.message : "客户公海加载失败");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [
    aiLevel,
    aiStatus,
    appendIndustryFilters,
    customerStatus,
    ownerId,
    sourceType,
    sourceBatch,
    screeningTaskIds,
    page,
    pageSize,
    query,
    tab,
    target,
    sort,
    direction,
    focusedCustomerId,
  ]);
  useEffect(() => {
    const customerId = new URLSearchParams(window.location.search).get("customer") || "";
    if (customerId) setFocusedCustomerId(customerId);
  }, []);
  useEffect(() => {
    if (!focusedCustomerId || claim) return;
    const focused = rows.find((row) => row.id === focusedCustomerId);
    if (focused?.can_claim) setClaim(focused);
  }, [claim, focusedCustomerId, rows]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("public-pool-columns-available-v2") || "null");
      const normalized = normalizeCustomerListColumns(saved);
      const next = saved ? normalized : POOL_DEFAULT_FIELDS.available;
      setFields(next);
      setDraftFields(next);
    } catch {
      setFields(POOL_DEFAULT_FIELDS.available);
      setDraftFields(POOL_DEFAULT_FIELDS.available);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const loadTabCounts = useCallback(() => {
    api("/api/customers/public-pool?counts=1")
      .then((body) => setTabCounts(body || {}))
      .catch(() => undefined);
  }, []);
  useEffect(() => { loadTabCounts(); }, [loadTabCounts]);
  const refreshAssignmentHistory = useCallback(() => {
    setHistoryRefreshKey((value) => value + 1);
    void loadTabCounts();
  }, [loadTabCounts]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      if (newRef.current && !newRef.current.contains(targetNode)) setNewOpen(false);
      if (industryRef.current && !industryRef.current.contains(targetNode)) setIndustryOpen(false);
      if (screeningTaskRef.current && !screeningTaskRef.current.contains(targetNode)) setScreeningTaskOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (!["available", "claimed", "pending"].includes(tab)) return;
    api(`/api/customers/public-pool?tab=${tab}&options=1`)
      .then((body) =>
        setFilterOptions({
          industries: body.industries || [],
          owners: body.owners || [],
          sources: body.sources || [],
          batches: body.batches || [],
          screening_tasks: body.screening_tasks || [],
        }),
      )
      .catch(() =>
        setFilterOptions({ industries: [], owners: [], sources: [], batches: [], screening_tasks: [] }),
      );
  }, [tab]);
  useEffect(
    () => setPage(1),
    [aiLevel, aiStatus, customerStatus, industries, ownerId, query, screeningTaskIds, sourceBatch, sourceType, tab, target],
  );
  const visibleTabs = useMemo(() => {
    const base: Tab[] = ["available", "claimed"];
    if (role === "ADMIN")
      base.push("pending", "handover", "history", "renewals");
    else if (role === "SUPERVISOR") base.push("renewals");
    return base;
  }, [role]);
  function changeTab(value: Tab) {
    setTab(value);
    setError("");
    setSelected(new Set());
    setIndustries([]);
    setIndustryOpen(false);
    setOwnerId("");
    setCustomerStatus("");
    setSourceType("");
    setSourceBatch("");
    setScreeningTaskIds([]);
    setScreeningTaskOpen(false);
    if (value === "available" || value === "claimed" || value === "pending") {
      let next = POOL_DEFAULT_FIELDS[value];
      try {
        const saved = JSON.parse(localStorage.getItem(`public-pool-columns-${value}-v2`) || "null");
        if (saved) next = normalizeCustomerListColumns(saved, value === "claimed");
      } catch {}
      setFields(next);
      setDraftFields(next);
    }
    if (value === "history") void loadTabCounts();
  }
  function resetFilters() {
    setQuery("");
    setIndustries([]);
    setAiLevel("");
    setAiStatus("all");
    setTarget("");
    setCustomerStatus("");
    setOwnerId("");
    setSourceType("");
    setSourceBatch("");
    setScreeningTaskIds([]);
    setScreeningTaskOpen(false);
    setPage(1);
  }
  function changeSort(key: CustomerListColumn) {
    const next = customerListSortField(key);
    if (sort === next) setDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSort(next); setDirection("asc"); }
    setPage(1);
  }
  function moveDraftField(key: CustomerListColumn, offset: -1 | 1) {
    setDraftFields((current) => {
      const index = current.indexOf(key);
      const targetIndex = index + offset;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }
  async function exportData() {
    if (role !== "ADMIN" || exporting || !["available", "claimed", "pending"].includes(tab)) return;
    setExporting(true);
    setError("");
    try {
      const exported: PoolRow[] = [];
      for (let exportPage = 1; ; exportPage += 1) {
        const params = new URLSearchParams({ tab, page: String(exportPage), page_size: "100", sort, direction, export: "1" });
        if (query.trim()) params.set("q", query.trim());
        appendIndustryFilters(params);
        if (aiLevel) params.set("ai_level", aiLevel);
        if (target) params.set("target", target);
        if (customerStatus && tab === "claimed") params.set("status", customerStatus);
        if (ownerId && tab === "claimed") params.set("owner_id", ownerId);
        if (sourceType) params.set("source_type", sourceType);
        if (sourceBatch) params.set("source_batch", sourceBatch);
        for (const taskId of screeningTaskIds) params.append("ai_task_id", taskId);
        const body = await api(`/api/customers/public-pool?${params}`);
        const pageRows = Array.isArray(body.data) ? body.data as PoolRow[] : [];
        exported.push(...pageRows);
        if (pageRows.length < 100 || exported.length >= Number(body.count || 0)) break;
      }
      downloadCustomerWorkbook(exported as unknown as Array<Record<string, unknown>>, `客户公海-${tabLabels[tab]}`);
      setToast(`已导出当前筛选结果 ${exported.length} 条`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }
  async function selectAllResults() {
    if (role !== "ADMIN" || selectingAll || !["available", "claimed", "pending"].includes(tab)) return;
    setSelectingAll(true);
    setError("");
    try {
      const ids: string[] = [];
      for (let resultPage = 1; ; resultPage += 1) {
        const params = new URLSearchParams({ tab, page: String(resultPage), page_size: "100", sort, direction });
        if (query.trim()) params.set("q", query.trim());
        appendIndustryFilters(params);
        if (aiLevel) params.set("ai_level", aiLevel);
        if (aiStatus !== "all") params.set("ai_status", aiStatus);
        if (aiStatus !== "all") params.set("ai_status", aiStatus);
        if (target) params.set("target", target);
        if (customerStatus && tab === "claimed") params.set("status", customerStatus);
        if (ownerId && tab === "claimed") params.set("owner_id", ownerId);
        if (sourceType) params.set("source_type", sourceType);
        if (sourceBatch) params.set("source_batch", sourceBatch);
        for (const taskId of screeningTaskIds) params.append("ai_task_id", taskId);
        const body = await api(`/api/customers/public-pool?${params}`);
        const pageRows = Array.isArray(body.data) ? body.data as PoolRow[] : [];
        ids.push(...pageRows.map((row) => row.id));
        if (pageRows.length < 100 || ids.length >= Number(body.count || 0)) break;
      }
      setSelected(new Set(ids));
      setToast(ids.length ? `已选择当前筛选结果 ${ids.length} 家客户` : "当前筛选条件下没有客户");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "全选当前筛选结果失败");
    } finally {
      setSelectingAll(false);
    }
  }
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1680px]">
        <header>
          <div>
            <h2 className="text-2xl font-bold">客户公海</h2>
            <p className="mt-2 text-sm text-slate-500">
              待认领客户没有归属人；销售员提交真实联系凭证后完成认领，并进入“我的客户”。
            </p>
            <p className="mt-1 text-xs text-slate-400">
              “认领记录”仅用于查询历史公海客户的当前归属，非归属销售员只能查看脱敏信息；它不是可再次认领的客户列表。
            </p>
          </div>
        </header>
        <div className="mt-5">
          <AppTabs
            value={tab}
            items={visibleTabs.map((value) => ({
              value,
              label: tabLabels[value],
              description: tabDescriptions[value],
              count: value === "handover" ? undefined : tabCounts[value],
              countTone: value === "available" ? "success" : value === "renewals" || value === "pending" ? "warning" : value === "history" ? "success" : undefined,
            }))}
            onChange={changeTab}
            label="客户公海分类"
          />
        </div>
        {["available", "claimed", "pending"].includes(tab) ? (
          <>
            <section className="mt-4 rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <label className="relative w-[300px] shrink-0">
                  <Search
                    size={17}
                    className="absolute left-3 top-3 text-slate-400"
                  />
                  <input
                    name="public-pool-search"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索名称、联系人、国家/地区、电话、邮箱或链接"
                    className={`${appFieldClass} w-full min-w-0 pl-9`}
                  />
                </label>
                <div ref={industryRef} className="relative w-44 shrink-0">
                  <button type="button" onClick={() => setIndustryOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={industryOpen} className={`${appFieldClass} flex w-full items-center justify-between gap-2 text-left`}>
                    <span className="truncate">{industries.length ? `所属行业（${industries.length}）` : "全部所属行业"}</span><ChevronDown size={15} className="shrink-0 text-slate-400" />
                  </button>
                  {industryOpen ? <div role="listbox" aria-label="所属行业多选" className="absolute left-0 top-full z-40 mt-1 max-h-72 min-w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                    <button type="button" onClick={() => { setIndustries([]); setPage(1); }} className="mb-1 w-full rounded px-2 py-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50">清空行业选择</button>
                    {filterOptions.industries.map((item) => <label key={item.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={industries.includes(item.value)} onChange={() => { setIndustries((current) => current.includes(item.value) ? current.filter((value) => value !== item.value) : [...current, item.value]); setPage(1); }} /><span className={`min-w-0 break-words ${item.tone === "verified" ? "text-emerald-600" : "text-slate-600"}`}>{item.label}</span></label>)}
                  </div> : null}
                </div>
                <select
                  value={sourceType}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSourceType(next);
                    if (sourceBatch && next && !filterOptions.batches.some((item) => item.value === sourceBatch && item.source === next)) setSourceBatch("");
                  }}
                  className={`${appFieldClass} w-40 shrink-0`}
                  aria-label="按获客方式筛选"
                >
                  <option value="">全部获客方式</option>
                  {filterOptions.sources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <select
                  value={sourceBatch}
                  onChange={(event) => setSourceBatch(event.target.value)}
                  className={`${appFieldClass} w-44 shrink-0`}
                  aria-label="按导入批次筛选"
                >
                  <option value="">全部导入批次</option>
                  {filterOptions.batches.filter((item) => !sourceType || item.source === sourceType).map((item) => <option key={`${item.source}:${item.value}`} value={item.value}>{item.label}</option>)}
                </select>
                {role === "ADMIN" ? <div ref={screeningTaskRef} className="relative w-48 shrink-0">
                  <button type="button" onClick={() => setScreeningTaskOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={screeningTaskOpen} className={`${appFieldClass} flex w-full items-center justify-between gap-2 text-left`}>
                    <span className="truncate">{screeningTaskIds.length ? `AI筛选批次（${screeningTaskIds.length}）` : "全部AI筛选批次"}</span><ChevronDown size={15} className="shrink-0 text-slate-400" />
                  </button>
                  {screeningTaskOpen ? <div role="listbox" aria-label="AI筛选批次多选" className="absolute left-0 top-full z-40 mt-1 max-h-72 min-w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                    <button type="button" onClick={() => { setScreeningTaskIds([]); setPage(1); }} className="mb-1 w-full rounded px-2 py-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50">清空AI筛选批次</button>
                    {filterOptions.screening_tasks.map((item) => <label key={item.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={screeningTaskIds.includes(item.value)} onChange={() => { setScreeningTaskIds((current) => current.includes(item.value) ? current.filter((value) => value !== item.value) : [...current, item.value]); setPage(1); }} /><span className="min-w-0 break-words"><span className="block">{item.label}</span><small className="mt-0.5 block text-slate-400">该任务共 {item.customer_count} 条；仅加载当前页签内的客户</small></span></label>)}
                    {!filterOptions.screening_tasks.length ? <p className="px-2 py-3 text-sm text-slate-400">暂无可加载的历史AI筛选批次</p> : null}
                  </div> : null}
                </div> : null}
                <select
                  value={aiLevel}
                  onChange={(event) => setAiLevel(event.target.value)}
                  className={`${appFieldClass} w-36 shrink-0`}
                >
                  <option value="">全部AI等级</option>
                  {["A", "B", "C", "D"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className={`${appFieldClass} w-36 shrink-0`}
                >
                  <option value="">全部目标判断</option>
                  <option value="valid">有效目标</option>
                  <option value="invalid">无效目标</option>
                </select>
                <select
                  value={aiStatus}
                  onChange={(event) => setAiStatus(event.target.value as "all" | "done" | "pending" | "failed")}
                  className={`${appFieldClass} w-36 shrink-0`}
                  aria-label="AI分析状态"
                >
                  <option value="all">全部AI分析状态</option>
                  <option value="done">已分析</option>
                  <option value="pending">未分析</option>
                  <option value="failed">分析失败</option>
                </select>
                {tab === "claimed" ? <select
                  value={customerStatus}
                  onChange={(event) => setCustomerStatus(event.target.value)}
                  className={appFieldClass}
                  aria-label="筛选已认领客户的当前阶段"
                >
                  <option value="">全部已认领客户阶段</option>
                  <option value="CLAIMED">潜在客户</option>
                  <option value="FOLLOWING">意向客户</option>
                  <option value="QUOTE">报价中</option>
                  <option value="DEAL">已成交</option>
                  <option value="RELEASED">无效客户</option>
                </select> : null}
                {tab === "claimed" && ["ADMIN", "SUPERVISOR"].includes(role) ? (
                  <select
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    className={`${appFieldClass} w-40 shrink-0`}
                  >
                    <option value="">全部认领人</option>
                    {filterOptions.owners.map((value) => (
                      <option key={value.id} value={value.id}>
                        {displayUser(value)}
                      </option>
                    ))}
                  </select>
                ) : (
                  null
                )}
                <button
                  type="button"
                  onClick={resetFilters}
                  className="h-10 shrink-0 rounded-lg border bg-white px-4 text-sm hover:bg-slate-50"
                >
                  重置
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                {role === "ADMIN" ? <div ref={newRef} className="relative">
                  <button type="button" onClick={() => setNewOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                    <Plus size={16} className="shrink-0" />
                    <span className="leading-none">新增客户</span>
                    <ChevronDown size={15} className={`ml-0.5 shrink-0 transition-transform ${newOpen ? "rotate-180" : ""}`} />
                  </button>
                  {newOpen ? <div className="absolute left-0 top-11 z-40 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button type="button" onClick={() => { setNewOpen(false); setCreateOpen(true); }} className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-blue-50"><UserPlus size={20} className="mt-0.5 shrink-0 text-blue-600" /><span><span className="block text-sm font-medium">手动新增</span><small className="text-slate-500">新增后进入客户公海，暂不归属任何销售员</small></span></button>
                    <Link href="/import?destination=public" className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"><FileSpreadsheet size={20} className="mt-0.5 shrink-0 text-emerald-600" /><span><span className="block text-sm font-medium">批量导入</span><small className="text-slate-500">导入后进入客户公海，暂不归属任何销售员</small></span></Link>
                    <a href="/api/import/template" className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"><Download size={20} className="mt-0.5 shrink-0 text-blue-600" /><span><span className="block text-sm font-medium">下载导入模板</span><small className="text-slate-500">.xlsx · 含字段说明和示例数据</small></span></a>
                    <div className="border-t px-3 py-2 text-xs text-slate-400">请使用系统最新模板，勿修改第一行字段名称</div>
                  </div> : null}
                </div> : null}
                {role === "ADMIN" ? <button type="button" disabled={exporting} onClick={() => void exportData()} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50 disabled:opacity-50"><Download size={16} />{exporting ? "正在导出…" : "导出数据"}</button> : null}
                <button type="button" onClick={() => { setDraftFields(fields); setFieldOpen(true); }} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50"><Settings2 size={16} />字段设置</button>
                {role === "ADMIN" ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  <button type="button" disabled={selectingAll || !(count ?? 0)} onClick={() => (count ?? 0) > 0 && selected.size >= (count ?? 0) ? setSelected(new Set()) : void selectAllResults()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"><CheckCircle2 size={16}/>{selectingAll ? "正在全选…" : (count ?? 0) > 0 && selected.size >= (count ?? 0) ? "取消全选" : "全选筛选结果"}</button>
                  {["available", "pending"].includes(tab) ? <button disabled={!selected.size} type="button" onClick={() => setAssignOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"><UserPlus size={16}/>分配已选 {selected.size} 家</button> : null}
                  <button disabled={!selected.size} type="button" onClick={() => setDeleteIds([...selected])} className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40"><Trash2 size={16}/>删除已选 {selected.size} 家</button>
                </div> : null}
              </div>
            </section>
            {error ? (
              <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
                {error}
              </p>
            ) : null}
            <PoolTable
              rows={rows}
              loading={loading}
              fields={fields}
              sort={sort}
              direction={direction}
              changeSort={changeSort}
              canDelete={role === "ADMIN"}
              selected={selected}
              setSelected={setSelected}
              claim={setClaim}
              showSupplements={setSupplementRow}
              remove={(row) => setDeleteIds([row.id])}
            />
            <AppPagination
              page={page}
              pageSize={pageSize}
              total={count ?? 0}
              itemLabel="家客户"
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        ) : null}
        {tab === "renewals" ? (
          <RenewalReview role={role} toast={setToast} />
        ) : null}
        {tab === "handover" && role === "ADMIN" ? (
          <HandoverPanel toast={setToast} onHistoryChanged={refreshAssignmentHistory} />
        ) : null}
        {tab === "history" && role === "ADMIN" ? <AssignmentHistory refreshKey={historyRefreshKey} /> : null}
        {claim ? (
          <ClaimDialog
            row={claim}
            close={() => { setClaim(null); setFocusedCustomerId(""); window.history.replaceState(null, "", "/customers/pool?tab=available"); }}
            saved={(message) => {
              setClaim(null);
              setFocusedCustomerId("");
              setToast(message);
              void load();
            }}
          />
        ) : null}
        {supplementRow ? <SupplementDialog row={supplementRow} close={() => setSupplementRow(null)} /> : null}
        {assignOpen ? (
          <AssignDialog
            customerIds={[...selected]}
            close={() => setAssignOpen(false)}
            saved={(message) => {
              setAssignOpen(false);
              setToast(message);
              void load();
              refreshAssignmentHistory();
            }}
          />
        ) : null}
        {createOpen ? <AppDialog title="新增公海客户" description="仅系统管理员可执行；保存后客户无归属人并进入待认领列表。" onClose={() => setCreateOpen(false)} width="max-w-4xl"><CustomerForm destination="PUBLIC_POOL" onCancel={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); setToast("公海客户新增成功"); void load(); }}/></AppDialog> : null}
        {fieldOpen ? <AppDialog title="字段显示设置" description="当前公海分类独立保存字段与顺序，不影响我的客户和其他公海分类。" onClose={() => setFieldOpen(false)} width="max-w-md"><div className="max-h-[55vh] space-y-1 overflow-auto">{orderedFieldOptions.map((column) => <label key={column.key} className="flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={draftFields.includes(column.key)} onChange={() => setDraftFields((current) => current.includes(column.key) ? current.filter((item) => item !== column.key) : [...current, column.key])}/><span className="min-w-0 flex-1">{column.label}</span><button type="button" disabled={!draftFields.includes(column.key) || draftFields.indexOf(column.key) === 0} onClick={(event) => { event.preventDefault(); moveDraftField(column.key, -1); }} className="rounded p-1 disabled:opacity-30" title="上移"><ChevronUp size={14}/></button><button type="button" disabled={!draftFields.includes(column.key) || draftFields.indexOf(column.key) === draftFields.length - 1} onClick={(event) => { event.preventDefault(); moveDraftField(column.key, 1); }} className="rounded p-1 disabled:opacity-30" title="下移"><ChevronDown size={14}/></button></label>)}</div><div className="mt-4 flex items-center justify-between border-t pt-4"><button type="button" onClick={() => setDraftFields(POOL_DEFAULT_FIELDS[tab as "available" | "claimed" | "pending"] || CUSTOMER_LIST_DEFAULT_COLUMNS)} className="text-sm text-blue-600">恢复当前分类默认</button><div className="flex gap-2"><button type="button" onClick={() => setFieldOpen(false)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button type="button" onClick={() => { const next = draftFields.length ? draftFields : POOL_DEFAULT_FIELDS[tab as "available" | "claimed" | "pending"] || CUSTOMER_LIST_DEFAULT_COLUMNS; setFields(next); localStorage.setItem(`public-pool-columns-${tab}-v2`, JSON.stringify(next)); setFieldOpen(false); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">保存选择</button></div></div></AppDialog> : null}
        {deleteIds ? <PoolDeleteDialog customerIds={deleteIds} close={() => setDeleteIds(null)} saved={(message) => { setDeleteIds(null); setSelected(new Set()); setToast(message); void load(); }} /> : null}
        {toast ? (
          <div
            role="status"
            className="fixed bottom-6 right-6 z-[95] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl"
          >
            <CheckCircle2 size={17} className="text-emerald-400" />
            {toast}
            <button onClick={() => setToast("")}>
              <X size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function PoolTable({
  rows,
  loading,
  fields,
  sort,
  direction,
  changeSort,
  canDelete,
  selected,
  setSelected,
  claim,
  showSupplements,
  remove,
}: {
  rows: PoolRow[];
  loading: boolean;
  fields: CustomerListColumn[];
  sort: string;
  direction: "asc" | "desc";
  changeSort: (key: CustomerListColumn) => void;
  canDelete: boolean;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  claim: (row: PoolRow) => void;
  showSupplements: (row: PoolRow) => void;
  remove: (row: PoolRow) => void;
}) {
  const selectable = canDelete;
  const all = rows.length > 0 && rows.every((row) => selected.has(row.id));
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  return (
    <section className="mt-4 overflow-x-auto rounded-t-xl border bg-white shadow-sm">
      <table className="w-full min-w-[1080px] table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {selectable ? (
              <th className="sticky left-0 z-30 w-12 bg-slate-50 px-4 py-3">
                <input
                  aria-label="全选本页"
                  type="checkbox"
                  checked={all}
                  onChange={() =>
                    setSelected(
                      all ? new Set() : new Set(rows.map((row) => row.id)),
                    )
                  }
                />
              </th>
            ) : null}
            {fields.map((field) => <th key={field} className={`${field === "company_name" ? `sticky ${selectable ? "left-12" : "left-0"} z-20 w-56 bg-slate-50` : field === "country" || field === "ai_score" ? "w-28" : "w-36"} px-3 py-3`}><button type="button" onClick={() => changeSort(field)} className="inline-flex items-center gap-1 font-medium hover:text-blue-700" title="点击切换升序/降序">{CUSTOMER_LIST_COLUMNS.find((column) => column.key === field)?.label}<span className={`text-[10px] ${sort === customerListSortField(field) ? "text-blue-600" : "text-slate-300"}`}>{sort === customerListSortField(field) ? (direction === "asc" ? "▲" : "▼") : "↕"}</span></button></th>)}
            <th className="sticky right-0 z-30 w-28 bg-slate-50 px-3 py-3 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)]">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} onDoubleClick={event=>{if(row.can_open_customer&&canOpenListRow(event.target))window.location.assign(`/customers/${row.id}?from=pool`)}} className={`group hover:bg-blue-50/40 ${row.can_open_customer?"cursor-pointer":""}`}>
              {selectable ? (
                <td className="sticky left-0 z-20 bg-white px-4 py-4 group-hover:bg-blue-50">
                  <input
                    aria-label={`选择${row.company_name}`}
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </td>
              ) : null}
              {fields.map((field) => <td key={field} className={`max-w-64 overflow-hidden px-3 py-4 align-middle ${field === "company_name" ? `sticky ${selectable ? "left-12" : "left-0"} z-10 bg-white font-medium group-hover:bg-blue-50` : ""}`}><PoolValue row={row} field={field} showSupplements={showSupplements}/>{field === "company_name" && row.contact_masked ? <small className="mt-1 block text-amber-600">敏感信息已隐藏</small> : null}</td>)}
              <td className="sticky right-0 z-20 bg-white px-3 py-4 shadow-[-6px_0_10px_-10px_rgba(15,23,42,.45)] group-hover:bg-blue-50">
                <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                {row.can_open_customer ? <Link href={`/customers/${row.id}?from=pool`} className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" title={`查看${row.company_name}详情`} aria-label={`查看${row.company_name}详情`}>详情</Link> : null}
                {row.can_claim ? <button onClick={() => claim(row)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 transition hover:bg-blue-100">认领</button> : null}
                {!row.can_claim && !row.can_open_customer ? (
                  <span className="text-xs text-slate-400">已被认领</span>
                ) : null}
                {canDelete ? <button type="button" onClick={() => remove(row)} title="永久删除客户" aria-label={`永久删除${row.company_name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-rose-100 text-rose-600 hover:bg-rose-50"><Trash2 size={14}/></button> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loading ? (
        <div className="grid min-h-56 place-items-center text-slate-400">
          <LoaderCircle className="animate-spin text-blue-600" />
        </div>
      ) : !rows.length ? (
        <div className="grid min-h-56 place-items-center text-sm text-slate-400">
          当前分类暂无客户
        </div>
      ) : null}
    </section>
  );
}

function SupplementDialog({ row, close }: { row: PoolRow; close: () => void }) {
  const fieldLabels: Record<string, string> = { contact_name: "联系人", phone: "电话", whatsapp: "whatsapp", email: "邮箱", website: "官网", google_url: "Google Maps", address: "地址" };
  return <Modal title="我的补充资料" subtitle={`${row.company_name} · 仅您本人可见，不覆盖客户公海原始资料`} close={close}>
    <div className="grid gap-2 sm:grid-cols-2">{(row.my_supplements || []).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"><span className="block text-xs text-slate-500">{fieldLabels[item.field_name] || item.field_name}</span><span className="mt-1 block break-all text-slate-800">{item.value_raw}</span>{item.source_batch ? <small className="mt-2 block text-slate-400">{item.source_batch}{item.source_row ? ` · 第 ${item.source_row} 行` : ""}</small> : null}</div>)}</div>
  </Modal>;
}

function PoolDeleteDialog({customerIds,close,saved}:{customerIds:string[];close:()=>void;saved:(message:string)=>void}){
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(event:FormEvent){event.preventDefault();if(!reason.trim())return setError("请填写永久删除原因");setBusy(true);setError("");try{const body=await api("/api/customers/public-pool/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:customerIds,reason:reason.trim()})});const success=Number(body.success_count||0);const failed=Number(body.failed_count||0);if(!success)throw new Error(body.results?.find?.((item:{error?:string})=>item.error)?.error||"所选客户均未删除");saved(failed?`已永久删除 ${success} 家，${failed} 家因存在业务单据未删除`:`已永久删除 ${success} 家客户`)}catch(caught){setError(caught instanceof Error?caught.message:"删除失败")}finally{setBusy(false)}}
  return <AppDialog title="永久删除公海客户" description={`将永久删除所选 ${customerIds.length} 家客户。已有报价或订单的客户会被系统阻止删除。`} onClose={()=>!busy&&close()} width="max-w-md"><form onSubmit={submit}><div className="rounded-xl bg-rose-50 p-4 text-sm leading-6 text-rose-800">此操作不可恢复。系统不会根据AI低分自动删除，只有您明确选择并确认的客户才会被处理。</div><label className="mt-4 block"><span className="mb-1.5 block text-sm font-medium text-slate-700">删除原因</span><textarea required rows={4} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} placeholder="例如：重复测试数据、确认无效且无需保留" className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"/></label>{error?<p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}<SharedDialogActions busy={busy} onCancel={close} confirmLabel="确认永久删除" tone="danger"/></form></AppDialog>
}

function ClaimDialog({
  row,
  close,
  saved,
}: {
  row: PoolRow;
  close: () => void;
  saved: (message: string) => void;
}) {
  const [channel, setChannel] = useState("WHATSAPP");
  const [result, setResult] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError("请上传真实联系凭证");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("customer_id", row.id);
    form.set("channel", channel);
    form.set("result", result);
    form.set("next_plan", nextPlan);
    form.set("file", file);
    try {
      const body = await api("/api/customers/public-pool/claim", {
        method: "POST",
        body: form,
      });
      saved(body.message || "认领成功");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "认领失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="认领客户"
      subtitle={`${row.company_name} · 提交真实首次联系凭证后，开始90天保护期`}
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        {row.my_supplements?.length ? <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3"><div className="mb-2 flex items-center justify-between"><b className="text-sm text-slate-800">我的补充资料</b><span className="text-xs text-blue-700">仅自己可见 · 不覆盖公海原资料</span></div><div className="grid gap-2 sm:grid-cols-2">{row.my_supplements.map((item)=><div key={item.id} className="rounded-lg bg-white px-3 py-2 text-sm"><span className="mr-2 text-slate-500">{{contact_name:"联系人",phone:"电话",whatsapp:"whatsapp",email:"邮箱",website:"官网",google_url:"Google Maps",address:"地址"}[item.field_name]||item.field_name}</span><span className="break-all text-slate-800">{item.value_raw}</span>{item.source_batch?<small className="mt-1 block text-slate-400">{item.source_batch}{item.source_row?` · 第 ${item.source_row} 行`:""}</small>:null}</div>)}</div></section>:null}
        <label className="block text-sm font-medium">
          首次联系渠道 <span className="text-rose-600">*</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className={`${field} mt-2 w-full`}
          >
            <option value="WHATSAPP">whatsapp</option>
            <option value="EMAIL">邮件</option>
            <option value="PHONE">电话</option>
            <option value="LINKEDIN">LinkedIn</option>
            <option value="OTHER">其他</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          真实联系结果 <span className="text-rose-600">*</span>
          <select required value={result} onChange={(e) => setResult(e.target.value)} className={`${field} mt-2 w-full`}>
            <option value="">请选择</option><option value="未回复">未回复</option><option value="已回复，待确认需求">已回复，待确认需求</option><option value="明确有需求">明确有需求</option><option value="明确无需求">明确无需求</option><option value="联系方式无效">联系方式无效</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          下一步计划 <span className="font-normal text-slate-400">（选填）</span>
          <textarea
            value={nextPlan}
            onChange={(e) => setNextPlan(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border p-3 text-sm"
            placeholder="可选；不填则系统标记为待首次跟进"
          />
        </label>
        <EvidenceInput file={file} setFile={setFile} />
        {!result || !file ? <p className="text-xs text-amber-700">请先选择真实联系结果并上传联系凭证，才能确认认领。</p> : null}
        {error ? <ErrorText value={error} /> : null}
        <DialogActions busy={busy} disabled={!result||!file} close={close} label="确认认领" />
      </form>
    </Modal>
  );
}

function AssignDialog({
  customerIds,
  close,
  saved,
}: {
  customerIds: string[];
  close: () => void;
  saved: (message: string) => void;
}) {
  const [options, setOptions] = useState<AssignmentOptions>({
    assignees: [],
    inactive_users: [],
  });
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/admin/customer-assignments")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = await api("/api/admin/customer-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ASSIGN",
          customer_ids: customerIds,
          target_user_id: target,
          batch_name: name,
          reason,
        }),
      });
      saved(`${body.message}（${body.data?.batch_number || "已生成批次"}）`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分配失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="管理员分配公海客户"
      subtitle={`已选择 ${customerIds.length} 家；只允许分配当前无归属的客户`}
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          接收销售员
          <select
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${field} mt-2 w-full`}
          >
            <option value="">请选择</option>
            {options.assignees.map((user) => (
              <option key={user.id} value={user.id}>
                {displayUser(user)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          分配批次名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${field} mt-2 w-full`}
            placeholder="如：9月德国维修客户分配"
          />
        </label>
        <label className="block text-sm font-medium">
          分配原因
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border p-3 text-sm"
          />
        </label>
        {error ? <ErrorText value={error} /> : null}
        <DialogActions busy={busy} close={close} label="确认分配" />
      </form>
    </Modal>
  );
}

function HandoverPanel({ toast, onHistoryChanged }: { toast: (value: string) => void; onHistoryChanged: () => void }) {
  const [options, setOptions] = useState<AssignmentOptions>({
    assignees: [],
    inactive_users: [],
  });
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"ASSIGN" | "RELEASE">("ASSIGN");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const load = useCallback(
    () =>
      api("/api/admin/customer-assignments")
        .then(setOptions)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const sourceRow = options.inactive_users.find((user) => user.id === source);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setConfirmOpen(true);
  }
  async function executeHandover() {
    setBusy(true);
    setError("");
    try {
      const body = await api("/api/admin/customer-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "HANDOVER",
          source_user_id: source,
          target_user_id: target,
          mode,
          batch_name: name,
          reason,
        }),
      });
      toast(`${body.message}（${body.data?.batch_number || "已生成批次"}）`);
      setSource("");
      setTarget("");
      setReason("");
      setConfirmOpen(false);
      void load();
      onHistoryChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "交接失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <ArchiveRestore className="mt-0.5 text-blue-600" />
        <div>
          <h3 className="font-semibold">停用/离职账号客户交接</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            在职账号的客户不能被强制转走。仅停用或离职账号可整体移交；报价、订单和备货责任一并移交，历史操作人仍保留。
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-4 xl:grid-cols-2">
        <label className="text-sm font-medium">
          原归属人
          <select
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={`${field} mt-2 w-full`}
          >
            <option value="">选择停用/离职账号</option>
            {options.inactive_users.map((user) => (
              <option key={user.id} value={user.id}>
                {displayUser(user)} ·{" "}
                {user.status === "DEPARTED" ? "已离职" : "已停用"} ·{" "}
                {user.customer_count}家
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          处理方式
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "ASSIGN" | "RELEASE")}
            className={`${field} mt-2 w-full`}
          >
            <option value="ASSIGN">整体交接给指定销售员</option>
            <option value="RELEASE">释放普通客户进入公海；活动业务单据进入待分配</option>
          </select>
        </label>
        {mode === "ASSIGN" ? (
          <label className="text-sm font-medium">
            接收人
            <select
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={`${field} mt-2 w-full`}
            >
              <option value="">请选择已启用销售员</option>
              {options.assignees
                .filter((user) => user.id !== source)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {displayUser(user)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="text-sm font-medium">
          交接批次名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${field} mt-2 w-full`}
            placeholder="如：张三离职客户交接"
          />
        </label>
        <label className="text-sm font-medium xl:col-span-2">
          交接原因
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border p-3 text-sm"
          />
        </label>
        {error ? (
          <div className="xl:col-span-2">
            <ErrorText value={error} />
          </div>
        ) : null}
        <div className="xl:col-span-2">
          <button
            disabled={busy}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "处理中…" : "确认生成交接批次"}
          </button>
        </div>
      </form>
      <ConfirmDialog open={confirmOpen} title="确认客户交接？" description={`将处理 ${sourceRow?.customer_count || 0} 家客户及其关联报价、订单和备货责任，并生成不可删除的交接批次。历史操作人和审计记录会保留。`} confirmLabel="确认执行交接" busy={busy} onCancel={()=>setConfirmOpen(false)} onConfirm={()=>void executeHandover()}/>
    </section>
  );
}

function RenewalReview({
  role,
  toast,
}: {
  role: Role;
  toast: (value: string) => void;
}) {
  const [rows, setRows] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{row: Renewal; decision: "APPROVED" | "REJECTED"}|null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const owners = useMemo(() => {
    const seen = new Map<string, Owner>();
    for (const row of rows) if (row.owner?.id) seen.set(row.owner.id, row.owner);
    return [...seen.values()].sort((left, right) => displayUser(left).localeCompare(displayUser(right), "zh-CN"));
  }, [rows]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => (!ownerId || row.owner?.id === ownerId) && (!needle || [row.customer?.company_name, row.customer?.country, row.owner?.name, row.owner?.email, row.reason, row.next_plan].some((value) => String(value || "").toLowerCase().includes(needle))));
  }, [ownerId, rows, search]);
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize],
  );
  useEffect(() => setPage(1), [ownerId, search]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api(
        "/api/customers/protection/renewals?status=PENDING",
      );
      setRows(body.data || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function decide() {
    if (!review || (review.decision === "REJECTED" && !reviewNote.trim())) return;
    setReviewBusy(true);
    try {
      const body = await api("/api/customers/protection/renewals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: review.row.id,
          decision: review.decision,
          review_note: reviewNote.trim(),
        }),
      });
      toast(body.message);
      setReview(null);
      setReviewNote("");
      void load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审核失败");
    } finally {
      setReviewBusy(false);
    }
  }
  return (
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
      <header className="border-b p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="text-blue-600" />
          客户续期审批
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          {role === "SUPERVISOR"
            ? "仅显示直属销售员第3次及以后的申请。"
            : "显示所有待审核申请；通常由直属主管优先处理。"}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <label className="relative w-[320px] shrink-0"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索客户、国家/地区、申请人或申请内容" className={`${appFieldClass} w-full pl-9`}/></label>
        <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className={`${appFieldClass} w-56 shrink-0`}><option value="">全部申请人</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{displayUser(owner)}</option>)}</select>
        <button type="button" onClick={() => { setSearch(""); setOwnerId(""); }} className="h-10 shrink-0 rounded-lg border px-3 text-sm hover:bg-slate-50">重置</button>
      </div>
      {error ? (
        <div className="m-5">
          <ErrorText value={error} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {[
                "客户",
                "申请人",
                "续期次数",
                "本次结果",
                "下一步计划",
                "凭证",
                "申请时间",
                "操作",
              ].map((value) => (
                <th
                  key={value}
                  className="px-4 py-3 font-medium text-slate-500"
                >
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-4 font-medium">
                  {row.customer?.company_name || "—"}
                </td>
                <td className="px-4 py-4">{displayUser(row.owner)}</td>
                <td className="px-4 py-4">第 {row.renewal_number} 次</td>
                <td className="max-w-64 px-4 py-4">{row.reason}</td>
                <td className="max-w-64 px-4 py-4">{row.next_plan}</td>
                <td className="px-4 py-4"><AttachmentPreview attachment={{ id: row.evidence_attachment_id, filename: "续期凭证", mime_type: null }} /></td>
                <td className="px-4 py-4">{formatDate(row.created_at)}</td>
                <td className="px-4 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setReview({ row, decision: "APPROVED" }); setReviewNote(""); }}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white"
                    >
                      通过
                    </button>
                    <button
                      onClick={() => { setReview({ row, decision: "REJECTED" }); setReviewNote(""); }}
                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-600"
                    >
                      驳回
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <div className="grid min-h-52 place-items-center">
            <LoaderCircle className="animate-spin text-blue-600" />
          </div>
      ) : !filteredRows.length ? (
          <div className="grid min-h-52 place-items-center text-sm text-slate-400">
            暂无待审核续期申请
          </div>
        ) : null}
      </div>
      <AppPagination
        page={page}
        pageSize={pageSize}
        total={filteredRows.length}
        itemLabel="条申请"
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      <AppDialog open={Boolean(review)} title={review?.decision === "APPROVED" ? "通过续期申请" : "驳回续期申请"} description={review ? `${review.row.customer?.company_name || "客户"} · 第 ${review.row.renewal_number} 次续期` : undefined} onClose={()=>setReview(null)} width="max-w-md">
        <label className="text-sm font-medium text-slate-700">{review?.decision === "REJECTED" ? "驳回原因（必填）" : "审核备注（可选）"}<textarea autoFocus value={reviewNote} onChange={event=>setReviewNote(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm" placeholder={review?.decision === "REJECTED" ? "请填写明确的驳回原因" : "可记录凭证核验情况"}/></label>
        <form onSubmit={event=>{event.preventDefault();void decide()}}><SharedDialogActions busy={reviewBusy} onCancel={()=>setReview(null)} confirmLabel={review?.decision === "APPROVED" ? "确认通过" : "确认驳回"} tone={review?.decision === "REJECTED" ? "danger" : "primary"}/></form>
      </AppDialog>
    </section>
  );
}

function AssignmentHistory({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<History[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [count, setCount] = useState(0);
  const [users, setUsers] = useState<Owner[]>([]);
  const [search, setSearch] = useState("");
  const [historyType, setHistoryType] = useState("");
  const [sourceUserId, setSourceUserId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ mode: "history", page: String(page), page_size: String(pageSize) });
    if (search.trim()) params.set("q", search.trim());
    if (historyType) params.set("history_type", historyType);
    if (sourceUserId) params.set("source_user_id", sourceUserId);
    if (targetUserId) params.set("target_user_id", targetUserId);
    if (createdBy) params.set("created_by", createdBy);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    setLoading(true);
    setError("");
    api(`/api/admin/customer-assignments?${params}`)
      .then((body) => { setRows(body.data || []); setCount(Number(body.count || 0)); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, pageSize, search, historyType, sourceUserId, targetUserId, createdBy, dateFrom, dateTo, refreshKey]);
  useEffect(() => {
    api("/api/admin/customer-assignments?mode=history_options")
      .then((body) => setUsers(body.users || []))
      .catch(() => setUsers([]));
  }, []);
  useEffect(() => { setPage(1); }, [search, historyType, sourceUserId, targetUserId, createdBy, dateFrom, dateTo]);
  const reset = () => {
    setSearch(""); setHistoryType(""); setSourceUserId(""); setTargetUserId("");
    setCreatedBy(""); setDateFrom(""); setDateTo(""); setPage(1);
  };
  return (
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
      <header className="border-b p-5">
        <h3 className="font-semibold">客户分配明细与交接记录</h3>
        <p className="mt-1 text-sm text-slate-500">
          每条记录对应一位实际被分配客户；保留分配时的原归属人、接收人和操作人，并显示客户当前归属，便于逐条核对。
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <label className="relative w-[320px] shrink-0"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索客户、电话、邮箱、批次或分配原因" className={`${appFieldClass} w-full pl-9`}/></label>
        <select value={historyType} onChange={(event) => setHistoryType(event.target.value)} className={`${appFieldClass} w-40 shrink-0`} aria-label="筛选记录类型"><option value="">全部记录类型</option><option value="ASSIGN">客户分配</option><option value="HANDOVER">账号交接</option><option value="RELEASE">批量释放</option></select>
        <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} className={`${appFieldClass} w-40 shrink-0`} aria-label="筛选接收人"><option value="">全部接收人</option>{users.map((user) => <option key={user.id} value={user.id}>{displayUser(user)}</option>)}</select>
        <select value={sourceUserId} onChange={(event) => setSourceUserId(event.target.value)} className={`${appFieldClass} w-40 shrink-0`} aria-label="筛选原归属人"><option value="">全部原归属人</option>{users.map((user) => <option key={user.id} value={user.id}>{displayUser(user)}</option>)}</select>
        <select value={createdBy} onChange={(event) => setCreatedBy(event.target.value)} className={`${appFieldClass} w-40 shrink-0`} aria-label="筛选操作人"><option value="">全部操作人</option>{users.map((user) => <option key={user.id} value={user.id}>{displayUser(user)}</option>)}</select>
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`${appFieldClass} w-36 shrink-0`} aria-label="开始日期" title="开始日期"/>
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`${appFieldClass} w-36 shrink-0`} aria-label="结束日期" title="结束日期"/>
        <button type="button" onClick={reset} className="h-10 shrink-0 rounded-lg border bg-white px-4 text-sm hover:bg-slate-50">重置</button>
      </div>
      {error ? (
        <div className="m-5">
          <ErrorText value={error} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1560px] text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {[
                "客户信息",
                "分配批次",
                "类型",
                "原归属人",
                "接收人",
                "当前归属",
                "操作人",
                "分配时间",
                "原因",
                "操作",
              ].map((value) => (
                <th
                  key={value}
                  className="px-4 py-3 font-medium text-slate-500"
                >
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-4"><b className="block font-medium">{row.customer?.company_name || "—"}</b><small className="mt-1 block text-slate-500">{row.customer?.country || "—"}{row.customer?.phone ? ` · ${row.customer.phone}` : ""}</small><small className="block text-slate-400">{row.customer?.email || row.customer?.address || "—"}</small></td>
                <td className="px-4 py-4"><span className="block font-mono text-xs text-blue-700">{row.batch_number}</span><small className="mt-1 block text-slate-500">{row.batch_name}</small></td>
                <td className="px-4 py-4">
                  {row.reason_type === "ACCOUNT_HANDOVER"
                    ? "账号交接"
                    : row.mode === "RELEASE"
                      ? "批量释放"
                      : "客户分配"}
                </td>
                <td className="px-4 py-4">{displayUser(row.previous_owner || row.source)}</td>
                <td className="px-4 py-4">{displayUser(row.next_owner || row.target)}</td>
                <td className="px-4 py-4">{displayUser(row.current_owner)}</td>
                <td className="px-4 py-4">{displayUser(row.creator)}</td>
                <td className="px-4 py-4">{formatDate(row.created_at)}</td>
                <td className="max-w-72 px-4 py-4">
                  <span className="line-clamp-2">{row.reason}</span>
                </td>
                <td className="px-4 py-4"><Link href={`/customers/${row.customer_id}?from=pool`} className="font-medium text-blue-600">查看客户</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <div className="grid min-h-52 place-items-center">
            <LoaderCircle className="animate-spin text-blue-600" />
          </div>
        ) : !rows.length ? (
          <div className="grid min-h-52 place-items-center text-sm text-slate-400">
            暂无分配记录
          </div>
        ) : null}
      </div>
      <AppPagination
        page={page}
        pageSize={pageSize}
        total={count}
        itemLabel="条记录"
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
}

function EvidenceInput({
  file,
  setFile,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
}) {
  return (
    <label className="block rounded-xl border border-dashed p-4 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <Paperclip size={17} />
        真实联系凭证 <span className="text-rose-600">*</span>
      </span>
      <input
        required
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(event) => setFile(event.target.files?.[0] || null)}
        className="mt-3 block w-full text-sm"
      />
      <small className="mt-2 block text-slate-500">
        {file ? `已选择：${file.name}` : "支持 JPG、PNG、WebP、PDF，最大15MB"}
      </small>
    </label>
  );
}
function DialogActions({
  busy,
  disabled = false,
  close,
  label,
}: {
  busy: boolean;
  disabled?: boolean;
  close: () => void;
  label: string;
}) {
  return (
    <SharedDialogActions busy={busy} disabled={disabled} onCancel={close} confirmLabel={label} />
  );
}
function ErrorText({ value }: { value: string }) {
  return (
    <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{value}</p>
  );
}
function Modal({
  title,
  subtitle,
  close,
  children,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <AppDialog title={title} description={subtitle} onClose={close}>
      {children}
    </AppDialog>
  );
}
