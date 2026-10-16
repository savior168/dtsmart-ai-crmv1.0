"use client";

import { CheckCircle2, LoaderCircle, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Task = { kind: "import" | "ai"; status: "running" | "completed" | "failed"; total: number | null; done: number; success: number; failed: number; failures: string[]; message?: string; updatedAt: number };
type Notice = { id: number; message: string; type: "success" | "error"; generic: boolean; createdAt: number };
const IMPORT_KEY = "dtsmart-import-task";
const AI_KEY = "dtsmart-ai-task";
const EVENT_NAME = "dtsmart-task-update";
function read(key: string): Task | null { try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value && typeof value === "object" ? value : null; } catch { return null; } }
function save(key: string, task: Task) { localStorage.setItem(key, JSON.stringify(task)); window.dispatchEvent(new Event(EVENT_NAME)); }
function toast(message: string, type: "success" | "error" = "success", generic = false) { window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { message, type, duration: type === "error" ? 6000 : 3000, generic } })); }

function TaskNotice({ task }: { task: Task }) {
  const running = task.status === "running";
  const failed = task.failed > 0 || task.status === "failed";
  const progress = task.total ? Math.min(100, Math.round(task.done / task.total * 100)) : null;
  return <div className={`pointer-events-auto relative rounded-xl border bg-white p-4 shadow-2xl ${failed ? "border-amber-200" : "border-blue-200"}`}>
    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">{running ? <LoaderCircle size={18} className="animate-spin text-blue-600" /> : failed ? <XCircle size={18} className="text-amber-600" /> : <CheckCircle2 size={18} className="text-emerald-600" />}<span>{task.kind === "import" ? "数据导入任务" : "AI筛选任务"}</span><span className="ml-auto text-xs font-normal text-slate-500">{running ? "后台执行中" : "已完成"}</span></div>
    <div className="mt-2 text-sm text-slate-600">{task.total ? `${task.done}/${task.total}` : `已完成 ${task.done} 条`} · 成功 {task.success} 条 · 失败 {task.failed} 条</div>
    {progress !== null ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} /></div> : null}
    {task.failures.length ? <details className="mt-2 text-xs text-amber-700"><summary className="cursor-pointer">查看失败原因（{task.failures.length} 条）</summary><div className="mt-1 max-h-20 space-y-1 overflow-auto">{task.failures.slice(-10).map((reason, index) => <p key={`${task.kind}-${index}`}>{reason}</p>)}</div></details> : null}
    <button type="button" aria-label="关闭任务提示" onClick={() => { localStorage.removeItem(task.kind === "import" ? IMPORT_KEY : AI_KEY); window.dispatchEvent(new Event(EVENT_NAME)); }} className="absolute right-2 top-2 text-slate-400 hover:text-slate-700"><X size={14} /></button>
  </div>;
}

function SuccessNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-700 shadow-xl"><CheckCircle2 size={18}/><span className="min-w-0 flex-1">{notice.message}</span><button type="button" aria-label="关闭提示" onClick={onClose} className="text-emerald-700/70 hover:text-emerald-900"><X size={16}/></button></div>;
}

function ErrorNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return <div className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-rose-200 bg-white px-5 py-4 text-sm leading-6 text-rose-700 shadow-2xl"><XCircle className="mt-0.5 shrink-0" size={20}/><span className="min-w-0 flex-1">{notice.message}</span><button type="button" aria-label="关闭提示" onClick={onClose} className="text-rose-700/70 hover:text-rose-900"><X size={17}/></button></div>;
}

