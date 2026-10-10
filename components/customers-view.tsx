"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canOpenListRow } from "@/lib/ui/list-row-navigation";
import {
  Download,
  ChevronDown,
  ChevronUp,
  Eye,
  FileSpreadsheet,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { Customer, CustomerStatus } from "@/lib/types";
import { FOLLOWUP_STAGE_LABELS, FOLLOWUP_STAGES, type FollowupStage } from "@/lib/types";
import { CountryLabel } from "@/components/country-label";
import { ImportBatchMultiSelect, type ImportBatchOption } from "@/components/import-batch-multi-select";
import { CustomerConflictsPanel, CustomerProtectionPanel } from "@/components/customer-workspace-panels-v2";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { AppTabs } from "@/components/ui/app-tabs";
import { AppPagination } from "@/components/ui/app-pagination";
import { RowActionItem, RowActionMenu } from "@/components/ui/row-action-menu";
import { CustomerPublicLink } from "@/components/ui/customer-public-link";
import { CustomerContactSummary } from "@/components/customer-contact-summary";
import { CustomerScoreBadge } from "@/components/customer-score-badge";
import { CustomerPublicChannels } from "@/components/customer-public-channels";
import { SearchableMultiSelectFilter, type SearchableFilterOption } from "@/components/ui/searchable-multi-select-filter";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { customerListText, customerProtectionText, downloadCustomerWorkbook, type CustomerExportColumn } from "@/lib/customer-export";
import {
  CUSTOMER_LIST_COLUMNS,
  CUSTOMER_LIST_COLUMN_STORAGE_KEY,
  CUSTOMER_LIST_DEFAULT_COLUMNS,
  customerListSortField,
  normalizeCustomerListColumns,
} from "@/lib/customers/list-fields";
import { customerIndustryDisplay } from "@/lib/customers/industry-display";
import { customerSourceLabel } from "@/lib/customers/source-display";
import { displayCustomerName } from "@/lib/customer-display";
import { countryInfo } from "@/lib/countries";

type CustomerWorkspace = "list" | "protection" | "conflicts";

const stageLabels: Record<CustomerStatus, string> = {
  UNCLAIMED: "待认领",
  CLAIMED: "潜在客户",
  FOLLOWING: "意向客户",
  QUOTE: "意向客户",
  DEAL: "成交客户",
  RELEASED: "历史释放状态",
};
const stageClass: Record<CustomerStatus, string> = {
  UNCLAIMED: "bg-slate-100 text-slate-700",
  CLAIMED: "bg-blue-50 text-blue-700",
  FOLLOWING: "bg-indigo-50 text-indigo-700",
  QUOTE: "bg-orange-50 text-orange-700",
  DEAL: "bg-emerald-50 text-emerald-700",
  RELEASED: "bg-slate-100 text-slate-500",
};
type ColumnKey = CustomerExportColumn;
const columns = CUSTOMER_LIST_COLUMNS;
const defaults = CUSTOMER_LIST_DEFAULT_COLUMNS;
const listColumnWidth: Partial<Record<ColumnKey, string>> = {
  company_name: "w-48",
  ai_score: "w-20",
  industry: "w-36",
  country: "w-24",
  phone: "w-64",
  email: "w-52",
  verified_contacts: "w-52",
  website: "w-36",
  google_url: "w-40",
  status: "w-28",
  followup_status: "w-28",
  last_contact_time: "w-32",
  protection: "w-28",
  source: "w-32",
  updated_at: "w-36",
};
function Score({ customer }: { customer: Customer }) {
  return <CustomerScoreBadge score={customer.ai_score} level={customer.ai_level}/>;
}
function ProtectionRemaining({ customer }: { customer: Customer }) {
  const text = customerProtectionText(customer);
  const days = Number(text.match(/\d+/)?.[0] || 0);
  if (!days) return <span className="text-slate-400">{text}</span>;
  return <span className={days <= 7 ? "font-medium text-rose-600" : days <= 30 ? "font-medium text-amber-600" : "text-emerald-600"}>{text}</span>;
}
function value(customer: Customer, key: ColumnKey) {
  if (key === "protection") return <ProtectionRemaining customer={customer} />;
  return customerListText(customer, key);
}
function releaseNotice(status: CustomerStatus) {
  if (status === "FOLLOWING") return "该客户已有意向与跟进投入。请确认已记录最终处理结果；释放后客户会回到公海，其他销售员可认领。";
  if (status === "QUOTE") return "该客户可能关联业务单据。若存在已发送/确认报价或未取消订单，系统将拒绝释放；请先按业务单据流程完成处理。";
  return "释放后客户进入公海待认领，保护期立即结束；其他销售员可凭真实联系凭证认领。";
}
function releaseNeedsAcknowledgement(status: CustomerStatus) { return status === "FOLLOWING" || status === "QUOTE"; }

export function CustomersView() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<CustomerWorkspace>("list");
  const [protectionCount, setProtectionCount] = useState<number | null>(null);
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  const [rows, setRows] = useState<Customer[]>([]);
  const [count, setCount] = useState(0);
  const [totalCustomerCount, setTotalCustomerCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reportUtc, setReportUtc] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<{countries:SearchableFilterOption[];industries:SearchableFilterOption[]}>({countries:[],industries:[]});
  const [sourceBatches, setSourceBatches] = useState<string[]>([]);
  const [sourceType, setSourceType] = useState("");
  const [batchOptions, setBatchOptions] = useState<ImportBatchOption[]>([]);
  const [status, setStatus] = useState("");
  const [followupStatus, setFollowupStatus] = useState("");
  const [level, setLevel] = useState("");
  const [target, setTarget] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [defaultScopeUserId, setDefaultScopeUserId] = useState("");
  const [scopeReady, setScopeReady] = useState(false);
  const [currentRole, setCurrentRole] = useState("");
  const [userOptions, setUserOptions] = useState<Array<{id:string;name:string;email:string}>>([]);
  const [canViewAll, setCanViewAll] = useState(false);
  const [canExport, setCanExport] = useState(false);
  // 默认展示全部在库客户；用户可按 AI 分析状态主动缩小范围。
  const [aiFilter, setAiFilter] = useState<"done" | "pending" | "failed" | "all">("all");
  const [sort, setSort] = useState("updated_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, setProtectedSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Customer | null>(null);
  const [fields, setFields] = useState<ColumnKey[]>(defaults);
  const [draft, setDraft] = useState<ColumnKey[]>(defaults);
  const [draggedField, setDraggedField] = useState<ColumnKey | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<Customer | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseAcknowledged, setReleaseAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const ordered = draft.map((key) => byKey.get(key)).filter((column): column is (typeof columns)[number] => Boolean(column));
    columns.forEach((column) => { if (!draft.includes(column.key)) ordered.push(column); });
    return ordered;
  }, [draft]);
  function moveDraftField(key: ColumnKey, direction: -1 | 1) {
    setDraft((current) => {
      const index = current.indexOf(key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(CUSTOMER_LIST_COLUMN_STORAGE_KEY) || localStorage.getItem("customer-columns-v5") || "null",
      );
      if (Array.isArray(saved) && saved.length) {
        const normalized = normalizeCustomerListColumns(saved);
        setFields(normalized);
        setDraft(normalized);
        localStorage.setItem(CUSTOMER_LIST_COLUMN_STORAGE_KEY, JSON.stringify(normalized));
      }
    } catch {}
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    setWorkspace(tab === "protection" || tab === "conflicts" ? tab : "list");
    setSearch(params.get("search") || "");
    setFromDate(params.get("from") || "");
    setToDate(params.get("to") || "");
    setReportUtc(params.get("report_utc") === "1");
    setCountries([...new Set(params.getAll("country").map((value) => countryInfo(value.trim()).code || value.trim()).filter(Boolean))]);
    setIndustries(params.getAll("industry").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean));
    setSourceBatches(params.getAll("source_batch").map((value) => value.trim()).filter(Boolean));
    setSourceType(params.get("source_type") || "");
    setStatus(params.get("status") || "");
    setFollowupStatus(params.get("followup_status") || "");
    setLevel(params.get("ai_level") || "");
    setTarget(params.get("target") || "");
    setScopeUserId(params.get("user_id") || "");
    setAiFilter(params.get("ai_status") === "pending" ? "pending" : params.get("ai_status") === "failed" ? "failed" : params.get("ai_status") === "done" ? "done" : "all");
    setSort(params.get("sort") || "updated_at");
    setDirection(params.get("direction") === "asc" ? "asc" : "desc");
  }, []);
  useEffect(() => {
    const label = workspace === "protection" ? "保护到期与续期" : workspace === "conflicts" ? "冲突客户" : "我的客户";
    window.dispatchEvent(new CustomEvent("dtsmart-page-title", { detail: `客户管理 / ${label}` }));
  }, [workspace]);
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
    if (workspace !== "list" || !scopeReady) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      search,
      status,
      ai_level: level,
      target,
      followup_status: followupStatus,
      ai_status: aiFilter,
      deleted: "false",
      sort,
      direction,
    });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (reportUtc) params.set("report_utc", "1");
    if (scopeUserId) params.set("user_id", scopeUserId);
    countries.forEach((country) => params.append("country", country));
    industries.forEach((industry) => params.append("industry", industry));
    sourceBatches.forEach((batch) => params.append("source_batch", batch));
    if (sourceType) params.set("source_type", sourceType);
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
    fromDate,
    toDate,
    reportUtc,
    countries,
    industries,
    sourceBatches,
    sourceType,
    status,
    level,
    target,
    followupStatus,
    aiFilter,
    sort,
    direction,
    workspace,
    scopeUserId,
    scopeReady,
  ]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    fetch("/api/users/options?permission=customers.data_all").then((response) => response.json()).then((body) => {
      const role = String(body?.profile?.role || "SALES");
      const elevated = Boolean(body?.can_select_owner);
      const fallback = String(body?.profile?.id || "");
      const requested = new URLSearchParams(window.location.search).get("user_id") || fallback;
      const initialScope = role === "ADMIN" ? requested : elevated && requested !== "all" ? requested : fallback;
      setCurrentRole(role);
      setDefaultScopeUserId(fallback);
      setScopeUserId(initialScope);
      setCanViewAll(elevated);
      setCanExport(role === "ADMIN" || (Array.isArray(body?.profile?.permissions) && body.profile.permissions.includes("customers.export")));
      setUserOptions(elevated && Array.isArray(body.users) ? body.users : []);
      if (elevated) {
        setFields((current) => current.includes("owner") ? current : [...current, "owner"]);
        setDraft((current) => current.includes("owner") ? current : [...current, "owner"]);
      }
      setScopeReady(true);
    }).catch(() => setScopeReady(true));
  }, []);
  useEffect(() => {
    if (!scopeReady) return;
    let disposed = false;
    setTotalCustomerCount(null);
    setProtectionCount(null);
    setConflictCount(null);
    const scope = scopeUserId ? `&user_id=${encodeURIComponent(scopeUserId)}` : "";
    void Promise.all([
      fetch(`/api/customers?page=1&pageSize=1&ai_status=all&deleted=false${scope}`).then((response) => response.json()).then((body) => { if (!disposed) setTotalCustomerCount(Number(body.count ?? 0)); }),
      fetch(`/api/customers?options=filters${scope}`).then((response) => response.json()).then((body) => { if (!disposed) setFilterOptions({countries:Array.isArray(body.countries)?body.countries:[],industries:Array.isArray(body.industries)?body.industries:[]}); }),
      fetch(`/api/customers?options=batches${scope}`).then((response) => response.json()).then((body) => { if (!disposed) setBatchOptions(Array.isArray(body.data) ? body.data : []); }),
      fetch(`/api/customers/protection?summary=1${scope}`).then((response) => response.json()).then((body) => { if (!disposed) setProtectionCount(Number(body.count ?? 0)); }),
      fetch(`/api/customer-conflicts?summary=1${scope}`).then((response) => response.json()).then((body) => { if (!disposed) setConflictCount(Number(body.count ?? 0)); }),
    ]).catch(() => undefined);
    return () => { disposed = true; };
  }, [scopeReady, scopeUserId]);
  const allPage = rows.length > 0 && rows.every((row) => selected.has(row.id));
  // 主管查看下属客户时保持只读；系统管理员拥有全系统客户的完整管理权限，
  // 不能因为切换了归属人筛选就被误判为跨用户只读。
  const crossUserReadOnly = currentRole !== "ADMIN" && canViewAll && scopeUserId !== defaultScopeUserId;
  function switchWorkspace(next: CustomerWorkspace) {
    setWorkspace(next);
    // 每个客户工作区首次进入都以本人为默认范围；主管和系统管理员
    // 只有主动使用归属人/提交人筛选时才查看其他用户的数据。
    if (defaultScopeUserId) setScopeUserId(defaultScopeUserId);
    setSelected(new Set());
    setProtectedSelected(new Set());
    const url = next === "list" ? "/customers" : `/customers?tab=${next}`;
    window.history.replaceState(null, "", url);
  }
  const sortableField = customerListSortField;
  function changeSort(key: ColumnKey) {
    const next = sortableField(key);
    if (sort === next) setDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSort(next); setDirection("asc"); }
    setPage(1);
  }
  const activeFilters = useMemo(
    () =>
      [
        search ? { key: "search", label: `关键词：${search}` } : null,
        fromDate || toDate ? { key: "date", label: `${reportUtc ? "报表创建日期" : "创建日期"}：${fromDate || "不限"} 至 ${toDate || "不限"}` } : null,
        countries.length ? { key: "country", label: `国家/地区：已选 ${countries.length} 项` } : null,
        industries.length ? { key: "industry", label: `所属行业：${industries.join("、")}` } : null,
        sourceType ? { key: "sourceType", label: `数据来源：${sourceType === "AI_ACQUISITION" ? "AI获客" : sourceType === "IMPORT" ? "批量导入" : "手动新增"}` } : null,
        sourceBatches.length ? { key: "sourceBatches", label: `来源批次：已选 ${sourceBatches.length} 个` } : null,
        level ? { key: "level", label: `AI等级：${level === "UNSCREENED" ? "未筛选" : level}` } : null,
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
        followupStatus ? { key: "followupStatus", label: `跟进状态：${FOLLOWUP_STAGE_LABELS[followupStatus as FollowupStage] || followupStatus}` } : null,
        aiFilter !== "all" ? { key: "aiFilter", label: `AI分析状态：${aiFilter === "pending" ? "未分析" : aiFilter === "failed" ? "分析失败" : "已分析"}` } : null,
        canViewAll ? { key: "scopeUserId", label: scopeUserId === "all" ? "归属人：全部用户" : `归属人：${userOptions.find((item) => item.id === scopeUserId)?.name?.trim() || userOptions.find((item) => item.id === scopeUserId)?.email || "未设置用户名"}` } : null,
      ].filter((item): item is { key: string; label: string } => Boolean(item)),
    [search, fromDate, toDate, reportUtc, countries, industries, sourceType, sourceBatches, level, status, target, followupStatus, aiFilter, scopeUserId, userOptions, canViewAll],
  );
  function clearFilter(key: string) {
    if (key === "search") setSearch("");
    if (key === "date") { setFromDate(""); setToDate(""); setReportUtc(false); }
    if (key === "country") setCountries([]);
    if (key === "industry") setIndustries([]);
    if (key === "sourceBatches") setSourceBatches([]);
    if (key === "sourceType") { setSourceType(""); setSourceBatches([]); }
    if (key === "level") setLevel("");
    if (key === "status") setStatus("");
    if (key === "target") setTarget("");
    if (key === "followupStatus") setFollowupStatus("");
    if (key === "aiFilter") setAiFilter("all");
    if (key === "scopeUserId") setScopeUserId(defaultScopeUserId);
    setPage(1);
  }
  function reset() {
    setSearch("");
    setFromDate("");
    setToDate("");
    setReportUtc(false);
    setCountries([]);
    setIndustries([]);
    setSourceBatches([]);
    setSourceType("");
    setStatus("");
    setLevel("");
    setTarget("");
    setFollowupStatus("");
    setAiFilter("all");
    setScopeUserId(defaultScopeUserId);
    setSort("updated_at");
    setDirection("desc");
    setPage(1);
    setSelected(new Set());
    setProtectedSelected(new Set());
  }
  function notify(message: string, type: "success" | "error" = "success") {
    window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { message, type } }));
  }
  async function remove(ids: string[]) {
    if (!ids.length || deleting) return;
    setDeleting(true);
    try {
      const response =
        ids.length === 1
          ? await fetch(`/api/customers/${ids[0]}`, { method: "DELETE", headers: { "x-dtsmart-toast": "manual" } })
          : await fetch("/api/customers/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-dtsmart-toast": "manual" },
              body: JSON.stringify({ ids, action: "DELETE" }),
            });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error || "删除失败，请稍后重试", "error");
        return;
      }
      const failed = Number(body.failed_count || 0);
      const succeeded = Number(body.success_count || (body.ok ? 1 : 0));
      if (!succeeded) {
        notify(body.results?.find?.((item: { error?: string }) => item.error)?.error || "删除失败，请稍后重试", "error");
        return;
      }
      notify(failed ? `已永久删除 ${succeeded} 条客户，${failed} 条未删除` : `已永久删除 ${succeeded} 条客户`);
      setSelected(new Set());
      setProtectedSelected(new Set());
      setDetail(null);
      setDeleteIds(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }
  async function selectAllResults() {
    if (crossUserReadOnly) return notify("跨用户数据仅供查看，不能批量操作", "error");
    setSelectingAll(true);
    setError("");
    const params = new URLSearchParams({
      page: "1", pageSize: "1000", ids_only: "true", search, status,
      followup_status: followupStatus, ai_level: level, target, ai_status: aiFilter,
      deleted: "false", sort, direction,
    });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (reportUtc) params.set("report_utc", "1");
    countries.forEach((country) => params.append("country", country));
    industries.forEach((industry) => params.append("industry", industry));
    sourceBatches.forEach((batch) => params.append("source_batch", batch));
    if (sourceType) params.set("source_type", sourceType);
    if (scopeUserId) params.set("user_id", scopeUserId);
    try {
      const ids = new Set<string>();
      const protectedIds = new Set<string>();
      let currentPage = 1;
      let total = 0;
      do {
        params.set("page", String(currentPage));
        const response = await fetch(`/api/customers?${params}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "全选当前筛选结果失败");
        total = Number(body.count || 0);
        const pageItems = Array.isArray(body.data) ? body.data : [];
        for (const item of pageItems) {
          const id = String(item.id);
          ids.add(id);
          if (["QUOTE", "DEAL"].includes(String(item.status || ""))) protectedIds.add(id);
        }
        if (!pageItems.length && ids.size < total) throw new Error(`全选中断：已读取 ${ids.size}/${total} 条，请刷新后重试`);
        currentPage += 1;
      } while (ids.size < total);
      setSelected(ids);
      setProtectedSelected(protectedIds);
      notify(`已选择当前筛选结果的 ${ids.size} 条客户`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "全选当前筛选结果失败";
      setError(message);
      notify(message, "error");
    } finally {
      setSelectingAll(false);
    }
  }
  async function releaseCustomer(customer: Customer, reason: string) {
    const response = await fetch(`/api/customers/${customer.id}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RELEASE", reason }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return notify(body.error || "释放客户失败", "error");
    setReleaseTarget(null);setReleaseReason("");setReleaseAcknowledged(false);notify("客户已释放并进入客户公海，保护期已结束");
    await load();
  }
  async function exportData() {
    if (!canExport) return notify("当前账号没有客户导出权限", "error");
    setExporting(true);
    setError("");
    const exportRows: Customer[] = [];
    const seenIds = new Set<string>();
    const params = new URLSearchParams({
      pageSize: "500", search, status, ai_level: level, target, export: "1",
      followup_status: followupStatus, ai_status: aiFilter, deleted: "false", sort, direction,
    });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (reportUtc) params.set("report_utc", "1");
    countries.forEach((country) => params.append("country", country));
    industries.forEach((industry) => params.append("industry", industry));
    sourceBatches.forEach((batch) => params.append("source_batch", batch));
    if (sourceType) params.set("source_type", sourceType);
    if (scopeUserId) params.set("user_id", scopeUserId);
    try {
      let currentPage = 1;
      let total = -1;
      do {
        params.set("page", String(currentPage));
        const response = await fetch(`/api/customers?${params}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "导出数据读取失败");
        const items = Array.isArray(body.data) ? body.data as Customer[] : [];
        const currentTotal = Number(body.count ?? 0);
        if (!Number.isSafeInteger(currentTotal) || currentTotal < 0 || (total >= 0 && currentTotal !== total)) throw new Error("导出期间客户数量发生变化，请重试");
        total = currentTotal;
        for (const item of items) {
          if (!item.id || seenIds.has(item.id)) throw new Error("导出期间客户列表发生变化，请重试");
          seenIds.add(item.id);
          exportRows.push(item);
        }
        currentPage += 1;
        if (!items.length && exportRows.length < total) throw new Error(`导出中断：已读取 ${exportRows.length}/${total} 条`);
      } while (exportRows.length < total);
      if (!exportRows.length) return notify("当前筛选条件下没有可导出的客户");
      downloadCustomerWorkbook(exportRows as unknown as Array<Record<string, unknown>>, "客户列表", { columns: fields, includeOwner: canViewAll, includeAllContactChannels: true, includeAiEvidence: currentRole === "ADMIN" });
      notify(`已导出当前筛选结果 ${exportRows.length} 条`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "导出数据失败";
      setError(message);
      notify(message, "error");
    } finally {
      setExporting(false);
    }
  }
  return (
    <main className="min-h-screen bg-[#f5f8fc] px-5 py-6 lg:px-7">
      <div className="mx-auto max-w-[1800px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">我的客户</h1>
          <span className="text-base text-slate-500">统一管理、跟进和保护客户数据</span>
        </div>
        <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700">
          <ShieldCheck className="mr-2 inline-block align-[-3px] text-blue-600" size={17} strokeWidth={2} />
          当前数据范围：{!canViewAll
            ? "我的客户"
            : scopeUserId === "all"
              ? "全部用户"
              : `${userOptions.find((item) => item.id === scopeUserId)?.name?.trim() || userOptions.find((item) => item.id === scopeUserId)?.email || "未设置用户名"}的客户`} ·
          {currentRole === "SUPERVISOR" ? "主管默认查看本人，可主动切换指定用户" : currentRole === "ADMIN" ? "系统管理员可切换指定用户" : "系统按登录权限自动确定"} · 客户数已按主体去重
          <button type="button" onClick={() => setPermissionOpen(true)} className="float-right text-blue-600 hover:underline">
            查看权限说明 ⓘ
          </button>
        </div>
        <div className="mt-5">
          <AppTabs
            value={workspace}
            items={[
              { value: "list", label: "我的客户", description: "当前归属并由我维护的客户", count: totalCustomerCount ?? undefined, countTone: "success" },
              { value: "protection", label: "保护到期与续期", description: "到期提醒、续期及主动释放历史", count: protectionCount ?? undefined, countTone: "warning" },
              { value: "conflicts", label: "冲突客户", description: "核对重复提交与客户归属冲突", count: conflictCount ?? undefined, countTone: "danger" },
            ]}
            onChange={switchWorkspace}
            label="我的客户分类"
          />
        </div>
        {workspace === "list" ? <>
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative w-[300px] shrink-0">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={17}
              />
              <input
                name="customer-list-search"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => event.key === "Enter" && void load()}
                placeholder="搜索客户、联系人、电话、邮箱或国家/地区"
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <CompactDateRange label="录入日期" fromLabel="录入开始日期" toLabel="录入结束日期" from={fromDate} to={toDate} onFromChange={(value)=>{setFromDate(value);setPage(1)}} onToChange={(value)=>{setToDate(value);setPage(1)}}/>
            <SearchableMultiSelectFilter className="w-44 shrink-0" label="国家/地区" value={countries} options={filterOptions.countries.map((item)=>({...item,label:countryInfo(item.value).name||item.label||item.value}))} onChange={(value)=>{setCountries(value);setPage(1)}}/>
            <SearchableMultiSelectFilter className="w-44 shrink-0" label="所属行业" value={industries} options={filterOptions.industries} onChange={(value)=>{setIndustries(value);setPage(1)}}/>
            {canViewAll ? <select value={scopeUserId} onChange={(event) => { setScopeUserId(event.target.value); setSourceBatches([]); setPage(1); setSelected(new Set()); }} className="h-10 w-44 shrink-0 rounded-lg border border-slate-200 px-3 text-sm" aria-label="归属人">{currentRole === "ADMIN" ? <option value="all">归属人：全部用户</option> : null}{userOptions.map((item) => <option key={item.id} value={item.id}>{item.id === defaultScopeUserId ? `归属人：${item.name?.trim() || item.email}（我的客户）` : `归属人：${item.name?.trim() || item.email}`}</option>)}</select> : null}
            <select value={sourceType} onChange={(event)=>{setSourceType(event.target.value);setSourceBatches([]);setPage(1)}} className="h-10 w-36 shrink-0 rounded-lg border border-slate-200 px-3 text-sm" aria-label="数据来源"><option value="">全部数据来源</option><option value="AI_ACQUISITION">AI获客</option><option value="IMPORT">批量导入</option><option value="MANUAL">手动新增</option></select>
            <ImportBatchMultiSelect
              className="w-44 shrink-0"
              options={batchOptions}
              value={sourceBatches}
              onChange={(next) => {
                setSourceBatches(next);
                setPage(1);
                setSelected(new Set());
                setProtectedSelected(new Set());
              }}
              placeholder="全部来源批次"
              emptyText="当前客户列表暂无来源批次"
            />
            <select
              value={level}
              onChange={(event) => {
                setLevel(event.target.value);
                setPage(1);
              }}
              className="h-10 w-36 shrink-0 rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">全部AI等级</option>
              <option value="UNSCREENED">未筛选</option>
              {["A", "B", "C", "D"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setPage(1);
              }}
              className="h-10 w-36 shrink-0 rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">全部目标客户</option>
              <option value="valid">有效目标</option>
              <option value="invalid">无效目标</option>
              <option value="review">待复核</option>
            </select>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-10 w-36 shrink-0 rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">全部客户阶段</option>
              {(["CLAIMED", "FOLLOWING", "DEAL"] as CustomerStatus[]).map((key) => (
                <option key={key} value={key}>{stageLabels[key]}</option>
              ))}
            </select>
            <select
              value={followupStatus}
              onChange={(event) => {
                setFollowupStatus(event.target.value);
                setPage(1);
                setSelected(new Set());
                setProtectedSelected(new Set());
              }}
              className="h-10 w-36 shrink-0 rounded-lg border border-slate-200 px-3 text-sm outline-none transition hover:border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              aria-label="跟进状态"
            >
              <option value="">全部跟进状态</option>
              {FOLLOWUP_STAGES.map((key) => <option key={key} value={key}>{FOLLOWUP_STAGE_LABELS[key]}</option>)}
            </select>
            <select
              value={aiFilter}
              onChange={(event) => { setAiFilter(event.target.value as "done" | "pending" | "failed" | "all"); setPage(1); setSelected(new Set()); setProtectedSelected(new Set()); }}
              className="h-10 w-40 shrink-0 rounded-lg border border-slate-200 px-3 text-sm"
              aria-label="AI筛选状态"
            >
              <option value="all">全部AI分析状态</option>
              <option value="done">已分析</option>
              <option value="pending">未分析</option>
              <option value="failed">分析失败</option>
            </select>
            <button
              onClick={reset}
              className="h-10 shrink-0 rounded-lg border border-slate-200 px-3 text-sm hover:bg-slate-50"
            >
              重置
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">评分达到 60 分是有效目标的必要条件，不等于已确认有效；仍须核实行业、经营证据、联系方式及重复情况。以 AI 或人工复核的最终目标判断为准；未分析与分析失败可单独筛选。</p>
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
                <Plus size={16} className="shrink-0" />
                <span className="leading-none">新增客户</span>
                <ChevronDown
                  size={15}
                  className={`ml-0.5 shrink-0 transition-transform ${newOpen ? "rotate-180" : ""}`}
                />
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
                    href="/import?destination=private"
                    className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"
                  >
                    <FileSpreadsheet size={20} className="mt-0.5 shrink-0 text-emerald-600" />
                    <span><span className="block text-sm font-medium">批量导入</span><small className="text-slate-500">
                      导入后归属当前用户
                    </small></span>
                  </Link>
                  <a
                    href="/api/import/template"
                    className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-blue-50"
                  >
                    <Download size={20} className="mt-0.5 shrink-0 text-blue-600" />
                    <span><span className="block text-sm font-medium">下载导入模板</span><small className="text-slate-500">
                      .csv · 含字段说明和示例数据
                    </small></span>
                  </a>
                  <div className="border-t px-3 py-2 text-xs text-slate-400">
                    请使用系统最新模板，勿修改第一行字段名称
                  </div>
                </div>
              )}
            </div>
            {canExport && <button
              onClick={() => void exportData()}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50"
            >
              <Download size={16} />
              {exporting ? "正在导出…" : "导出数据"}
            </button>}
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
                    {orderedColumns.map((column) => (
                      <label
                        key={column.key}
                        draggable
                        onDragStart={() => setDraggedField(column.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (!draggedField || draggedField === column.key) return;
                          setDraft((current) => {
                            const next = current.filter((item) => item !== draggedField);
                            const targetIndex = next.indexOf(column.key);
                            next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedField);
                            return next;
                          });
                          setDraggedField(null);
                        }}
                        className="flex cursor-grab items-center gap-2 rounded px-2 py-2 text-sm hover:bg-slate-50 active:cursor-grabbing"
                      >
                        <span className="text-slate-400">⋮⋮</span>
                        <input
                          type="checkbox"
                          checked={draft.includes(column.key)}
                          disabled={canViewAll && column.key === "owner"}
                          onChange={() =>
                            setDraft((current) =>
                              current.includes(column.key)
                                ? current.filter((item) => item !== column.key)
                                : [...current, column.key],
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{column.label}</span>
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button type="button" disabled={!draft.includes(column.key) || draft.indexOf(column.key) === 0} onClick={(event) => { event.preventDefault(); event.stopPropagation(); moveDraftField(column.key, -1); }} className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-30" title="上移"><ChevronUp size={14} /></button>
                          <button type="button" disabled={!draft.includes(column.key) || draft.indexOf(column.key) === draft.length - 1} onClick={(event) => { event.preventDefault(); event.stopPropagation(); moveDraftField(column.key, 1); }} className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-30" title="下移"><ChevronDown size={14} /></button>
                        </span>
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
                      onClick={() => setDraft(canViewAll ? [...defaults, "owner"] : defaults)}
                      className="text-blue-600"
                    >
                      恢复默认
                    </button>
                    <button
                      onClick={() => {
                        const selectedFields = draft.length ? draft : defaults;
                        const visibleFields = canViewAll && !selectedFields.includes("owner") ? [...selectedFields, "owner" as const] : selectedFields;
                        setFields(visibleFields);
                        localStorage.setItem(
                          CUSTOMER_LIST_COLUMN_STORAGE_KEY,
                          JSON.stringify(visibleFields),
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
              onClick={() => {
                if (count > 0 && selected.size >= count) {
                  setSelected(new Set());
                  setProtectedSelected(new Set());
                  notify("已取消全选");
                } else void selectAllResults();
              }}
              disabled={crossUserReadOnly || selectingAll || !count}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {selectingAll ? "正在全选..." : count > 0 && selected.size >= count ? "取消全选" : "全选筛选结果"}
            </button>
            <span className="ml-auto text-sm text-slate-600">已选择 {selected.size} 项</span>
            <button
              disabled={crossUserReadOnly || !selected.size}
              onClick={() => {
                setDeleteIds([...selected]);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2.5 text-sm text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={16} />
              批量删除
            </button>
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
            <table className="w-full min-w-[1440px] table-fixed text-left text-sm">
              <thead className="sticky top-0 z-20 bg-[#eef5fb] text-xs text-slate-700">
                <tr>
                  <th className="sticky left-0 z-30 w-12 bg-[#eef5fb] px-4 py-3">
                    <input
                      type="checkbox"
                      disabled={crossUserReadOnly}
                      checked={allPage}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          rows.forEach((row) => {
                            if (allPage) next.delete(row.id);
                            else next.add(row.id);
                            setProtectedSelected((current) => {
                              const statuses = new Set(current);
                              if (["QUOTE", "DEAL"].includes(row.status)) statuses.add(row.id);
                              else statuses.delete(row.id);
                              return statuses;
                            });
                          });
                          return next;
                        })
                      }
                    />
                  </th>
                  {fields.map((key) => (
                    <th
                      key={key}
                      className={`${key === "company_name" ? "sticky left-12 z-30 bg-[#eef5fb]" : ""} ${listColumnWidth[key] || "w-32"} px-3 py-3`}
                    >
                      <button
                        type="button"
                        onClick={() => changeSort(key)}
                        className="inline-flex items-center gap-1 font-medium hover:text-blue-700"
                        title="点击切换升序/降序"
                      >
                        {columns.find((column) => column.key === key)?.label}
                        <span className={`text-[10px] ${sort === sortableField(key) ? "text-blue-600" : "text-slate-300"}`}>
                          {sort === sortableField(key) ? (direction === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 w-44 bg-[#eef5fb] px-4 py-3">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onDoubleClick={(event) => { if (canOpenListRow(event.target)) router.push(`/customers/${row.id}`); }}
                    className="h-[72px] select-text border-t border-slate-100 hover:bg-blue-50/50"
                  >
                    <td className="sticky left-0 z-10 bg-white px-4 py-3">
                      <input
                        type="checkbox"
                        disabled={crossUserReadOnly}
                        checked={selected.has(row.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            setProtectedSelected((protectedCurrent) => {
                              const protectedNext = new Set(protectedCurrent);
                              if (next.has(row.id) && ["QUOTE", "DEAL"].includes(row.status)) protectedNext.add(row.id);
                              else protectedNext.delete(row.id);
                              return protectedNext;
                            });
                            return next;
                          })
                        }
                      />
                    </td>
                    {fields.map((key) => (
                      <td
                        key={key}
                        className={`${key === "company_name" ? "sticky left-12 z-10 bg-white" : ""} overflow-hidden px-3 py-3 align-middle`}
                        title={
                          key === "company_name" ? displayCustomerName(row.company_name) : undefined
                        }
                      >
                        {key === "company_name" ? (
                          <span className="block truncate font-medium text-blue-600">
                            {displayCustomerName(row.company_name)}
                            <small className={`block truncate text-xs font-normal ${customerIndustryDisplay(row).verified ? "text-emerald-600" : "text-slate-500"}`} title={customerIndustryDisplay(row).title}>
                              {customerIndustryDisplay(row).verified ? "AI核验：" : "原始类别："}{customerIndustryDisplay(row).text}
                            </small>
                          </span>
                        ) : key === "country" ? (
                          <CountryLabel value={row.country} />
                        ) : key === "ai_score" ? (
                          <Score customer={row} />
                        ) : key === "owner" ? (
                          <span className="block truncate" title={userOptions.find((item) => item.id === row.owner_id)?.name?.trim() || userOptions.find((item) => item.id === row.owner_id)?.email || "未分配"}>
                            {userOptions.find((item) => item.id === row.owner_id)?.name?.trim() || userOptions.find((item) => item.id === row.owner_id)?.email || "未分配"}
                          </span>
                        ) : key === "status" ? (
                          <span
                            className={`rounded-md px-2 py-1 text-xs ${stageClass[row.status]}`}
                          >
                            {stageLabels[row.status] || row.status}
                          </span>
                        ) : key === "phone" ? (
                          <CustomerContactSummary customer={row} source="all" display="phone" />
                        ) : key === "email" ? (
                          <CustomerContactSummary customer={row} source="all" display="email" />
                        ) : key === "verified_contacts" ? (
                          <CustomerContactSummary customer={row} source="ai" />
                        ) : key === "website" ? (
                          <CustomerPublicLink value={row.website} kind="website" />
                        ) : key === "google_url" ? (
                          <CustomerPublicChannels customer={row} />
                        ) : key === "source" ? (
                          <span className="block min-w-0 truncate" title={[row.source_batch ? `批次：${row.source_batch}` : "", `创建人：${row.creator?.name||row.creator?.email||"未知用户"}`].filter(Boolean).join("\n")}>{customerSourceLabel(row.source)}</span>
                        ) : (
                          value(row, key)
                        )}
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 min-w-44 align-middle bg-white px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <Link
                        href={`/customers/${row.id}`}
                        prefetch={false}
                        onClick={(event) => event.stopPropagation()}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        title={crossUserReadOnly ? "查看客户详情（跨用户数据只读）" : "查看客户详情"}
                        aria-label={`查看${row.company_name}详情`}
                      >
                        <Eye size={14}/>
                      </Link>
                      {!crossUserReadOnly ? <RowActionMenu ariaLabel={`${row.company_name}操作菜单`}>
                        <RowActionItem onClick={() => router.push(`/customers/${row.id}?action=followup`)}>新增跟进</RowActionItem>
                        <RowActionItem onClick={() => router.push(`/customers/${row.id}?action=stage`)}>更新客户阶段</RowActionItem>
                        {(currentRole === "ADMIN" || row.owner_id === defaultScopeUserId) && row.status !== "DEAL" ? <RowActionItem tone="warning" onClick={() => { setReleaseTarget(row);setReleaseReason("");setReleaseAcknowledged(false); }}>释放到公海</RowActionItem> : null}
                        {!crossUserReadOnly ? <RowActionItem tone="danger" onClick={() => setDeleteIds([row.id])}>永久删除</RowActionItem> : null}
                      </RowActionMenu> : null}
                      </div>
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
          {selected.size ? <div className="border-t bg-blue-50/50 px-5 py-2 text-sm text-blue-700">已勾选 {selected.size} 条</div> : null}
          <AppPagination page={page} pageSize={pageSize} total={count} itemLabel="家客户" pageSizes={[10,20,30,50,100]} onPage={setPage} onPageSize={(size)=>{setPageSize(size);setPage(1)}}/>
        </section>
        {deleteIds && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="delete-customer-title" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setDeleteIds(null)}>
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-2xl">
              <div className="flex items-start gap-4 p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600"><Trash2 size={22} /></div>
                <div><h2 id="delete-customer-title" className="text-lg font-semibold text-slate-900">确定永久删除所选数据？</h2><p className="mt-2 text-sm leading-6 text-slate-600">将从数据库中永久删除 {deleteIds.length} 条客户及其关联记录。此操作不可恢复。</p></div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-100 bg-white px-6 py-4">
                <button type="button" disabled={deleting} onClick={() => setDeleteIds(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:border-slate-300 disabled:opacity-50">取消</button>
                <button type="button" disabled={deleting} onClick={() => void remove(deleteIds)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50">{deleting ? "正在删除..." : "确认永久删除"}</button>
              </div>
            </div>
          </div>
        )}
        {permissionOpen && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/25 p-4" role="dialog" aria-modal="true" aria-labelledby="permission-title" onMouseDown={(event) => event.target === event.currentTarget && setPermissionOpen(false)}>
            <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 id="permission-title" className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="text-blue-600" size={20}/>客户数据权限说明</h2>
                <button type="button" onClick={() => setPermissionOpen(false)} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={19}/></button>
              </div>
              <div className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
                <p className="rounded-lg bg-blue-50 p-3"><b className="text-slate-900">我的客户：</b>当前归属自己的客户可查看、编辑、跟进、释放；有关联有效报价、订单或已成交的客户不可删除。</p>
                <p className="rounded-lg bg-slate-50 p-3"><b className="text-slate-900">冲突客户：</b>非归属人仅可查看自己新增或导入的基础字段和当前归属人，不能查看 AI 证据、跟进记录或修改客户。</p>
                <p className="rounded-lg bg-slate-50 p-3"><b className="text-slate-900">主管：</b>可按归属人查看授权范围的数据，跨用户数据只读。<b className="text-slate-900">系统管理员：</b>拥有全系统客户数据的读取和维护权限，所有跨用户维护操作均保留审计记录。</p>
                <p className="text-xs text-slate-400">最终可见范围由 Supabase RLS 与服务端权限共同校验，前端隐藏不代替服务端权限控制。</p>
              </div>
              <button type="button" onClick={() => setPermissionOpen(false)} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">我知道了</button>
            </section>
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
                <CustomerPublicLink value={detail.website} kind="website" />
              </p>
              <p>
                <span className="text-slate-500">Google Maps：</span>
                <CustomerPublicLink value={detail.google_url} kind="map" />
              </p>
            </div>
            <Link
              href={`/customers/${detail.id}`}
              prefetch={false}
              className="mt-6 block rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white"
            >
              查看完整详情
            </Link>
          </aside>
        )}
        </> : workspace === "protection"
          ? <CustomerProtectionPanel onCount={setProtectionCount} scopeUserId={scopeUserId} onScopeUserIdChange={setScopeUserId} />
          : <CustomerConflictsPanel onCount={setConflictCount} scopeUserId={scopeUserId} onScopeUserIdChange={setScopeUserId} />}
        {releaseTarget ? <AppDialog title="释放客户到公海" description={`${releaseTarget.company_name} · ${stageLabels[releaseTarget.status]}`} onClose={()=>{setReleaseTarget(null);setReleaseReason("");setReleaseAcknowledged(false)}} width="max-w-md"><form onSubmit={event=>{event.preventDefault();if(releaseReason.trim() && (!releaseNeedsAcknowledgement(releaseTarget.status) || releaseAcknowledged))void releaseCustomer(releaseTarget,releaseReason.trim())}}><p className={`rounded-lg p-3 text-xs leading-5 ${releaseNeedsAcknowledgement(releaseTarget.status)?"bg-amber-50 text-amber-800":"bg-slate-50 text-slate-700"}`}>{releaseNotice(releaseTarget.status)}</p><label className="mt-4 block text-sm font-medium text-slate-700">释放原因（必填）<textarea autoFocus required minLength={5} maxLength={300} value={releaseReason} onChange={event=>setReleaseReason(event.target.value)} rows={4} placeholder="请客观说明释放原因，系统将保留审计记录" className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"/></label>{releaseNeedsAcknowledgement(releaseTarget.status)?<label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-600"><input required type="checkbox" checked={releaseAcknowledged} onChange={event=>setReleaseAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"/><span>我已确认上述业务影响，并已完成必要的客户沟通或业务单据处理。</span></label>:null}<DialogActions onCancel={()=>{setReleaseTarget(null);setReleaseReason("");setReleaseAcknowledged(false)}} confirmLabel="确认释放" tone="danger"/></form></AppDialog> : null}
      </div>
    </main>
  );
}
