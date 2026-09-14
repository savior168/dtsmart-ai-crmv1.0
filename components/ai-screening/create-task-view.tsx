"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Check, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountryLabel } from "@/components/country-label";
import { ImportBatchMultiSelect, type ImportBatchOption } from "@/components/import-batch-multi-select";
import { AppDialog } from "@/components/ui/app-dialog";
import { ErrorState, Loading, PageHeader, Pagination, button, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";

type CustomerRow = { id: string; company_name: string; contact_name?: string | null; country?: string | null; phone?: string | null; email?: string | null; website?: string | null; google_url?: string | null; source?: string | null; source_batch?: string | null; created_at: string; latest_analysis_at?: string | null; completed_analysis_count?: number; latest_analysis_version?: string | null; owner?: { name?: string | null; email?: string | null } | null };
type OwnerOption = { id: string; name?: string | null; email: string; role: string };
type SourceOption = { value: string; count: number };
type ScreeningTaskOption = { value: string; label: string; count: number };
type Batch = ImportBatchOption & { pending_count: number };
type AnalysisSelectionMode = "FIRST" | "REVERIFY";
type Filters = { search: string; source_channel: string; source_batches: string[]; screening_task_ids: string[]; date_from: string; date_to: string; owner_id: string; analysis_selection_mode: AnalysisSelectionMode };
const emptyFilters: Filters = { search: "", source_channel: "", source_batches: [], screening_task_ids: [], date_from: "", date_to: "", owner_id: "", analysis_selection_mode: "FIRST" };

function queryString(filters: Filters, page: number, pageSize: number, ids = false) {
  const params = new URLSearchParams({ search: filters.search, source_channel: filters.source_channel, date_from: filters.date_from, date_to: filters.date_to, page: String(page), pageSize: String(pageSize) });
  if (filters.owner_id) params.set("owner_id", filters.owner_id);
  params.set("analysis_selection_mode", filters.analysis_selection_mode);
  filters.source_batches.forEach((batchId) => params.append("source_batch", batchId));
  filters.screening_task_ids.forEach((taskId) => params.append("screening_task_id", taskId));
  if (ids) params.set("ids", "all");
  return params.toString();
}

function compactBatchTime(value: string | null) {
  if (!value) return "历史批次";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "历史批次";
  const part = (number: number) => String(number).padStart(2, "0");
  return `${part(date.getFullYear() % 100)}${part(date.getMonth() + 1)}${part(date.getDate())}${part(date.getHours())}${part(date.getMinutes())}`;
}

export function CreateTaskView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialReverify = searchParams.get("analysis_selection_mode") === "REVERIFY";
  const initialTaskId = String(searchParams.get("screening_task_id") || "").trim();
  const initialOwnerId = String(searchParams.get("owner_id") || "").trim();
  const initialFilters = (): Filters => ({
    ...emptyFilters,
    owner_id: initialOwnerId,
    ...(initialReverify ? { analysis_selection_mode: "REVERIFY" as const, screening_task_ids: initialTaskId ? [initialTaskId] : [] } : {}),
  });
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [costMode, setCostMode] = useState<"ADAPTIVE" | "FREE_ONLY">("ADAPTIVE");
  const [taskCostLimit, setTaskCostLimit] = useState("");
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [queryIds, setQueryIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batches, setBatches] = useState<Batch[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [screeningTasks, setScreeningTasks] = useState<ScreeningTaskOption[]>([]);
  const [canSelectOwner, setCanSelectOwner] = useState(false);
  const [scopeLabel, setScopeLabel] = useState("我的待筛选客户");
  const [allScopeLabel, setAllScopeLabel] = useState("全部可选客户");
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const strategy = "SMART" as const;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { toast, node: toastNode } = useToast();
  const requestKey = useRef(crypto.randomUUID());
  const loadSequence = useRef(0);

  const load = useCallback(async (selectAll = false, activeFilters = filters, activePage = page) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    const [listResponse, idsResponse] = await Promise.all([
      fetch(`/api/ai/customers?${queryString(activeFilters, activePage, pageSize)}`, { cache: "no-store" }),
      // The result count must follow the active mode and filters.  Reusing IDs
      // from the previous mode made the re-verification list show rows while
      // the header still displayed “current query 0”.
      fetch(`/api/ai/customers?${queryString(activeFilters, 1, 20, true)}`, { cache: "no-store" }),
    ]);
    const listBody = await listResponse.json().catch(() => ({}));
    const idsBody = await idsResponse.json().catch(() => ({}));
    // 切换归属人时，忽略先前请求的迟到结果，避免把旧用户的来源/批次混入当前选择。
    if (sequence !== loadSequence.current) return;
    setLoading(false);
    if (!listResponse.ok || !idsResponse.ok) { setError(listBody.error || idsBody?.error || "待筛选客户查询失败"); return; }
    setItems(listBody.data || []); setCount(listBody.count || 0); setBatches(listBody.batches || []); setOwners(listBody.owner_options || []); setSourceOptions(listBody.source_options || []); setScreeningTasks(listBody.screening_tasks || []); setCanSelectOwner(Boolean(listBody.can_select_owner)); setScopeLabel(String(listBody.scope_label || "我的待筛选客户")); setAllScopeLabel(String(listBody.all_scope_label || "全部可选客户"));
    if (!activeFilters.owner_id && listBody.selected_owner_id && String(listBody.selected_owner_id) !== "all") setDraft((current) => current.owner_id ? current : { ...current, owner_id: String(listBody.selected_owner_id) });
    const ids = idsBody.ids || [];
    setQueryIds(ids);
    if (selectAll) setSelected(new Set(ids));
  }, [filters, page, pageSize, queryIds.length]);
  useEffect(() => { void load(true); /* initial query intentionally selects every eligible customer */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (queryIds.length) void load(false); }, [page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const link = document.querySelector<HTMLAnchorElement>('a[href="/ai-screening/strategies"]');
    if (!link) return;
    const openRules = (event: MouseEvent) => { event.preventDefault(); setRulesOpen(true); };
    link.addEventListener("click", openRules);
    return () => link.removeEventListener("click", openRules);
  }, []);
  const allPage = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectedRows = useMemo(() => selected.size, [selected]);

  function applyFilters() { const next={...draft};setFilters(next);setPage(1);setQueryIds([]);setSelected(new Set());void load(next.analysis_selection_mode === "FIRST",next,1); }
  function resetFilters() { setDraft(emptyFilters);setFilters(emptyFilters);setPage(1);setQueryIds([]);setSelected(new Set());void load(true,emptyFilters,1); }
  function changeOwner(owner_id: string) {
    const next = { ...draft, owner_id, source_batches: [], screening_task_ids: [] };
    setDraft(next); setFilters(next); setPage(1); setQueryIds([]); setSelected(new Set());
    void load(next.analysis_selection_mode === "FIRST", next, 1);
  }
  function togglePage() { setSelected((current) => { const next = new Set(current); if (allPage) items.forEach((item) => next.delete(item.id)); else items.forEach((item) => next.add(item.id)); return next; }); }

  async function createTask() {
    if (!name.trim()) return toast("请输入任务名称", "error");
    if (!selected.size) return toast("请至少选择一条待筛选客户", "error");
    if (scheduleType === "scheduled" && (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now())) return toast("请选择晚于当前时间的预约执行时间", "error");
    if (costMode === "ADAPTIVE" && taskCostLimit !== "" && (!Number.isFinite(Number(taskCostLimit)) || Number(taskCostLimit) < 0)) return toast("单任务费用上限必须大于或等于0；留空表示继承全局上限", "error");
    setSaving(true);
    const response = await fetch("/api/ai/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), strategy, cost_mode: costMode, task_cost_limit_usd: costMode === "FREE_ONLY" ? 0 : taskCostLimit === "" ? null : Number(taskCostLimit), scheduled_at: scheduleType === "scheduled" ? scheduledAt : null, customer_ids: [...selected], filters, reanalysis: filters.analysis_selection_mode === "REVERIFY", request_key: requestKey.current }) });
    const body = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) return toast(body.error || "AI筛选任务创建失败", "error");
    toast("AI筛选任务已创建，服务端将持续执行");
    router.push(`/ai-screening/tasks/${body.task.id}`);
  }

  return <main className="ai-create-task-page min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="创建AI筛选任务" description="设置任务并选择客户，系统会根据证据复杂度自动选择分析深度。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className={panel}><div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">1</span>任务基本信息</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">任务名称用于后续查询、费用统计和报告归档；所有任务由 Vercel 云端 Workflow 执行。</p></div><div className="grid gap-3 p-4 lg:grid-cols-[minmax(420px,1.4fr)_minmax(360px,1fr)]"><label className="space-y-[5px]"><span className="block text-sm font-medium">任务名称</span><input className={`${input} w-full`} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：西班牙8月新客户智能分析" maxLength={80}/></label><div className="space-y-[5px]"><span className="block text-sm font-medium">执行时间</span><div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-lg border border-[#dfe5ee] bg-[#f7f9fc] p-1"><button type="button" onClick={() => setScheduleType("now")} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${scheduleType === "now" ? "bg-white text-[#1763e8] shadow-sm" : "text-[#657187] hover:text-[#334158]"}`}>立即执行</button><button type="button" onClick={() => setScheduleType("scheduled")} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${scheduleType === "scheduled" ? "bg-white text-[#1763e8] shadow-sm" : "text-[#657187] hover:text-[#334158]"}`}><CalendarClock size={15}/>预约执行</button></div>{scheduleType === "scheduled" ? <label className="relative min-w-[240px] flex-1"><CalendarClock className="absolute left-3 top-[11px] text-slate-400" size={16}/><input type="datetime-local" aria-label="预约执行时间" className={`${input} w-full pl-10`} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}/></label> : <span className="text-sm text-[#778397]">任务创建后立即进入队列执行</span>}</div></div></div></section>

    <section className={`${panel} overflow-hidden`}>
      <div className="border-b border-[#e8ecf2] px-4 py-[14px]">
        <h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">2</span>{filters.analysis_selection_mode === "REVERIFY" ? "筛选并指定复验客户" : `筛选并选择客户（待AI筛选 ${count.toLocaleString("zh-CN")} 条）`}</h2>
        <p className="ml-[38px] mt-1 text-sm text-[#778397]">{scopeLabel}；筛选条件按交集生效，先限定客户范围，再选择当前页、全部查询结果或指定客户。</p>
      </div>
      <div className="p-4">
        <div className="grid gap-3 rounded-lg border border-[#d7e5ff] bg-[#f3f7ff] p-3 lg:grid-cols-2">
          <button type="button" onClick={() => { const next = { ...draft, analysis_selection_mode: "FIRST" as const, screening_task_ids: [] }; setDraft(next); setFilters(next); setPage(1); setQueryIds([]); setSelected(new Set()); void load(true, next, 1); }} className={`rounded-lg border p-3 text-left ${draft.analysis_selection_mode === "FIRST" ? "border-blue-500 bg-white" : "border-transparent"}`}><b className="block text-sm text-slate-800">首次筛选</b><span className="mt-1 block text-xs leading-5 text-slate-500">仅加载尚未形成AI结论的客户；默认全选，避免遗漏新增数据。</span></button>
          <button type="button" onClick={() => { const next = { ...draft, analysis_selection_mode: "REVERIFY" as const }; setDraft(next); setFilters(next); setPage(1); setQueryIds([]); setSelected(new Set()); void load(false, next, 1); }} className={`rounded-lg border p-3 text-left ${draft.analysis_selection_mode === "REVERIFY" ? "border-blue-500 bg-white" : "border-transparent"}`}><b className="block text-sm text-slate-800">指定客户复验</b><span className="mt-1 block text-xs leading-5 text-slate-500">仅加载已有AI结论的客户；必须手动勾选，重新采集真实来源，不复用旧结论。</span></button>
        </div>
        <div className="mt-3 rounded-lg border border-[#d7e5ff] bg-[#f3f7ff] px-3 py-[10px] text-sm text-[#40608c]"><b>资格限制：</b>{draft.analysis_selection_mode === "REVERIFY" ? "复验仅限已有已完成AI结论、未删除且未加入其他活动任务的指定客户；每次复验均独立留痕。" : "首次筛选仅限从未完成AI筛选、未删除且未加入其他活动任务的客户。"}</div>
        <div className="mt-3 grid items-end gap-[10px] xl:grid-cols-[minmax(260px,1.35fr)_minmax(180px,.8fr)_minmax(170px,.75fr)_minmax(220px,1fr)_minmax(220px,1fr)_auto]">
          <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">客户关键词 / 国家地区</span><input autoComplete="off" name="ai-customer-keyword-country" className={`${input} w-full`} value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="公司、联系人、电话、邮箱、国家或地区"/></label>
          {canSelectOwner ? <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">客户归属人</span><select className={`${input} w-full`} value={draft.owner_id || "all"} onChange={(event) => changeOwner(event.target.value)}><option value="all">{allScopeLabel}</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name?.trim() || owner.email}</option>)}</select></label> : null}
          <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">数据来源渠道</span><select className={`${input} w-full`} value={draft.source_channel} onChange={(event) => setDraft((current) => ({ ...current, source_channel: event.target.value, source_batches: [] }))}><option value="">全部渠道</option>{sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.value === "MANUAL" ? "手动新增" : item.value === "BATCH_IMPORT" ? "批量导入" : item.value}（{item.count}）</option>)}</select></label>
          {draft.source_channel === "BATCH_IMPORT" ? <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">导入批次（可多选）</span><ImportBatchMultiSelect options={batches.map((batch) => ({ ...batch, display_time: compactBatchTime(batch.created_at) }))} value={draft.source_batches} onChange={(source_batches) => setDraft((current) => ({ ...current, source_batches }))} emptyText="当前归属人与来源条件下没有可选导入批次" /></label> : null}
          {draft.analysis_selection_mode === "REVERIFY" ? <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">AI筛选批次（可多选）</span><ImportBatchMultiSelect options={screeningTasks.map((task) => ({ id: task.value, filename: task.label, created_at: null, customer_count: task.count, legacy: true }))} value={draft.screening_task_ids} onChange={(screening_task_ids) => setDraft((current) => ({ ...current, screening_task_ids }))} placeholder="选择已完成的AI筛选批次" emptyText="当前归属人与来源条件下没有可选AI筛选批次" /></label> : null}
          <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">进入系统日期</span><div className="grid grid-cols-2 gap-2"><input type="date" aria-label="进入系统开始日期" className={`${input} min-w-0`} value={draft.date_from} onChange={(event) => setDraft({ ...draft, date_from: event.target.value })}/><input type="date" aria-label="进入系统结束日期" className={`${input} min-w-0`} value={draft.date_to} onChange={(event) => setDraft({ ...draft, date_to: event.target.value })}/></div></label>
          <div className="flex gap-2"><button type="button" className={button} onClick={resetFilters}>重置条件</button><button type="button" className={primaryButton} onClick={applyFilters}><Search size={16}/>查询客户</button></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#e8ecf2] px-4 py-[11px]"><div><b className="text-sm text-[#1763e8]">已选 {selectedRows.toLocaleString("zh-CN")} 条</b><span className="text-sm text-[#657187]"> / 当前查询共 {queryIds.length.toLocaleString("zh-CN")} 条</span><span className="mt-0.5 block text-xs text-[#8994a5]">{filters.analysis_selection_mode === "REVERIFY" ? "复验必须由您明确勾选；每条均重新分析并独立记录。" : "已默认加载并选中全部可加入任务的待筛选客户。"}</span></div><div className="flex gap-2"><button className={`${button} h-8 px-3 text-[13px]`} type="button" onClick={() => setSelected(new Set(queryIds))}>全选全部查询结果</button><button className={`${button} h-8 px-3 text-[13px]`} type="button" onClick={() => setSelected(new Set())}>清空选择</button></div></div>
      {error ? <ErrorState message={error} reload={() => void load(filters.analysis_selection_mode === "FIRST")}/> : loading ? <Loading text={filters.analysis_selection_mode === "REVERIFY" ? "正在查询可复验客户…" : "正在查询待AI筛选客户…"}/> : <div className="overflow-x-auto"><table className="w-full min-w-[1180px] border-collapse text-left text-sm"><thead className="bg-[#f7f9fc] text-[#58657a]"><tr><th className="w-12 px-[11px] py-[10px]"><input type="checkbox" checked={allPage} onChange={togglePage} aria-label="选择当前页"/></th>{["客户名称", ...(canSelectOwner ? ["归属人"] : []), "国家 / 地区","数据来源渠道","批次 / 获客任务","进入系统时间", ...(filters.analysis_selection_mode === "REVERIFY" ? ["最新AI分析时间", "已完成分析次数"] : []), "任务资格"].map((label) => <th key={label} className="px-[11px] py-[10px] font-semibold">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[#edf0f4] hover:bg-[#fafcff]"><td className="px-[11px] py-[11px]"><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); if(next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}/></td><td className="px-[11px] py-[11px]"><b className="font-semibold text-[#145edb]">{item.company_name}</b></td>{canSelectOwner ? <td className="px-[11px] py-[11px] text-[#657187]">{item.owner?.name?.trim() || item.owner?.email || "未归属"}</td> : null}<td className="px-[11px] py-[11px]"><CountryLabel value={item.country}/></td><td className="px-[11px] py-[11px]">{item.source || "-"}</td><td className="px-[11px] py-[11px]">{item.source_batch || "-"}</td><td className="px-[11px] py-[11px] text-[#657187]">{new Date(item.created_at).toLocaleString("zh-CN")}</td>{filters.analysis_selection_mode === "REVERIFY" ? <><td className="px-[11px] py-[11px] text-[#657187]">{item.latest_analysis_at ? new Date(item.latest_analysis_at).toLocaleString("zh-CN") : "-"}</td><td className="px-[11px] py-[11px] text-center">{item.completed_analysis_count || 0} 次</td></> : null}<td className="px-[11px] py-[11px]"><span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{filters.analysis_selection_mode === "REVERIFY" ? "可复验" : "可加入"}</span></td></tr>)}</tbody></table>{!items.length ? <div className="p-12 text-center text-sm text-slate-400">{filters.analysis_selection_mode === "REVERIFY" ? "当前条件下没有可复验客户" : "当前条件下没有可加入任务的待筛选客户"}</div> : null}</div>}
      <Pagination page={page} pageSize={pageSize} total={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
    </section>

    <div className="grid items-start gap-[14px] xl:grid-cols-[minmax(0,1.45fr)_minmax(290px,.55fr)]"><section className={panel}><div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8ecf2] px-4 py-[14px]"><div><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[25px] w-[25px] place-items-center rounded-full bg-[#1763e8] text-[13px] text-white">3</span>选择分析模式</h2><p className="ml-8 mt-1 text-[13px] text-[#778397]">两种模式采用相同的主体核验、官网深度分析和评分规则，仅付费补证权限不同。</p></div><Link href="/ai-screening/strategies" className={`${button} h-8 px-3 text-xs`}>查看分析规则</Link></div><div className="p-4"><div className="grid gap-[14px] lg:grid-cols-2">{[
      { key: "ADAPTIVE" as const, title: "智能增强分析", badge: "推荐", description: "官网与公开来源优先，明确结论立即停止；只有高价值且仍存在冲突的客户才按需付费补证，OpenAI每位客户最多1次。", steps: ["主体匹配","官网与公开来源","必要时付费补证","可审计结论"] },
      { key: "FREE_ONLY" as const, title: "全免费分析", badge: "零付费调用", description: "使用完整免费证据链，禁止所有会产生费用的Google详情和OpenAI调用。", steps: ["主体匹配","官网深度分析","免费公开来源","可审计结论"] },
    ].map((item) => <button type="button" onClick={()=>setCostMode(item.key)} key={item.key} className={`relative rounded-xl border p-[18px] text-left text-[#334158] transition ${costMode===item.key?"border-[#1763e8] shadow-[0_0_0_2px_#e7efff]":"border-[#dfe5ee] hover:border-blue-300"}`}><span className={`absolute right-3 top-3 rounded-[5px] px-[7px] py-[3px] text-xs ${item.key==="FREE_ONLY"?"bg-emerald-50 text-emerald-700":"bg-[#eaf1ff] text-[#1763e8]"}`}>{item.badge}</span><h3 className="pr-20 text-[17px] font-semibold">{item.title}</h3><p className="mb-3 mt-1 min-h-12 text-sm leading-6 text-[#6f7c90]">{item.description}</p><div className="flex flex-wrap items-center gap-1 text-xs text-[#46546a]">{item.steps.map((label,index)=><span key={label} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f4f7fb] px-2 py-[5px]">{label}</span>{index<3?<span className="text-[#9aa6b6]">→</span>:null}</span>)}</div>{costMode===item.key?<Check className={`absolute bottom-4 right-4 ${item.key==="FREE_ONLY"?"text-emerald-600":"text-[#1763e8]"}`} size={19}/>:null}</button>)}</div>{costMode==="ADAPTIVE"?<label className="mt-4 block rounded-lg border bg-slate-50 p-3 text-sm font-medium text-slate-700">本任务付费API最高预算（USD，可选）<input type="number" min="0" step="0.01" value={taskCostLimit} onChange={event=>setTaskCostLimit(event.target.value)} placeholder="留空则继承系统全局上限" className={`${input} ml-3 w-56`}/><small className="ml-3 font-normal text-slate-500">任务达到上限后自动改用免费渠道，不会突破管理员全局限制。</small></label>:<div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-[10px] text-sm text-emerald-800"><b>费用保证：</b>本任务允许使用明确免费的查询，但所有正金额第三方API请求都会在后端被拦截。</div>}</div></section><aside className="sticky top-[78px] rounded-[9px] border border-[#dce5f4] bg-[#f8faff] p-[14px]"><h3 className="mb-[10px] font-semibold">创建前确认</h3><dl className="text-sm">{[["客户范围",filters.search||filters.source_channel||filters.source_batches.length||filters.screening_task_ids.length||filters.date_from||filters.date_to?"当前查询结果":"全部待筛选客户"],["已选择",`${selectedRows.toLocaleString("zh-CN")} 条`],["筛选条件",filters.source_channel ? `${filters.source_channel === "MANUAL" ? "手动新增" : filters.source_channel === "BATCH_IMPORT" ? "批量导入" : filters.source_channel}${filters.source_batches.length ? ` · ${filters.source_batches.length} 个导入批次` : ""}${filters.screening_task_ids.length ? ` · ${filters.screening_task_ids.length} 个AI筛选批次` : ""}` : filters.screening_task_ids.length ? `${filters.screening_task_ids.length} 个AI筛选批次` : "全部来源"],["分析模式",costMode==="FREE_ONLY"?"全免费分析":"智能增强分析"],["执行环境","Vercel 云端 Workflow"],["任务费用上限",costMode==="FREE_ONLY"?"$0.00":taskCostLimit?`$${Number(taskCostLimit).toFixed(2)}`:"继承全局上限"]].map(([label,value]) => <div key={label} className="flex justify-between gap-[10px] border-b border-dashed border-[#dbe2ec] py-[7px]"><dt className="text-[#6f7c90]">{label}</dt><dd className="max-w-[190px] text-right font-semibold">{value}</dd></div>)}</dl><p className="mt-2 text-xs leading-5 text-slate-500">提交后由绑定账户的 Vercel 云端 Workflow 执行。</p><button disabled={saving || !selected.size} className={`${primaryButton} mt-[14px] w-full`} onClick={() => void createTask()}>{saving ? "正在创建…" : "确认创建并执行"}</button></aside></div>
  </div>{toastNode}{rulesOpen?<AppDialog title="AI分析规则" description="查看规则不会离开创建页；已填写的任务名称、筛选条件和勾选客户都会保留。" onClose={() => setRulesOpen(false)} width="max-w-5xl"><div className="space-y-4"><div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><b>共同流程：</b>字段清洗与主体匹配 → 官网和免费公开来源 → 证据足够立即完成 → 必要时受控付费补证 → 评分、依据与调用留痕</div><div className="grid gap-4 lg:grid-cols-2"><article className="rounded-xl border border-blue-200 bg-blue-50/30 p-4"><b className="text-blue-800">智能增强分析</b><p className="mt-2 text-sm leading-6 text-slate-600">优先完成免费证据链；仅在客户仍具潜在价值且关键证据冲突时，才在费用开关、任务预算和日/周/月上限内补充 Google Places 或 OpenAI 证据。</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600"><li>证据足够立即停止，不发生不必要付费调用。</li><li>Google 只核验主体匹配度最高的少数候选。</li><li>OpenAI 只综合已采集且通过主体校验的证据，每位客户最多一次。</li></ul></article><article className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4"><b className="text-emerald-800">全免费分析</b><p className="mt-2 text-sm leading-6 text-slate-600">采用相同主体核验、官网深度分析、证据规则和评分标准，但后端严格拦截所有正金额第三方调用。</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600"><li>分析已确认官网及必要服务、联系和门店页。</li><li>使用可核验免费入口与 Google IDs Only。</li><li>抓取失败、证据不足或主体冲突不能伪造成无效客户。</li></ul></article></div><section className="rounded-xl border bg-slate-50 p-4"><h3 className="font-semibold">评分与审计原则</h3><div className="mt-3 grid gap-3 text-sm leading-6 text-slate-600 md:grid-cols-2"><p><b className="text-slate-800">行业结论：</b>必须有可追溯经营事实支持，原始类别不直接作为评分依据。</p><p><b className="text-slate-800">评分：</b>按业务相关性、证据强度、主体置信度和规模价值计算，不使用固定分数兜底。</p><p><b className="text-slate-800">联系方式：</b>只回写已确认官网或匹配商家页公开信息，保留具体来源且不覆盖原字段。</p><p><b className="text-slate-800">审计：</b>保留规则版本、证据来源、渠道状态、停止原因、Token、费用和完成时间。</p></div></section></div><div className="mt-5 flex justify-end border-t pt-4"><button type="button" onClick={() => setRulesOpen(false)} className={button}>关闭</button></div></AppDialog>:null}</main>;
}
