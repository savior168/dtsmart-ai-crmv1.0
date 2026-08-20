"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Info, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CountryLabel } from "@/components/country-label";
import { ErrorState, Loading, PageHeader, Pagination, button, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";

type CustomerRow = { id: string; company_name: string; contact_name?: string | null; country?: string | null; phone?: string | null; email?: string | null; website?: string | null; google_url?: string | null; source?: string | null; source_batch?: string | null; created_at: string };
type Batch = { id: string; filename: string; created_at: string };
type Filters = { search: string; country: string; source_channel: string; source_batch: string; date_from: string; date_to: string };
const emptyFilters: Filters = { search: "", country: "", source_channel: "", source_batch: "", date_from: "", date_to: "" };

function queryString(filters: Filters, page: number, pageSize: number, ids = false) {
  const params = new URLSearchParams({ ...filters, page: String(page), pageSize: String(pageSize) });
  if (ids) params.set("ids", "all");
  return params.toString();
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
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [strategy, setStrategy] = useState<"SMART" | "DEEP">("SMART");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [strategyModal, setStrategyModal] = useState(false);
  const { toast, node: toastNode } = useToast();

  const load = useCallback(async (selectAll = false, activeFilters = filters, activePage = page) => {
    setLoading(true); setError("");
    const [listResponse, idsResponse] = await Promise.all([
      fetch(`/api/ai/customers?${queryString(activeFilters, activePage, pageSize)}`, { cache: "no-store" }),
      selectAll || !queryIds.length ? fetch(`/api/ai/customers?${queryString(activeFilters, 1, 20, true)}`, { cache: "no-store" }) : null,
    ]);
    const listBody = await listResponse.json().catch(() => ({}));
    const idsBody = idsResponse ? await idsResponse.json().catch(() => ({})) : null;
    setLoading(false);
    if (!listResponse.ok || (idsResponse && !idsResponse.ok)) { setError(listBody.error || idsBody?.error || "待筛选客户查询失败"); return; }
    setItems(listBody.data || []); setCount(listBody.count || 0); setBatches(listBody.batches || []);
    if (idsBody) { const ids = idsBody.ids || []; setQueryIds(ids); if (selectAll || selected.size === 0) setSelected(new Set(ids)); }
  }, [filters, page, pageSize, queryIds.length, selected.size]);
  useEffect(() => { void load(true); /* initial query intentionally selects every eligible customer */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (queryIds.length) void load(false); }, [page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  const allPage = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectedRows = useMemo(() => selected.size, [selected]);

  function applyFilters() { const next={...draft};setFilters(next);setPage(1);setQueryIds([]);setSelected(new Set());void load(true,next,1); }
  function resetFilters() { setDraft(emptyFilters);setFilters(emptyFilters);setPage(1);setQueryIds([]);setSelected(new Set());void load(true,emptyFilters,1); }
  function togglePage() { setSelected((current) => { const next = new Set(current); if (allPage) items.forEach((item) => next.delete(item.id)); else items.forEach((item) => next.add(item.id)); return next; }); }

  async function createTask() {
    if (!name.trim()) return toast("请输入任务名称", "error");
    if (!selected.size) return toast("请至少选择一条待筛选客户", "error");
    if (scheduleType === "scheduled" && (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now())) return toast("请选择晚于当前时间的预约执行时间", "error");
    setSaving(true);
    const response = await fetch("/api/ai/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), strategy, scheduled_at: scheduleType === "scheduled" ? scheduledAt : null, customer_ids: [...selected], filters, notification_mode: "IN_APP" }) });
    const body = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) return toast(body.error || "AI筛选任务创建失败", "error");
    toast("AI筛选任务已创建，服务端将持续执行");
    router.push(`/ai-screening/tasks/${body.task.id}`);
  }

  return <main className="min-h-full bg-[#f5f7fb] p-5 lg:p-6"><div className="mx-auto max-w-[1680px] space-y-5">
    <PageHeader title="创建AI筛选任务" description="设置任务、筛选并选择客户、选择分析策略，确认后由服务端持续执行。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className={panel}><div className="border-b px-5 py-4"><h2 className="font-semibold"><span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-sm text-white">1</span>任务基本信息</h2><p className="ml-9 mt-1 text-sm text-slate-500">任务名称用于后续查询、费用统计和报告归档。</p></div><div className="grid gap-4 p-5 lg:grid-cols-[minmax(360px,1fr)_520px]"><label className="space-y-2"><span className="text-sm font-medium">任务名称</span><input className={`${input} w-full`} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：西班牙8月新客户智能分析" maxLength={80}/></label><div className="space-y-2"><span className="text-sm font-medium">执行时间</span><div className="grid gap-3 sm:grid-cols-[180px_1fr]"><select className={`${input} w-full`} value={scheduleType} onChange={(event) => setScheduleType(event.target.value as "now" | "scheduled")}><option value="now">立即执行</option><option value="scheduled">预约执行</option></select>{scheduleType === "scheduled" ? <label className="relative"><CalendarClock className="absolute left-3 top-3 text-slate-400" size={16}/><input type="datetime-local" className={`${input} w-full pl-10`} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}/></label> : <div className="flex h-10 items-center rounded-lg border border-dashed border-blue-200 bg-blue-50 px-3 text-sm text-blue-700">创建后立即进入执行队列</div>}</div></div></div></section>

    <section className={`${panel} overflow-hidden`}><div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-semibold"><span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-sm text-white">2</span>筛选并选择客户（待AI筛选 {count.toLocaleString("zh-CN")} 条）</h2><p className="ml-9 mt-1 text-sm text-slate-500">默认展示并全选全部待筛选客户；可按条件缩小范围或手动取消指定客户。</p></div></div><div className="p-5"><div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700"><b>自动资格限制：</b>仅查询当前用户有权限、未删除、从未完成AI筛选且未加入其他活动任务的客户。</div><div className="mt-4 grid gap-3 xl:grid-cols-[1.25fr_.72fr_.75fr_1fr_1fr_auto]"><input className={`${input} w-full`} value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="公司名、联系人、邮箱或完整电话"/><input className={`${input} w-full`} value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })} placeholder="国家中文名或代码"/><select className={`${input} w-full`} value={draft.source_channel} onChange={(event) => setDraft({ ...draft, source_channel: event.target.value, source_batch: "" })}><option value="">全部数据来源</option>{["新增&导入","海关数据","Google Map","Facebook","Instagram","LinkedIn","其他"].map((value) => <option key={value}>{value}</option>)}</select><div><input list="ai-source-batches" className={`${input} w-full`} value={draft.source_batch} onChange={(event) => setDraft({ ...draft, source_batch: event.target.value })} placeholder={draft.source_channel === "新增&导入" ? "搜索匹配导入批次" : "搜索匹配导入批次/获客任务"}/><datalist id="ai-source-batches">{batches.map((batch) => <option key={batch.id} value={batch.filename}/>)}</datalist></div><div className="grid grid-cols-2 gap-2"><input type="date" aria-label="进入系统开始日期" className={`${input} min-w-0`} value={draft.date_from} onChange={(event) => setDraft({ ...draft, date_from: event.target.value })}/><input type="date" aria-label="进入系统结束日期" className={`${input} min-w-0`} value={draft.date_to} onChange={(event) => setDraft({ ...draft, date_to: event.target.value })}/></div><div className="flex gap-2"><button type="button" className={primaryButton} onClick={applyFilters}><Search size={16}/>查询</button><button type="button" className={button} onClick={resetFilters}>重置</button></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><b className="text-sm text-slate-700">已选 {selectedRows.toLocaleString("zh-CN")} 条 / 当前查询共 {queryIds.length.toLocaleString("zh-CN")} 条</b><div className="flex gap-2"><button className={button} type="button" onClick={() => setSelected(new Set(queryIds))}>全选全部查询结果</button><button className={button} type="button" onClick={() => setSelected(new Set())}>清空选择</button></div></div></div>
      {error ? <ErrorState message={error} reload={() => void load(true)}/> : loading ? <Loading text="正在查询待AI筛选客户…"/> : <div className="overflow-x-auto border-t"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-12 px-4 py-3"><input type="checkbox" checked={allPage} onChange={togglePage} aria-label="选择当前页"/></th>{["客户名称","国家/地区","完整号码","邮箱","官网","Google Maps","数据来源","进入系统时间"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100 hover:bg-blue-50/30"><td className="px-4 py-3"><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); if(next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}/></td><td className="px-4 py-3"><b className="font-medium">{item.company_name}</b><small className="mt-1 block text-slate-400">{item.contact_name || "-"}</small></td><td className="px-4 py-3"><CountryLabel value={item.country}/></td><td className="px-4 py-3">{item.phone || "-"}</td><td className="px-4 py-3">{item.email || "-"}</td><td className="max-w-48 truncate px-4 py-3 text-blue-600">{item.website || "-"}</td><td className="max-w-48 truncate px-4 py-3 text-blue-600">{item.google_url || "-"}</td><td className="px-4 py-3">{item.source || "-"}</td><td className="px-4 py-3 text-slate-500">{new Date(item.created_at).toLocaleDateString("zh-CN")}</td></tr>)}</tbody></table>{!items.length ? <div className="p-12 text-center text-sm text-slate-400">当前条件下没有可加入任务的待筛选客户</div> : null}</div>}<Pagination page={page} pageSize={pageSize} total={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/></section>

    <div className="grid items-start gap-5 xl:grid-cols-[1fr_360px]"><section className={panel}><div className="flex items-start justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-semibold"><span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-sm text-white">3</span>选择系统分析策略</h2><p className="ml-9 mt-1 text-sm text-slate-500">只需选择一种策略，渠道顺序与停止规则由系统固定执行。</p></div><button className={button} onClick={() => setStrategyModal(true)}><Info size={16}/>查看策略规则</button></div><div className="grid gap-4 p-5 lg:grid-cols-2">{[
      { key: "SMART" as const, title: "智能分析", recommended: true, description: "逐渠道深度分析，结论可靠后提前停止，平衡准确度、时间与费用。", stop: "可信度>90分、主体一致且无关键矛盾时停止", color: "border-blue-500 bg-blue-50/50" },
      { key: "DEEP" as const, title: "深度分析", recommended: false, description: "跑完全部可访问渠道后交叉核验，优先获得更完整的判断依据。", stop: "不提前停止，完成全部可访问渠道", color: "border-violet-500 bg-violet-50/40" },
    ].map((item) => <button key={item.key} onClick={() => setStrategy(item.key)} className={`relative rounded-xl border-2 p-5 text-left transition ${strategy === item.key ? item.color : "border-slate-200 bg-white hover:border-slate-300"}`}>{item.recommended ? <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-2 py-1 text-xs text-white">默认推荐</span> : null}<h3 className="text-lg font-semibold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p><div className="mt-4 flex flex-wrap items-center gap-1 text-xs text-slate-600">{["官网","Google商家","LinkedIn","Facebook","Instagram","其他"].map((label, index) => <span key={label} className="contents"><span className="rounded bg-white px-2 py-1 shadow-sm">{label}</span>{index < 5 ? <span>→</span> : null}</span>)}</div><p className="mt-4 text-xs font-medium text-slate-700">{item.stop}</p>{strategy === item.key ? <Check className="absolute bottom-4 right-4 text-blue-600" size={20}/> : null}</button>)}</div></section><aside className={`${panel} sticky top-20 p-5`}><h3 className="font-semibold">创建前确认</h3><dl className="mt-4 space-y-3 text-sm">{[["已选择",`${selectedRows.toLocaleString("zh-CN")} 条`],["当前查询",`${queryIds.length.toLocaleString("zh-CN")} 条`],["分析策略",strategy === "SMART" ? "智能分析 v1.0" : "深度分析 v1.0"],["执行时间",scheduleType === "now" ? "立即执行" : scheduledAt ? new Date(scheduledAt).toLocaleString("zh-CN") : "尚未设置"]].map(([label,value]) => <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl><button disabled={saving || !selected.size} className={`${primaryButton} mt-5 w-full`} onClick={() => void createTask()}>{saving ? "正在创建…" : "确认创建并执行"}</button><p className="mt-3 text-xs leading-5 text-slate-400">任务由服务端持久执行，关闭页面或切换菜单不会中断。</p></aside></div>
  </div>{toastNode}{strategyModal ? <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setStrategyModal(false); }}><div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">两种AI分析策略</h2><p className="mt-1 text-sm text-slate-500">两种策略渠道顺序一致，差别在是否提前停止；任务和每位客户均保存策略版本。</p></div><button className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setStrategyModal(false)}><X size={18}/></button></div><div className="mt-5 grid gap-4 md:grid-cols-2"><article className="rounded-xl border border-blue-200 bg-blue-50/40 p-5"><h3 className="font-semibold text-blue-700">智能分析（默认）</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>官网 → Google商家 → LinkedIn → Facebook → Instagram → 其他。</li><li>每完成一个渠道重新计算目标可信度。</li><li>可信度超过90分、主体一致且无关键矛盾时停止。</li><li>保存访问、跳过、停止原因、Token和费用。</li></ul></article><article className="rounded-xl border border-violet-200 bg-violet-50/40 p-5"><h3 className="font-semibold text-violet-700">深度分析</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>按相同顺序分析全部可访问公开渠道。</li><li>中途可信度超过90分也不会提前停止。</li><li>最后统一交叉核验主体、行业、经营真实性和客户价值。</li><li>费用和耗时通常高于智能分析。</li></ul></article></div></div></div> : null}</main>;
}
