"use client";
import Link from "next/link";
import { RefreshCw, Search, Settings2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

export function AcquisitionTaskCenter() {
  const [tasks, setTasks] = useState<AcquisitionTask[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [status, setStatus] = useState(""),
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
      setCanCreate(Boolean(b.can_create));
      setCanViewUsage(Boolean(b.can_view_usage));
      setCanManageSettings(Boolean(b.can_manage_settings));
      setShowOwner(Boolean(b.show_owner));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, search, industry, country, costMode, from, to, scopeUserId]);
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
          <>
            {canViewUsage ? <Link href="/ai-acquisition/usage" className={button}>用量与费用</Link> : null}
            {canManageSettings ? <Link href="/ai-acquisition/settings" className={button}><Settings2 size={15}/>AI获客设置</Link> : null}
            <button className={button} onClick={() => void load()}>
              <RefreshCw size={15} />
              刷新
            </button>
            {canCreate ? (
              <Link href="/ai-acquisition/new" className={primaryButton}>
                <Sparkles size={16} />
                创建AI获客
              </Link>
            ) : null}
          </>
        }
      />
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
          <label className="min-w-0"><input aria-label="目标行业" list="ai-acquisition-industry-options" className={`${input} w-full`} value={industry} onChange={(event)=>{setPage(1);setIndustry(event.target.value)}} placeholder="全部目标行业"/><datalist id="ai-acquisition-industry-options">{Object.keys(ACQUISITION_INDUSTRY_TERMS).map((item)=><option key={item} value={item}/>)}</datalist></label>
          <select aria-label="成本模式" className={`${input} w-full`} value={costMode} onChange={(event)=>{setPage(1);setCostMode(event.target.value)}}><option value="">全部成本模式</option><option value="FREE_ONLY">全免费获客</option><option value="ADAPTIVE">智能增强获客</option></select>
          {showOwner ? <UserScopeSelect permission="ai.acquisition.data_all" value={scopeUserId} onChange={(value)=>{setScopeUserId(value);setPage(1)}} allLabel="全部归属人" filterLabel="归属人" className={`${input} w-full`}/> : null}
          <button type="submit" className={button}><Search size={14}/>查询</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">创建时间</span>
            <input type="date" aria-label="创建开始日期" className={`${input} w-40`} value={from} onChange={(event)=>{setPage(1);setFrom(event.target.value)}}/>
            <span className="text-slate-300">—</span>
            <input type="date" aria-label="创建结束日期" className={`${input} w-40`} value={to} onChange={(event)=>{setPage(1);setTo(event.target.value)}}/>
            {(search || status || industry || country || costMode || from || to || scopeUserId) ? <button type="button" className={button} onClick={()=>{setDraft("");setSearch("");setStatus("");setIndustry("");setCountry("");setCostMode("");setFrom("");setTo("");setScopeUserId("");setPage(1)}}>重置</button> : null}
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
                      <div className="mt-2"><CostModeBadge mode={t.cost_mode} /></div>
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
                        href={`/ai-acquisition/tasks/${t.id}`}
                      >
                        查看详情
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
