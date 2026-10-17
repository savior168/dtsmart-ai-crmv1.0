"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { TaskItem } from "@/components/ai-screening/types";
import { aiErrorCodeLabel, aiErrorMessageZh, aiStepLabel } from "@/components/ai-screening/localization";
import { ErrorState, Loading, PageHeader, Pagination, button, formatCost, formatTokens, input, panel, primaryButton, useToast } from "@/components/ai-screening/ui";

type Failure = TaskItem & { task?: { id: string; name: string; task_number: string; strategy: string } | null };

function failureStage(item: Failure) {
  const contextStage = typeof item.error_context?.stage === "string" ? item.error_context.stage : null;
  const stage = contextStage || (item.pipeline_stage && item.pipeline_stage !== "FAILED" ? item.pipeline_stage : null);
  return stage ? aiStepLabel(stage) : "AI分析";
}

export function FailuresView() {
  const [items, setItems] = useState<Failure[]>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; name: string }>>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [taskId, setTaskId] = useState("");
  const [step, setStep] = useState("");
  const [retryState, setRetryState] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast, node } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), task_id: taskId, search, step, retry: retryState });
    const response = await fetch(`/api/ai/failures?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(body.error || "失败客户查询失败"); return; }
    setItems(body.data || []); setCount(body.count || 0); setTasks(body.tasks || []); setError("");
  }, [page, pageSize, taskId, search, step, retryState]);

  useEffect(() => { void load(); }, [load]);

  async function retry(itemIds?: string[]) {
    setBusy(true);
    const response = await fetch("/api/ai/failures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_ids: itemIds, task_id: taskId || undefined }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return toast(body.error || "重试提交失败", "error");
    toast(`已提交 ${body.retried} 条失败客户重试`);
    await load();
  }

  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="待重试客户" description="跨任务汇总当前用户仍可重试的客户，每条记录明确显示所属任务与失败原因。" actions={<><Link href="/ai-screening" className={button}>返回任务中心</Link><button disabled={busy || !count} className={primaryButton} onClick={() => void retry()}><RotateCcw size={16}/>重试全部可重试客户</button></>}/>
    <section className={`${panel} overflow-hidden`}>
      <form onSubmit={(event) => { event.preventDefault(); setSearch(draft.trim()); setPage(1); }} className="grid items-end gap-[10px] border-b border-[#e8ecf2] p-[14px_16px] xl:grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(150px,.8fr))_auto]">
        <input className={input} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="搜索任务名称、编号或客户"/>
        <select className={input} value={taskId} onChange={(event) => { setTaskId(event.target.value); setPage(1); }}><option value="">全部任务</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select>
        <select className={input} value={step} onChange={(event) => { setStep(event.target.value); setPage(1); }}><option value="">全部失败步骤</option><option value="COLLECTING_EVIDENCE">公开页面抓取</option><option value="ANALYZING">结构化分析</option><option value="WRITTEN_BACK">结果写回</option></select>
        <select className={input} value={retryState} onChange={(event) => { setRetryState(event.target.value); setPage(1); }}><option value="">全部重试状态</option><option value="available">可重试</option><option value="exhausted">已达重试上限</option></select>
        <div className="flex gap-2"><button className={primaryButton}>查询</button><button type="button" className={button} onClick={() => { setDraft(""); setSearch(""); setTaskId(""); setStep(""); setRetryState(""); setPage(1); }}>重置</button></div>
      </form>
      {error ? <ErrorState message={error} reload={() => void load()}/> : loading ? <Loading/> : <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] table-fixed border-collapse text-left text-sm">
          <colgroup><col className="w-[190px]"/><col className="w-[190px]"/><col className="w-[135px]"/><col className="w-[320px]"/><col className="w-[170px]"/><col className="w-[90px]"/><col className="w-[160px]"/><col className="w-[160px]"/></colgroup>
          <thead className="bg-[#f7f9fc] text-[#58657a]"><tr>{["所属任务 / 编号", "公司名称", "失败步骤", "真实原因", "错误类型", "已重试", "已消耗Token / 费用", "操作"].map((label) => <th key={label} className="px-[11px] py-[10px] font-semibold">{label}</th>)}</tr></thead>
          <tbody>{items.map((item) => <tr key={item.id} className="border-t border-[#edf0f4] align-middle hover:bg-[#fafcff]">
            <td className="px-[11px] py-[11px]"><b title={item.task?.name || "-"} className="block truncate font-semibold text-[#145edb]">{item.task?.name || "-"}</b><small className="block truncate text-[#8994a5]">{item.task?.task_number}</small></td>
            <td className="px-[11px] py-[11px]"><span title={item.customer?.company_name || "-"} className="block truncate">{item.customer?.company_name || "-"}</span></td>
            <td className="px-[11px] py-[11px]">{failureStage(item)}</td>
            <td title={aiErrorMessageZh(item.error_code, item.error_message)} className="px-[11px] py-[11px] leading-6 text-rose-600"><span className="line-clamp-2">{aiErrorMessageZh(item.error_code, item.error_message)}</span></td>
            <td className="px-[11px] py-[11px]">{aiErrorCodeLabel(item.error_code)}</td>
            <td className="px-[11px] py-[11px]">{item.attempt_count} / {item.max_attempts}</td>
            <td className="px-[11px] py-[11px]">{formatTokens(item.total_tokens)} / {formatCost(item.cost_usd)}</td>
            <td className="px-[11px] py-[11px]"><div className="flex min-h-9 items-center gap-3 whitespace-nowrap"><Link href={`/ai-screening/tasks/${item.task_id}`} className="inline-flex h-8 items-center text-[#1763e8]">查看任务</Link><button disabled={busy || item.attempt_count >= item.max_attempts} onClick={() => void retry([item.id])} className="inline-flex h-8 items-center text-[#1763e8] disabled:text-slate-400">立即重试</button></div></td>
          </tr>)}</tbody>
        </table>
        {!items.length ? <div className="p-12 text-center text-sm text-slate-400">暂无待重试客户</div> : null}
      </div>}
      <Pagination page={page} pageSize={pageSize} total={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }}/>
    </section>
  </div>{node}</main>;
}
