"use client";
import Link from "next/link";
import { BarChart3, Check, ChevronDown, CircleHelp, ListChecks, LoaderCircle, Plus, RefreshCw, Search, Settings2, TriangleAlert, UserRoundPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CostModeBadge,
  ErrorState,
  Loading,
  PageHeader,
  Pagination,
  StatusBadge,
  button,
  effectiveElapsedMs,
  formatDuration,
  input,
  panel,
  primaryButton,
} from "@/components/ai-screening/ui";
import type { AcquisitionTask } from "./types";
import { ACQUISITION_COUNTRIES, ACQUISITION_INDUSTRY_TERMS } from "@/lib/ai-acquisition/config";
import { UserScopeSelect } from "@/components/user-scope-select";

const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const ACQUISITION_INDUSTRY_OPTIONS = Object.keys(ACQUISITION_INDUSTRY_TERMS);
type TaskSummary = { tasks:number; active_tasks:number; completed_tasks:number; accepted:number; review:number; failed_tasks:number };
type SummaryMetric = "" | "active" | "completed" | "accepted" | "review" | "failed";

function IndustryFilter({ value, onChange }:{ value:string; onChange:(value:string)=>void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = ACQUISITION_INDUSTRY_OPTIONS;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = options.filter((item) => item.toLowerCase().includes(normalizedQuery));
  const canUseCustom = Boolean(query.trim()) && !options.some((item) => item.toLowerCase() === normalizedQuery);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event:MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event:KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const select = (next:string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return <div ref={rootRef} className="relative min-w-0">
    <button
      type="button"
      aria-label="目标行业"
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      className={`${input} flex w-full items-center justify-between gap-2 text-left`}
    >
      <span className={`truncate ${value ? "text-slate-700" : "text-slate-400"}`}>{value || "全部目标行业"}</span>
      <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}/>
    </button>
    {open ? <div className="absolute left-0 top-full z-50 mt-1 w-[320px] max-w-[min(320px,calc(100vw-3rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" role="listbox" aria-label="选择目标行业">
      <div className="border-b border-slate-100 p-2">
        <label className="relative block">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400"/>
          <input ref={searchRef} value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&query.trim()){event.preventDefault();select(query.trim())}}} className={`${input} h-9 w-full pl-9`} placeholder="搜索或输入任意行业"/>
        </label>
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        <button type="button" onClick={()=>select("")} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${!value ? "bg-blue-50 text-blue-700" : "text-slate-600"}`}><span>全部目标行业</span>{!value?<Check size={15}/>:null}</button>
        {canUseCustom ? <button type="button" onClick={()=>select(query.trim())} className="mt-1 flex w-full items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-700 hover:bg-blue-100"><span className="min-w-0 truncate">按“{query.trim()}”筛选</span><Check size={15} className="shrink-0"/></button> : null}
        {filtered.map((item)=><button type="button" role="option" aria-selected={value===item} key={item} onClick={()=>select(item)} className={`mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${value===item?"bg-blue-50 text-blue-700":"text-slate-700"}`}><span className="min-w-0 truncate">{item}</span>{value===item?<Check size={15} className="shrink-0"/>:null}</button>)}
        {!filtered.length && !canUseCustom ? <p className="px-3 py-6 text-center text-sm text-slate-400">没有匹配的行业</p> : null}
      </div>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">可选择常用行业，也可输入任务中使用的其他行业</p>
    </div> : null}
  </div>;
}

export function AcquisitionTaskCenter() {
  const [tasks, setTasks] = useState<AcquisitionTask[]>([]),
    [count, setCount] = useState(0),
    [summary, setSummary] = useState<TaskSummary>({ tasks:0, active_tasks:0, completed_tasks:0, accepted:0, review:0, failed_tasks:0 }),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [status, setStatus] = useState(""),
    [metric, setMetric] = useState<SummaryMetric>(""),
    [industry, setIndustry] = useState(""),
    [country, setCountry] = useState(""),
    [costMode, setCostMode] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [canCreate, setCanCreate] = useState(false),
    [canViewUsage, setCanViewUsage] = useState(false),
    [canManageSettings, setCanManageSettings] = useState(false),
    [showOwner, setShowOwner] = useState(false),
    [scopeUserId, setScopeUserId] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        user_id: scopeUserId || "all",
      });
      if (status) p.set("status", status);
      if (metric) p.set("metric", metric);
      if (search) p.set("search", search);
      if (industry) p.set("industry", industry);
      if (country) p.set("country", country);
      if (costMode) p.set("cost_mode", costMode);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/ai-acquisition/tasks?${p}`, {
        cache: "no-store",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "加载失败");
      setTasks(b.data || []);
      setCount(b.count || 0);
      setSummary(b.summary || { tasks:0, active_tasks:0, completed_tasks:0, accepted:0, review:0, failed_tasks:0 });
      setCanCreate(Boolean(b.can_create));
      setCanViewUsage(Boolean(b.can_view_usage));
      setCanManageSettings(Boolean(b.can_manage_settings));
      setShowOwner(Boolean(b.show_owner));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, metric, search, industry, country, costMode, from, to, scopeUserId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!tasks.some((t) => ["QUEUED", "RUNNING", "PAUSING"].includes(t.status)))
      return;
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [tasks, load]);
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title="AI获客任务中心"
        description="低成本发现 → 非目标早停 → 主体与在营核验 → 联系方式和依据补全 → 系统去重 → 仅高可信目标客户进入客户公海"
        actions={
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            {canViewUsage ? <Link href="/ai-usage?module=acquisition" className={`${button} shrink-0`}><BarChart3 size={16}/>AI用量与费用</Link> : null}
            {canManageSettings ? <Link href="/ai-acquisition/settings" className={`${button} shrink-0`}><Settings2 size={16}/>AI获客设置</Link> : null}
            {canCreate ? (
              <Link href="/ai-acquisition/new" className={`${primaryButton} shrink-0`}>
                <Plus size={17} />
                创建AI获客任务
              </Link>
            ) : null}
          </div>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {[
          { key:"" as const, label:"全部任务", value:summary.tasks, note:"当前条件下的全部任务", icon:ListChecks, tone:"bg-blue-50 text-blue-700" },
          { key:"active" as const, label:"进行中", value:summary.active_tasks, note:"排队、执行或暂停处理中", icon:LoaderCircle, tone:"bg-violet-50 text-violet-700" },
          { key:"completed" as const, label:"已完成", value:summary.completed_tasks, note:"已完成全部处理流程", icon:Check, tone:"bg-cyan-50 text-cyan-700" },
          { key:"accepted" as const, label:"成功入池客户", value:summary.accepted, note:"已通过准入门槛", icon:UserRoundPlus, tone:"bg-emerald-50 text-emerald-700" },
          { key:"review" as const, label:"待人工复核", value:summary.review, note:"需核对证据后处理", icon:CircleHelp, tone:"bg-amber-50 text-amber-700" },
          { key:"failed" as const, label:"异常任务", value:summary.failed_tasks, note:"需要检查或重试", icon:TriangleAlert, tone:"bg-rose-50 text-rose-700" },
        ].map((item)=><button type="button" key={item.label} aria-pressed={metric===item.key} onClick={()=>{setMetric(item.key);setStatus("");setPage(1)}} className={`${panel} relative flex min-w-0 items-center gap-3 p-[15px] text-left transition hover:-translate-y-0.5 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 ${metric===item.key?"border-blue-400 ring-1 ring-blue-100":""}`}><span className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] ${item.tone}`}><item.icon size={20}/></span><span className="min-w-0"><span className="block truncate text-sm text-[#6f7b8f]">{item.label}</span><b className="mt-[3px] block text-2xl font-semibold">{Number(item.value||0).toLocaleString("zh-CN")}</b><small className="block truncate text-[#8b96a7]" title={`${item.note}；点击筛选任务`}>{item.note}</small></span><span aria-hidden="true" className="absolute right-4 text-xl text-slate-400">›</span></button>)}
      </section>
      <section className={`${panel} p-4`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(draft.trim());
          }}
        >
          <div className={`grid gap-3 md:grid-cols-2 ${showOwner ? "xl:grid-cols-[minmax(230px,1.5fr)_repeat(5,minmax(145px,1fr))_auto]" : "xl:grid-cols-[minmax(260px,1.7fr)_repeat(4,minmax(145px,1fr))_auto]"}`}>
          <label className="relative min-w-[240px]">
            <Search
              size={16}
              className="absolute left-3 top-3 text-slate-400"
            />
            <input
              className={`${input} w-full pl-9`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="搜索任务名称或任务编号"
            />
          </label>
          <select
            aria-label="任务状态"
            className={`${input} w-full`}
            value={status}
            onChange={(e) => {
              setPage(1);
              setMetric("");
              setStatus(e.target.value);
            }}
          >
            <option value="">全部状态</option>
            <option value="QUEUED">排队中</option>
            <option value="RUNNING">执行中</option>
            <option value="PAUSING">暂停中</option>
            <option value="PAUSED">已暂停</option>
            <option value="COMPLETED">已完成</option>
            <option value="FAILED">失败</option>
            <option value="CANCELLED">已取消</option>
          </select>
          <select aria-label="目标国家/地区" className={`${input} w-full`} value={country} onChange={(event)=>{setPage(1);setCountry(event.target.value)}}><option value="">全部国家/地区</option>{ACQUISITION_COUNTRIES.map((item)=><option key={item} value={item}>{COUNTRY_NAMES.of(item)} · {item}</option>)}</select>
          <IndustryFilter value={industry} onChange={(value)=>{setPage(1);setIndustry(value)}}/>
          <select aria-label="成本模式" className={`${input} w-full`} value={costMode} onChange={(event)=>{setPage(1);setCostMode(event.target.value)}}><option value="">全部成本模式</option><option value="FREE_ONLY">全免费获客</option><option value="ADAPTIVE">智能增强获客</option></select>
          {showOwner ? <UserScopeSelect permission="ai.acquisition.data_all" value={scopeUserId} onChange={(value)=>{setScopeUserId(value);setPage(1)}} allLabel="全部归属人" filterLabel="归属人" className={`${input} w-full`}/> : null}
          <div className="flex gap-2"><button type="submit" className={primaryButton}>查询</button><button type="button" className={button} onClick={()=>void load()}><RefreshCw size={16}/>刷新</button></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">创建时间</span>
            <input type="date" aria-label="创建开始日期" className={`${input} w-40`} value={from} onChange={(event)=>{setPage(1);setFrom(event.target.value)}}/>
            <span className="text-slate-300">—</span>
            <input type="date" aria-label="创建结束日期" className={`${input} w-40`} value={to} onChange={(event)=>{setPage(1);setTo(event.target.value)}}/>
            {(search || status || metric || industry || country || costMode || from || to || scopeUserId) ? <button type="button" className={button} onClick={()=>{setDraft("");setSearch("");setStatus("");setMetric("");setIndustry("");setCountry("");setCostMode("");setFrom("");setTo("");setScopeUserId("");setPage(1)}}>重置</button> : null}
          </div>
        </form>
      </section>
      <section className={panel}>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} reload={() => void load()} />
        ) : tasks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "任务",
                    ...(showOwner ? ["归属人"] : []),
                    "状态",
                    "目标行业",
                    "市场 / 模式",
                    "发现 / 核验",
                    "入池 / 待复核",
                    "未通过 / 重复",
                    "有效耗时",
                    "创建时间",
                    "操作",
                  ].map((x) => (
                    <th key={x} className="px-4 py-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t align-top">
                    <td className="px-4 py-4">
                      <Link
                        className="font-semibold text-blue-700 hover:underline"
                        href={`/ai-acquisition/tasks/${t.id}`}
                      >
                        {t.name}
                      </Link>
                      <small className="mt-1 block text-slate-400">
                        {t.task_number}
                      </small>
                    </td>
                    {showOwner ? <td className="px-4 py-4"><b className="block font-medium text-slate-800">{t.owner?.name?.trim() || "未命名用户"}</b><small className="mt-1 block text-slate-400">{t.owner?.email || "—"}</small></td> : null}
                    <td className="px-4 py-4">
                      <StatusBadge status={t.status} />
                      {t.error_message ? (
                        <small className="mt-2 block max-w-52 text-rose-600">
                          {t.error_message}
                        </small>
                      ) : null}
                    </td>
                    <td className="max-w-56 px-4 py-4 text-slate-700">
                      {(t.industries?.length ? t.industries : [t.industry]).slice(0, 2).join("、")}
                      {(t.industries?.length || 1) > 2 ? <small className="ml-1 text-blue-600">+{(t.industries?.length || 1) - 2}</small> : null}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-slate-700">{t.countries.slice(0, 2).map((code)=>COUNTRY_NAMES.of(code) || code).join("、")}{t.countries.length > 2 ? ` +${t.countries.length - 2}` : ""}</div>
                      <div className="mt-2"><CostModeBadge mode={t.cost_mode} context="acquisition" /></div>
                    </td>
                    <td className="px-4 py-4">
                      {t.discovered_count} / {t.processed_count}
                    </td>
                    <td className="px-4 py-4">
                      <b className="text-emerald-700">{t.accepted_count}</b> /{" "}
                      {t.review_count}
                    </td>
                    <td className="px-4 py-4">
                      {t.rejected_count} / {t.duplicate_count}
                    </td>
                    <td className="px-4 py-4">
                      {formatDuration(effectiveElapsedMs(t))}
                    </td>
                    <td className="px-4 py-4 text-slate-500">
                      {t.scheduled_at ? <small className="mb-1 block font-medium text-blue-600">预约 {new Date(t.scheduled_at).toLocaleString("zh-CN", { hour12: false })}</small> : null}
                      {new Date(t.created_at).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        className={button}
                        href={`/ai-acquisition/tasks/${t.id}?decision=${metric==="review"?"REVIEW":"ACCEPTED"}`}
                      >
                        {metric==="review"?"查看待复核":"查看客户数据"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center text-sm text-slate-500">
            暂无AI获客任务
          </div>
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={count}
          onPage={setPage}
          onPageSize={(s) => {
            setPage(1);
            setPageSize(s);
          }}
          itemLabel="个任务"
        />
      </section>
    </div></main>
  );
}
