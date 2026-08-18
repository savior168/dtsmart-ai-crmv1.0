"use client";

import { CheckCircle2, LoaderCircle, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Task = { kind: "import" | "ai"; status: "running" | "completed" | "failed"; total: number | null; done: number; success: number; failed: number; failures: string[]; message?: string; updatedAt: number };
const IMPORT_KEY = "dtsmart-import-task";
const AI_KEY = "dtsmart-ai-task";
const EVENT_NAME = "dtsmart-task-update";
function read(key: string): Task | null { try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value && typeof value === "object" ? value : null; } catch { return null; } }
function save(key: string, task: Task) { localStorage.setItem(key, JSON.stringify(task)); window.dispatchEvent(new Event(EVENT_NAME)); }
function toast(message: string, type: "success" | "error" = "success") { window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { message, type, duration: 4500 } })); }

export function TaskRuntime() {
  const [tasks, setTasks] = useState<{ import: Task | null; ai: Task | null }>({ import: null, ai: null });
  const [notices, setNotices] = useState<Array<{ id: number; message: string; type: "success" | "error" }>>([]);
  useEffect(() => {
    const refresh = () => setTasks({ import: read(IMPORT_KEY), ai: read(AI_KEY) });
    refresh();
    const originalFetch = window.fetch.bind(window);
    let aiActive = 0; let aiFinishTimer: number | undefined; let importDismissTimer: number | undefined;
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
      } else if (trackMutation) toast(response.ok ? "操作成功" : (typeof body.error === "string" ? body.error : "操作失败，请重试"), response.ok ? "success" : "error");
      return response;
    };
    const receiveToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: "success" | "error"; duration?: number }>).detail;
      if (!detail?.message) return;
      const message = detail.message;
      const id = Date.now() + Math.random();
      setNotices((current) => [...current.slice(-3), { id, message, type: detail.type || "success" }]);
      window.setTimeout(() => setNotices((current) => current.filter((item) => item.id !== id)), detail.duration || 3600);
    };
    window.addEventListener(EVENT_NAME, refresh);
    window.addEventListener("dtsmart-toast", receiveToast);
    return () => { window.fetch = originalFetch; window.clearTimeout(aiFinishTimer); window.clearTimeout(importDismissTimer); window.removeEventListener(EVENT_NAME, refresh); window.removeEventListener("dtsmart-toast", receiveToast); };
  }, []);
  const visible = [tasks.import, tasks.ai].filter((task): task is Task => Boolean(task && (task.status === "running" || Date.now() - task.updatedAt < 9000)));
  if (!visible.length && !notices.length) return null;
  return <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,390px)] flex-col gap-3" aria-live="polite">{visible.map((task) => { const running = task.status === "running"; const failed = task.failed > 0 || task.status === "failed"; const progress = task.total ? Math.min(100, Math.round(task.done / task.total * 100)) : null; return <div key={task.kind} className={`pointer-events-auto relative rounded-xl border bg-white p-4 shadow-2xl ${failed ? "border-amber-200" : "border-blue-200"}`}><div className="flex items-center gap-2 text-sm font-semibold text-slate-800">{running ? <LoaderCircle size={18} className="animate-spin text-blue-600" /> : failed ? <XCircle size={18} className="text-amber-600" /> : <CheckCircle2 size={18} className="text-emerald-600" />}<span>{task.kind === "import" ? "数据导入任务" : "AI筛选任务"}</span><span className="ml-auto text-xs font-normal text-slate-500">{running ? "后台执行中" : "已完成"}</span></div><div className="mt-2 text-sm text-slate-600">{task.total ? `${task.done}/${task.total}` : `已完成 ${task.done} 条`} · 成功 {task.success} 条 · 失败 {task.failed} 条</div>{progress !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} /></div>}{task.failures.length > 0 && <details className="mt-2 text-xs text-amber-700"><summary className="cursor-pointer">查看失败原因（{task.failures.length} 条）</summary><div className="mt-1 max-h-20 space-y-1 overflow-auto">{task.failures.slice(-10).map((reason, index) => <p key={`${task.kind}-${index}`}>{reason}</p>)}</div></details>}<button type="button" aria-label="关闭任务提示" onClick={() => { localStorage.removeItem(task.kind === "import" ? IMPORT_KEY : AI_KEY); window.dispatchEvent(new Event(EVENT_NAME)); }} className="absolute right-2 top-2 text-slate-400 hover:text-slate-700"><X size={14} /></button></div>; })}{notices.map((notice) => <div key={notice.id} className={`pointer-events-auto rounded-xl border bg-white px-4 py-3 text-sm shadow-xl ${notice.type === "error" ? "border-rose-200 text-rose-700" : "border-emerald-200 text-emerald-700"}`}>{notice.message}</div>)}</div>;
}
