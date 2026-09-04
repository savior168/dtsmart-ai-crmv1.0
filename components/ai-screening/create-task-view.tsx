"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Info, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountryLabel } from "@/components/country-label";
import { ImportBatchMultiSelect, type ImportBatchOption } from "@/components/import-batch-multi-select";
import { ErrorState, Loading, PageHeader, Pagination, button, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";

type CustomerRow = { id: string; company_name: string; contact_name?: string | null; country?: string | null; phone?: string | null; email?: string | null; website?: string | null; google_url?: string | null; source?: string | null; source_batch?: string | null; created_at: string; owner?: { name?: string | null; email?: string | null } | null };
type OwnerOption = { id: string; name?: string | null; email: string; role: string };
type SourceOption = { value: string; count: number };
type Batch = ImportBatchOption & { pending_count: number };
type Filters = { search: string; country: string; source_channel: string; source_batches: string[]; date_from: string; date_to: string; owner_id: string };
const emptyFilters: Filters = { search: "", country: "", source_channel: "", source_batches: [], date_from: "", date_to: "", owner_id: "" };

function queryString(filters: Filters, page: number, pageSize: number, ids = false) {
  const params = new URLSearchParams({ search: filters.search, country: filters.country, source_channel: filters.source_channel, date_from: filters.date_from, date_to: filters.date_to, page: String(page), pageSize: String(pageSize) });
  if (filters.owner_id) params.set("owner_id", filters.owner_id);
  filters.source_batches.forEach((batchId) => params.append("source_batch", batchId));
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
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [queryIds, setQueryIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batches, setBatches] = useState<Batch[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [canSelectOwner, setCanSelectOwner] = useState(false);
  const [scopeLabel, setScopeLabel] = useState("我的待筛选客户");
  const [allScopeLabel, setAllScopeLabel] = useState("全部可选客户");
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [strategy, setStrategy] = useState<"SMART" | "DEEP">("SMART");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [strategyModal, setStrategyModal] = useState(false);
  const { toast, node: toastNode } = useToast();
  const requestKey = useRef(crypto.randomUUID());
  const loadSequence = useRef(0);

  const load = useCallback(async (selectAll = false, activeFilters = filters, activePage = page) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    const [listResponse, idsResponse] = await Promise.all([
      fetch(`/api/ai/customers?${queryString(activeFilters, activePage, pageSize)}`, { cache: "no-store" }),
      selectAll || !queryIds.length ? fetch(`/api/ai/customers?${queryString(activeFilters, 1, 20, true)}`, { cache: "no-store" }) : null,
    ]);
    const listBody = await listResponse.json().catch(() => ({}));
    const idsBody = idsResponse ? await idsResponse.json().catch(() => ({})) : null;
    // 切换归属人时，忽略先前请求的迟到结果，避免把旧用户的来源/批次混入当前选择。
    if (sequence !== loadSequence.current) return;
    setLoading(false);
    if (!listResponse.ok || (idsResponse && !idsResponse.ok)) { setError(listBody.error || idsBody?.error || "待筛选客户查询失败"); return; }
    setItems(listBody.data || []); setCount(listBody.count || 0); setBatches(listBody.batches || []); setOwners(listBody.owner_options || []); setSourceOptions(listBody.source_options || []); setCanSelectOwner(Boolean(listBody.can_select_owner)); setScopeLabel(String(listBody.scope_label || "我的待筛选客户")); setAllScopeLabel(String(listBody.all_scope_label || "全部可选客户"));
    if (!activeFilters.owner_id && listBody.selected_owner_id && String(listBody.selected_owner_id) !== "all") setDraft((current) => current.owner_id ? current : { ...current, owner_id: String(listBody.selected_owner_id) });
    if (idsBody) { const ids = idsBody.ids || []; setQueryIds(ids); if (selectAll || selected.size === 0) setSelected(new Set(ids)); }
  }, [filters, page, pageSize, queryIds.length, selected.size]);
  useEffect(() => { void load(true); /* initial query intentionally selects every eligible customer */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (queryIds.length) void load(false); }, [page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  const allPage = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectedRows = useMemo(() => selected.size, [selected]);

  function applyFilters() { const next={...draft};setFilters(next);setPage(1);setQueryIds([]);setSelected(new Set());void load(true,next,1); }
  function resetFilters() { setDraft(emptyFilters);setFilters(emptyFilters);setPage(1);setQueryIds([]);setSelected(new Set());void load(true,emptyFilters,1); }
  function changeOwner(owner_id: string) {
    const next = { ...draft, owner_id, source_batches: [] };
    setDraft(next); setFilters(next); setPage(1); setQueryIds([]); setSelected(new Set());
    void load(true, next, 1);
  }
  function togglePage() { setSelected((current) => { const next = new Set(current); if (allPage) items.forEach((item) => next.delete(item.id)); else items.forEach((item) => next.add(item.id)); return next; }); }

  async function createTask() {
    if (!name.trim()) return toast("请输入任务名称", "error");
    if (!selected.size) return toast("请至少选择一条待筛选客户", "error");
    if (scheduleType === "scheduled" && (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now())) return toast("请选择晚于当前时间的预约执行时间", "error");
    setSaving(true);
    const response = await fetch("/api/ai/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), strategy, scheduled_at: scheduleType === "scheduled" ? scheduledAt : null, customer_ids: [...selected], filters, request_key: requestKey.current }) });
    const body = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) return toast(body.error || "AI筛选任务创建失败", "error");
    toast("AI筛选任务已创建，服务端将持续执行");
    router.push(`/ai-screening/tasks/${body.task.id}`);
  }

  return <main className="ai-create-task-page min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="创建AI筛选任务" description="设置任务、筛选并选择客户、选择分析策略，确认后由服务端持续执行。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className={panel}><div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">1</span>任务基本信息</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">任务名称用于后续查询、费用统计和报告归档。</p></div><div className="grid gap-3 p-4 lg:grid-cols-[minmax(480px,1.55fr)_minmax(360px,1fr)]"><label className="space-y-[5px]"><span className="block text-sm font-medium">任务名称</span><input className={`${input} w-full`} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：西班牙8月新客户智能分析" maxLength={80}/></label><div className="space-y-[5px]"><span className="block text-sm font-medium">执行时间</span><div className={`grid gap-3 ${scheduleType === "scheduled" ? "grid-cols-[180px_1fr]" : "grid-cols-[180px]"}`}><select className={`${input} w-full`} value={scheduleType} onChange={(event) => setScheduleType(event.target.value as "now" | "scheduled")}><option value="now">立即执行</option><option value="scheduled">预约执行</option></select>{scheduleType === "scheduled" ? <label className="relative"><CalendarClock className="absolute left-3 top-[11px] text-slate-400" size={16}/><input type="datetime-local" className={`${input} w-full pl-10`} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}/></label> : null}</div></div></div></section>

    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">2</span>筛选并选择客户（待AI筛选 {count.toLocaleString("zh-CN")} 条）</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">{scopeLabel}；先用条件缩小范围，再选择当前页、全部查询结果或指定客户。</p></div><div className="p-4"><div className="rounded-lg border border-[#d7e5ff] bg-[#f3f7ff] px-3 py-[10px] text-sm text-[#40608c]"><b>自动资格限制：</b>只查询当前用户有权限、从未完成AI筛选、未删除且未加入其他活动任务的客户。</div><div className="mt-3 grid items-end gap-[10px] xl:grid-cols-[minmax(190px,.8fr)_minmax(220px,1.2fr)_minmax(160px,.7fr)_minmax(170px,.7fr)_minmax(220px,1fr)_minmax(230px,1fr)_auto]">{canSelectOwner ? <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">客户归属人</span><select className={`${input} w-full`} value={draft.owner_id || "all"} onChange={(event) => changeOwner(event.target.value)}><option value="all">{allScopeLabel}</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name?.trim() || owner.email}{owner.email && owner.name?.trim() ? `（${owner.email}）` : ""}</option>)}</select></label> : null}<label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">客户关键词</span><input autoComplete="off" name="ai-customer-keyword" className={`${input} w-full`} value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="公司名、联系人、邮箱或完整电话"/></label><label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">国家 / 地区</span><input autoComplete="off" name="ai-customer-country" className={`${input} w-full`} value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })} placeholder="国家中文名或代码"/></label><label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">数据来源渠道</span><select className={`${input} w-full`} value={draft.source_channel} onChange={(event) => setDraft({ ...draft, source_channel: event.target.value, source_batches: [] })}><option value="">全部渠道</option>{sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.value === "MANUAL" ? "手动新增" : item.value === "BATCH_IMPORT" ? "批量导入" : item.value}（{item.count}）</option>)}</select></label>{draft.source_channel === "BATCH_IMPORT" ? <label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">导入批次（可多选）</span><ImportBatchMultiSelect options={batches.map((batch) => ({ ...batch, display_time: compactBatchTime(batch.created_at) }))} value={draft.source_batches} onChange={(source_batches) => setDraft((current) => ({ ...current, source_batches }))} emptyText="该归属人当前没有仍含待筛选客户的导入批次" /></label> : <div className="hidden xl:block"/>}<label className="space-y-[5px]"><span className="block text-sm text-[#58657a]">进入系统日期</span><div className="grid grid-cols-2 gap-2"><input type="date" aria-label="进入系统开始日期" className={`${input} min-w-0`} value={draft.date_from} onChange={(event) => setDraft({ ...draft, date_from: event.target.value })}/><input type="date" aria-label="进入系统结束日期" className={`${input} min-w-0`} value={draft.date_to} onChange={(event) => setDraft({ ...draft, date_to: event.target.value })}/></div></label><div className="flex gap-2"><button type="button" className={button} onClick={resetFilters}>重置条件</button><button type="button" className={primaryButton} onClick={applyFilters}><Search size={16}/>查询客户</button></div></div></div><div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#e8ecf2] px-4 py-[11px]"><div><b className="text-sm text-[#1763e8]">已选 {selectedRows.toLocaleString("zh-CN")} 条</b><span className="text-sm text-[#657187]"> / 当前查询共 {queryIds.length.toLocaleString("zh-CN")} 条</span><span className="mt-0.5 block text-xs text-[#8994a5]">已默认加载并选中全部可加入任务的待筛选客户</span></div><div className="flex gap-2"><button className={`${button} h-8 px-3 text-[13px]`} type="button" onClick={() => setSelected(new Set(queryIds))}>全选全部查询结果</button><button className={`${button} h-8 px-3 text-[13px]`} type="button" onClick={() => setSelected(new Set())}>清空选择</button></div></div>
      {error ? <ErrorState message={error} reload={() => void load(true)}/> : loading ? <Loading text="正在查询待AI筛选客户…"/> : <div className="overflow-x-auto"><table className="w-full min-w-[1040px] border-collapse text-left text-sm"><thead className="bg-[#f7f9fc] text-[#58657a]"><tr><th className="w-12 px-[11px] py-[10px]"><input type="checkbox" checked={allPage} onChange={togglePage} aria-label="选择当前页"/></th>{["客户名称", ...(canSelectOwner ? ["归属人"] : []), "国家 / 地区","数据来源渠道","批次 / 获客任务","进入系统时间","任务资格"].map((label) => <th key={label} className="px-[11px] py-[10px] font-semibold">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[#edf0f4] hover:bg-[#fafcff]"><td className="px-[11px] py-[11px]"><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); if(next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}/></td><td className="px-[11px] py-[11px]"><b className="font-semibold text-[#145edb]">{item.company_name}</b></td>{canSelectOwner ? <td className="px-[11px] py-[11px] text-[#657187]">{item.owner?.name?.trim() || item.owner?.email || "未归属"}</td> : null}<td className="px-[11px] py-[11px]"><CountryLabel value={item.country}/></td><td className="px-[11px] py-[11px]">{item.source || "-"}</td><td className="px-[11px] py-[11px]">{item.source_batch || "-"}</td><td className="px-[11px] py-[11px] text-[#657187]">{new Date(item.created_at).toLocaleString("zh-CN")}</td><td className="px-[11px] py-[11px]"><span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">可加入</span></td></tr>)}</tbody></table>{!items.length ? <div className="p-12 text-center text-sm text-slate-400">当前条件下没有可加入任务的待筛选客户</div> : null}</div>}<Pagination page={page} pageSize={pageSize} total={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/></section>

    <div className="grid items-start gap-[14px] xl:grid-cols-[minmax(0,1.45fr)_minmax(290px,.55fr)]"><section className={panel}><div className="flex items-start justify-between gap-3 border-b border-[#e8ecf2] px-4 py-[14px]"><div><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[25px] w-[25px] place-items-center rounded-full bg-[#1763e8] text-[13px] text-white">3</span>选择系统分析策略</h2><p className="ml-8 mt-1 text-[13px] text-[#778397]">只需选择一种策略；渠道顺序与停止规则由系统固定，OpenAI调用严格按所选策略执行。</p></div><button className={`${button} h-8 px-[9px] text-[13px]`} onClick={() => setStrategyModal(true)}><Info size={15}/>查看完整策略说明</button></div><div className="p-4"><div className="grid gap-[14px] lg:grid-cols-2">{[
      { key: "SMART" as const, title: "智能分析", recommended: true, description: "官网与Google商家并行核验；直接证据足够时由规则完成，必要时才补充渠道并调用快速模型。", meta: [["优先来源","官网 + Google商家并行"],["模型调用","仅规则无法可靠判断时，最多1次"],["适合","日常批量筛选，速度与成本优先"]] },
      { key: "DEEP" as const, title: "深度分析", recommended: false, description: "同样先核验高价值来源；证据不足或矛盾时扩大公开渠道，并使用深度模型交叉判断。", meta: [["优先来源","官网 + Google商家并行"],["模型调用","必要时深度判断；矛盾时最多再核验1次"],["适合","重点客户与争议证据复核"]] },
    ].map((item) => <button key={item.key} onClick={() => setStrategy(item.key)} className={`relative rounded-xl border p-[18px] text-left text-[#334158] transition ${strategy === item.key ? "border-[#1763e8] shadow-[0_0_0_2px_#e7efff]" : "border-[#dfe5ee] hover:border-[#b7cdf7]"}`}>{item.recommended ? <span className="absolute right-3 top-3 rounded-[5px] bg-[#eaf1ff] px-[7px] py-[3px] text-xs text-[#1763e8]">默认推荐</span> : null}<h3 className="text-[17px] font-semibold">{item.title}</h3><p className="mb-3 mt-1 text-sm text-[#6f7c90]">{item.description}</p><div className="my-[11px] flex flex-wrap items-center gap-1 text-xs text-[#46546a]">{["官网 + Google商家（并行）","必要时补充官方公开渠道","规则引擎 / OpenAI"].map((label, index) => <span key={label} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f4f7fb] px-2 py-[5px]">{label}</span>{index < 2 ? <span className="text-[#9aa6b6]">→</span> : null}</span>)}</div><div className="grid gap-[7px] text-[13px] text-[#59677b]">{item.meta.map(([label,value])=><span key={label} className="flex justify-between gap-3 border-t border-[#edf0f4] pt-[7px]"><b>{label}</b><em className="not-italic">{value}</em></span>)}</div>{strategy === item.key ? <Check className="absolute bottom-4 right-4 text-[#1763e8]" size={19}/> : null}</button>)}</div><div className="mt-3 rounded-lg border border-[#d7e5ff] bg-[#f3f7ff] px-3 py-[10px] text-sm text-[#40608c]"><b>真实执行与记录：</b>两种策略都先使用代码规则、缓存、官网和Google商家证据，足够判断后不重复消耗模型；任务及客户保存策略、渠道状态、证据、模型、Token和费用。</div></div></section><aside className="sticky top-[78px] rounded-[9px] border border-[#dce5f4] bg-[#f8faff] p-[14px]"><h3 className="mb-[10px] font-semibold">创建前确认</h3><dl className="text-sm">{[["客户范围",filters.search||filters.country||filters.source_channel||filters.source_batches.length||filters.date_from||filters.date_to?"当前查询结果":"全部待筛选客户"],["已选择",`${selectedRows.toLocaleString("zh-CN")} 条`],["筛选条件",filters.source_channel ? `${filters.source_channel === "MANUAL" ? "手动新增" : filters.source_channel === "BATCH_IMPORT" ? "批量导入" : filters.source_channel}${filters.source_batches.length ? ` · ${filters.source_batches.length} 个批次` : ""}` : "全部来源"],["分析策略",strategy === "SMART" ? "智能分析" : "深度分析"],["执行规则",strategy === "SMART" ? "证据优先；必要时调用1次快速模型" : "证据优先；矛盾时允许深度交叉核验"]].map(([label,value]) => <div key={label} className="flex justify-between gap-[10px] border-b border-dashed border-[#dbe2ec] py-[7px]"><dt className="text-[#6f7c90]">{label}</dt><dd className="max-w-[190px] text-right font-semibold">{value}</dd></div>)}</dl><button disabled={saving || !selected.size} className={`${primaryButton} mt-[14px] w-full`} onClick={() => void createTask()}>{saving ? "正在创建…" : "确认创建并执行"}</button></aside></div>
  </div>{toastNode}{strategyModal ? <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setStrategyModal(false); }}><div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">两种AI分析策略</h2><p className="mt-1 text-sm text-slate-500">说明与服务端当前执行逻辑一致；两种策略都避免重复采集和无必要的模型调用。</p></div><div className="flex items-center gap-2"><Link href="/ai-screening/strategies" className={`${button} h-8 px-3 text-[13px]`}>打开完整说明</Link><button className="rounded-lg p-2 hover:bg-slate-100" aria-label="关闭策略说明" onClick={() => setStrategyModal(false)}><X size={18}/></button></div></div><div className="mt-5 grid gap-4 md:grid-cols-2"><article className="rounded-xl border border-blue-200 bg-blue-50/40 p-5"><h3 className="font-semibold text-blue-700">智能分析（默认）</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>先并行读取已确认官网与Google商家，命中历史可靠结果时直接复用。</li><li>直接经营证据足够时由规则引擎完成，不调用OpenAI。</li><li>仍无法可靠判断时，按需补充已发现的官方公开渠道，并最多调用1次快速模型。</li><li>适合日常批量筛选，优先速度与低成本。</li></ul></article><article className="rounded-xl border border-violet-200 bg-violet-50/40 p-5"><h3 className="font-semibold text-violet-700">深度分析</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>同样并行核验官网与Google商家，证据充分时不会机械遍历无关渠道。</li><li>证据不足时补充已确认的官方公开渠道，并使用深度模型判断。</li><li>存在证据矛盾且首轮模型不能解决时，最多再执行1次升级核验。</li><li>适合重点客户或争议证据，准确性优先且仍控制费用。</li></ul></article></div></div></div> : null}</main>;
}