export function TaskRuntime() {
  const [tasks, setTasks] = useState<{ import: Task | null; ai: Task | null }>({ import: null, ai: null });
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeTimers = useRef(new Set<number>());
  const recentNoticeAt = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = noticeTimers.current;
    const refresh = () => setTasks({ import: read(IMPORT_KEY), ai: read(AI_KEY) });
    refresh();
    const originalFetch = window.fetch.bind(window);
    let aiActive = 0; let aiFinishTimer: number | undefined; let importDismissTimer: number | undefined;
    const dismiss = (id: number) => setNotices((current) => current.filter((item) => item.id !== id));
    const showNotice = (detail: { message?: string; type?: "success" | "error"; duration?: number; generic?: boolean }) => {
      if (!detail.message) return;
      const message = detail.message.trim();
      const type = detail.type || "success";
      const createdAt = Date.now();
      const key = `${type}:${message}`;
      const duplicateWindow = type === "error" ? 5000 : 3000;
      if (createdAt - (recentNoticeAt.current.get(key) || 0) < duplicateWindow) return;
      recentNoticeAt.current.set(key, createdAt);
      const id = createdAt + Math.random();
      const append = () => {
        // An explicit business message supersedes generic fetch feedback from
        // the same action, so users see one useful message instead of two.
        setNotices((current) => {
          const withoutGeneric = detail.generic ? current : current.filter((item) => !item.generic);
          if (withoutGeneric.some((item) => item.message === message && item.type === type)) return withoutGeneric;
          return [...withoutGeneric.slice(-2), { id, message, type, generic: Boolean(detail.generic), createdAt }];
        });
        const timer = window.setTimeout(() => { noticeTimers.current.delete(timer); dismiss(id); }, detail.duration || (type === "error" ? 6000 : 3000));
        noticeTimers.current.add(timer);
      };
      // Let an explicit component-level message arrive first; generic network
      // feedback is only a fallback and must never duplicate it.
      if (detail.generic) {
        const timer = window.setTimeout(() => { noticeTimers.current.delete(timer); append(); }, 180);
        noticeTimers.current.add(timer);
      } else append();
    };
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      let requestPath = "";
      try { requestPath = new URL(requestUrl, window.location.origin).pathname; } catch { requestPath = requestUrl.split("?")[0]; }
      // Import preview only reads and validates selected files. A background import
      // task must be created exclusively for the explicit confirm-import request.
      const isImport = requestPath === "/api/import" && method === "POST";
      const isAi = requestPath === "/api/ai/analyze" && method === "POST";
      const trackMutation = method !== "GET" && requestUrl.includes("/api/") && requestPath !== "/api/import/preview";
      let importTotal = 0;
      if (isImport) { try { importTotal = JSON.parse(String(init?.body || "{}")).rows?.length || 0; } catch { importTotal = 0; } save(IMPORT_KEY, { kind: "import", status: "running", total: importTotal, done: 0, success: 0, failed: 0, failures: [], updatedAt: Date.now() }); }
      if (isAi) { aiActive += 1; const current = read(AI_KEY); save(AI_KEY, { kind: "ai", status: "running", total: current?.total || null, done: current?.done || 0, success: current?.success || 0, failed: current?.failed || 0, failures: current?.failures || [], updatedAt: Date.now() }); }
      const response = await originalFetch(input, init);
      const body = await response.clone().json().catch(() => ({} as Record<string, unknown>));
      if (isImport) {
        const failures = Array.isArray(body.errors) ? body.errors.map(String) : [];
        const next: Task = { kind: "import", status: response.ok ? "completed" : "failed", total: Number(body.total_count || importTotal), done: Number(body.total_count || importTotal), success: Number(body.success_count || 0), failed: Number(body.failed_count || failures.length), failures, message: typeof body.error === "string" ? body.error : undefined, updatedAt: Date.now() };
        save(IMPORT_KEY, next);
        window.clearTimeout(importDismissTimer);
        importDismissTimer = window.setTimeout(() => {
          localStorage.removeItem(IMPORT_KEY);
          window.dispatchEvent(new Event(EVENT_NAME));
        }, 2000);
      } else if (isAi) {
        aiActive -= 1; const current = read(AI_KEY) || { kind: "ai", status: "running", total: null, done: 0, success: 0, failed: 0, failures: [], updatedAt: Date.now() } as Task;
        const failed = response.ok ? current.failed : current.failed + 1; const failures = response.ok ? current.failures : [...current.failures, String(body.error || "AI 分析失败")];
        save(AI_KEY, { ...current, status: "running", done: current.done + 1, success: current.success + (response.ok ? 1 : 0), failed, failures, updatedAt: Date.now() });
        window.clearTimeout(aiFinishTimer); aiFinishTimer = window.setTimeout(() => { if (aiActive === 0) { const finished = read(AI_KEY); if (finished) { const next = { ...finished, status: "completed" as const, updatedAt: Date.now() }; save(AI_KEY, next); toast(`AI筛选完成：成功 ${next.success} 条，失败 ${next.failed} 条`, next.failed ? "error" : "success"); } } }, 1800);
      } else if (trackMutation) {
        const toastMode = new Headers(init?.headers).get("x-dtsmart-toast");
        const shouldShowToast = toastMode !== "manual" && !(toastMode === "manual-error" && !response.ok);
        if (shouldShowToast) toast(response.ok ? "操作成功" : (typeof body.error === "string" ? body.error : "操作失败，请重试"), response.ok ? "success" : "error", true);
      }
      return response;
    };
    const receiveToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: "success" | "error"; duration?: number; generic?: boolean }>).detail;
      showNotice(detail || {});
    };
    window.addEventListener(EVENT_NAME, refresh);
    window.addEventListener("dtsmart-toast", receiveToast);
    return () => { window.fetch = originalFetch; window.clearTimeout(aiFinishTimer); window.clearTimeout(importDismissTimer); timers.forEach((timer) => window.clearTimeout(timer)); timers.clear(); window.removeEventListener(EVENT_NAME, refresh); window.removeEventListener("dtsmart-toast", receiveToast); };
  }, []);
  const visible = [tasks.import, tasks.ai].filter((task): task is Task => Boolean(task && (task.status === "running" || Date.now() - task.updatedAt < 9000)));
  if (!visible.length && !notices.length) return null;
  const successNotices = notices.filter((notice) => notice.type === "success");
  const errorNotices = notices.filter((notice) => notice.type === "error");
  return <>
    {visible.length || successNotices.length ? <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,390px)] flex-col gap-3" aria-live="polite">{visible.map((task) => <TaskNotice key={task.kind} task={task}/>)}{successNotices.map((notice) => <SuccessNotice key={notice.id} notice={notice} onClose={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}/>)}</div> : null}
    {errorNotices.length ? <div className="pointer-events-none fixed inset-0 z-[110] grid place-items-center p-4" aria-live="assertive"><div className="flex w-[min(92vw,440px)] flex-col gap-3">{errorNotices.map((notice) => <ErrorNotice key={notice.id} notice={notice} onClose={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}/>)}</div></div> : null}
  </>;
}
