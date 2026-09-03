"use client";

import Link from "next/link";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Search,
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

type Role = "ADMIN" | "SUPERVISOR" | "SALES" | "WAREHOUSE";
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
  country: string | null;
  address: string | null;
  industry: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  google_url: string | null;
  ai_level: string | null;
  ai_score: number | null;
  business_scope: string | null;
  owner_id: string | null;
  owner: Owner | null;
  pool_status: string | null;
  status: string;
  contact_masked: boolean;
  can_claim: boolean;
  can_open_customer: boolean;
  protection?: { expire_date?: string; extension_count?: number } | null;
};
type AssignmentOptions = {
  assignees: Owner[];
  inactive_users: Array<Owner & { status: string; customer_count: number }>;
};
type PoolFilterOptions = {
  countries: string[];
  industries: string[];
  owners: Owner[];
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
const field =
  "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
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

export function CustomerPublicPoolView() {
  const [tab, setTab] = useState<Tab>("available");
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [role, setRole] = useState<Role>("SALES");
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [aiLevel, setAiLevel] = useState("");
  const [target, setTarget] = useState("");
  const [customerStatus, setCustomerStatus] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [filterOptions, setFilterOptions] = useState<PoolFilterOptions>({
    countries: [],
    industries: [],
    owners: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [claim, setClaim] = useState<PoolRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const load = useCallback(async () => {
    if (!["available", "claimed", "pending"].includes(tab)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        tab,
        page: String(page),
        page_size: String(pageSize),
      });
      if (query.trim()) params.set("q", query.trim());
      if (country) params.set("country", country);
      if (industry) params.set("industry", industry);
      if (aiLevel) params.set("ai_level", aiLevel);
      if (target) params.set("target", target);
      if (customerStatus && tab === "claimed") params.set("status", customerStatus);
      if (ownerId && tab === "claimed") params.set("owner_id", ownerId);
      const body = await api(`/api/customers/public-pool?${params}`);
      setRows(body.data || []);
      setCount(Number(body.count || 0));
      setRole(body.role || "SALES");
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "客户公海加载失败");
    } finally {
      setLoading(false);
    }
  }, [
    aiLevel,
    country,
    customerStatus,
    industry,
    ownerId,
    page,
    pageSize,
    query,
    tab,
    target,
  ]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!["available", "claimed", "pending"].includes(tab)) return;
    api(`/api/customers/public-pool?tab=${tab}&options=1`)
      .then((body) =>
        setFilterOptions({
          countries: body.countries || [],
          industries: body.industries || [],
          owners: body.owners || [],
        }),
      )
      .catch(() =>
        setFilterOptions({ countries: [], industries: [], owners: [] }),
      );
  }, [tab]);
  useEffect(
    () => setPage(1),
    [aiLevel, country, customerStatus, industry, ownerId, query, tab, target],
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
    setOwnerId("");
    setCustomerStatus("");
  }
  function resetFilters() {
    setQuery("");
    setCountry("");
    setIndustry("");
    setAiLevel("");
    setTarget("");
    setCustomerStatus("");
    setOwnerId("");
    setPage(1);
  }
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1680px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">客户公海</h2>
            <p className="mt-2 text-sm text-slate-500">
              待认领客户没有归属人；销售员提交真实联系凭证后完成认领，并进入“我的客户”。
            </p>
            <p className="mt-1 text-xs text-slate-400">
              “认领记录”仅用于查询历史公海客户的当前归属，非归属销售员只能查看脱敏信息；它不是可再次认领的客户列表。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"
          >
            <RefreshCw size={16} />
            刷新
          </button>
        </header>
        <div className="mt-5">
          <AppTabs
            value={tab}
            items={visibleTabs.map((value) => ({
              value,
              label: tabLabels[value],
              description: tabDescriptions[value],
            }))}
            onChange={changeTab}
            label="客户公海分类"
          />
        </div>
        {["available", "claimed", "pending"].includes(tab) ? (
          <>
            <section className="mt-4 rounded-xl border bg-white p-4 shadow-sm">
              <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.7fr)_repeat(5,minmax(130px,1fr))_minmax(150px,1fr)_96px]">
                <label className="relative min-w-0">
                  <Search
                    size={17}
                    className="absolute left-3 top-3 text-slate-400"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索客户名称、国家或行业"
                    className={`${field} w-full min-w-0 pl-9`}
                  />
                </label>
                <select
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className={`${field} min-w-0`}
                >
                  <option value="">全部国家/地区</option>
                  {filterOptions.countries.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  value={industry}
                  onChange={(event) => setIndustry(event.target.value)}
                  className={`${field} min-w-0`}
                >
                  <option value="">全部所属行业</option>
                  {filterOptions.industries.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  value={aiLevel}
                  onChange={(event) => setAiLevel(event.target.value)}
                  className={`${field} min-w-0`}
                >
                  <option value="">全部AI等级</option>
                  {["A", "B", "C", "D"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className={`${field} min-w-0`}
                >
                  <option value="">全部目标判断</option>
                  <option value="valid">有效目标</option>
                  <option value="invalid">无效目标</option>
                  <option value="pending">尚未判断</option>
                </select>
                {tab === "claimed" ? <select
                  value={customerStatus}
                  onChange={(event) => setCustomerStatus(event.target.value)}
                  className={`${field} min-w-0`}
                  aria-label="筛选已认领客户的当前阶段"
                >
                  <option value="">全部已认领客户阶段</option>
                  <option value="CLAIMED">潜在客户</option>
                  <option value="FOLLOWING">意向客户</option>
                  <option value="QUOTE">报价中</option>
                  <option value="DEAL">已成交</option>
                  <option value="RELEASED">无效客户</option>
                </select> : <span className="hidden xl:block" aria-hidden="true" />}
                {tab === "claimed" && ["ADMIN", "SUPERVISOR"].includes(role) ? (
                  <select
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    className={`${field} min-w-0`}
                  >
                    <option value="">全部归属人</option>
                    {filterOptions.owners.map((value) => (
                      <option key={value.id} value={value.id}>
                        {displayUser(value)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="hidden xl:block" />
                )}
                <button
                  type="button"
                  onClick={resetFilters}
                  className="h-10 rounded-lg border bg-white px-4 text-sm hover:bg-slate-50"
                >
                  重置
                </button>
              </div>
              {role === "ADMIN" ? (
                <div className="mt-3 flex justify-end gap-2">
                  {["available", "pending"].includes(tab) ? <button
                    disabled={!selected.size}
                    type="button"
                    onClick={() => setAssignOpen(true)}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-40"
                  >
                    <UserPlus size={16} />
                    分配已选 {selected.size} 家
                  </button> : null}
                  <button
                    disabled={!selected.size}
                    type="button"
                    onClick={() => setDeleteIds([...selected])}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                    删除已选 {selected.size} 家
                  </button>
                </div>
              ) : null}
            </section>
            {error ? (
              <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
                {error}
              </p>
            ) : null}
            <PoolTable
              rows={rows}
              loading={loading}
              canDelete={role === "ADMIN"}
              selected={selected}
              setSelected={setSelected}
              claim={setClaim}
              remove={(row) => setDeleteIds([row.id])}
            />
            <AppPagination
              page={page}
              pageSize={pageSize}
              total={count}
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
          <HandoverPanel toast={setToast} />
        ) : null}
        {tab === "history" && role === "ADMIN" ? <AssignmentHistory /> : null}
        {claim ? (
          <ClaimDialog
            row={claim}
            close={() => setClaim(null)}
            saved={(message) => {
              setClaim(null);
              setToast(message);
              void load();
            }}
          />
        ) : null}
        {assignOpen ? (
          <AssignDialog
            customerIds={[...selected]}
            close={() => setAssignOpen(false)}
            saved={(message) => {
              setAssignOpen(false);
              setToast(message);
              void load();
            }}
          />
        ) : null}
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
  canDelete,
  selected,
  setSelected,
  claim,
  remove,
}: {
  rows: PoolRow[];
  loading: boolean;
  canDelete: boolean;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  claim: (row: PoolRow) => void;
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
      <table className="w-full min-w-[1280px] table-fixed text-left text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {selectable ? (
              <th className="w-12 px-4 py-3">
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
            <th className="w-64 px-4 py-3">客户名称</th>
            <th className="w-32 px-4 py-3">国家/地区</th>
            <th className="w-40 px-4 py-3">所属行业</th>
            <th className="w-40 px-4 py-3">电话</th>
            <th className="w-52 px-4 py-3">邮箱</th>
            <th className="w-32 px-4 py-3">AI等级</th>
            <th className="w-40 px-4 py-3">归属人/保护期</th>
            <th className="w-36 px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-blue-50/40">
              {selectable ? (
                <td className="px-4 py-4">
                  <input
                    aria-label={`选择${row.company_name}`}
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </td>
              ) : null}
              <td className="px-4 py-4">
                <b className="block truncate" title={row.company_name}>
                  {row.company_name}
                </b>
                {row.contact_masked ? (
                  <small className="mt-1 block text-amber-600">
                    敏感信息已隐藏
                  </small>
                ) : null}
              </td>
              <td className="px-4 py-4">
                <CountryLabel value={row.country} />
              </td>
              <td className="px-4 py-4">
                <span className="line-clamp-2">{row.industry || "其他"}</span>
              </td>
              <td className="px-4 py-4">{row.phone || "—"}</td>
              <td className="px-4 py-4">
                <span className="block truncate">{row.email || "—"}</span>
              </td>
              <td className="px-4 py-4">
                {row.ai_level ? (
                  <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    {row.ai_level} · {row.ai_score ?? "—"}
                  </span>
                ) : (
                  "待筛选"
                )}
              </td>
              <td className="px-4 py-4">
                <b className="block text-slate-700">{displayUser(row.owner)}</b>
                {row.protection?.expire_date ? (
                  <small className="mt-1 block text-slate-500">
                    至{" "}
                    {new Date(row.protection.expire_date).toLocaleDateString(
                      "zh-CN",
                    )}
                  </small>
                ) : null}
              </td>
              <td className="px-4 py-4">
                <div className="flex items-center gap-2">
                {row.can_claim ? (
                  <button
                    onClick={() => claim(row)}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                  >
                    认领
                  </button>
                ) : row.can_open_customer ? (
                  <Link
                    href={`/customers/${row.id}?from=pool`}
                    className="text-blue-600 hover:underline"
                  >
                    查看详情
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">已被认领</span>
                )}
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
      title="提交凭证并认领客户"
      subtitle={`${row.company_name} · 认领后开始90天保护期`}
      close={close}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          首次联系渠道
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className={`${field} mt-2 w-full`}
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">邮件</option>
            <option value="PHONE">电话</option>
            <option value="LINKEDIN">LinkedIn</option>
            <option value="OTHER">其他</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          真实联系结果
          <select required value={result} onChange={(e) => setResult(e.target.value)} className={`${field} mt-2 w-full`}>
            <option value="">请选择</option><option value="未回复">未回复</option><option value="已回复，待确认需求">已回复，待确认需求</option><option value="明确有需求">明确有需求</option><option value="明确无需求">明确无需求</option><option value="联系方式无效">联系方式无效</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          下一步计划
          <textarea
            value={nextPlan}
            onChange={(e) => setNextPlan(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border p-3 text-sm"
            placeholder="可选；不填则系统标记为待首次跟进"
          />
        </label>
        <EvidenceInput file={file} setFile={setFile} />
        {error ? <ErrorText value={error} /> : null}
        <DialogActions busy={busy} close={close} label="确认认领" />
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

function HandoverPanel({ toast }: { toast: (value: string) => void }) {
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
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, rows],
  );
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
                <td className="px-4 py-4">
                  <a
                    href={`/api/attachments/${row.evidence_attachment_id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-blue-600"
                  >
                    查看凭证
                    <ExternalLink size={13} />
                  </a>
                </td>
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
        ) : !rows.length ? (
          <div className="grid min-h-52 place-items-center text-sm text-slate-400">
            暂无待审核续期申请
          </div>
        ) : null}
      </div>
      <AppPagination
        page={page}
        pageSize={pageSize}
        total={rows.length}
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

function AssignmentHistory() {
  const [rows, setRows] = useState<History[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, rows],
  );
  useEffect(() => {
    api("/api/admin/customer-assignments?mode=history")
      .then((body) => setRows(body.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <section className="mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
      <header className="border-b p-5">
        <h3 className="font-semibold">客户分配与交接记录</h3>
        <p className="mt-1 text-sm text-slate-500">
          每次分配生成唯一批次号，记录原归属人、接收人、原因、数量和操作人，不因客户后续变化而丢失。
        </p>
      </header>
      {error ? (
        <div className="m-5">
          <ErrorText value={error} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {[
                "批次号",
                "批次名称",
                "类型",
                "原归属人",
                "接收人",
                "客户数",
                "操作人",
                "时间",
                "原因",
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
                <td className="px-4 py-4 font-mono text-xs text-blue-700">
                  {row.batch_number}
                </td>
                <td className="px-4 py-4 font-medium">{row.batch_name}</td>
                <td className="px-4 py-4">
                  {row.reason_type === "ACCOUNT_HANDOVER"
                    ? "账号交接"
                    : row.mode === "RELEASE"
                      ? "批量释放"
                      : "客户分配"}
                </td>
                <td className="px-4 py-4">{displayUser(row.source)}</td>
                <td className="px-4 py-4">{displayUser(row.target)}</td>
                <td className="px-4 py-4">{row.customer_count}</td>
                <td className="px-4 py-4">{displayUser(row.creator)}</td>
                <td className="px-4 py-4">{formatDate(row.created_at)}</td>
                <td className="max-w-72 px-4 py-4">
                  <span className="line-clamp-2">{row.reason}</span>
                </td>
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
        total={rows.length}
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
        真实联系凭证（必传）
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
  close,
  label,
}: {
  busy: boolean;
  close: () => void;
  label: string;
}) {
  return (
    <SharedDialogActions busy={busy} onCancel={close} confirmLabel={label} />
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
