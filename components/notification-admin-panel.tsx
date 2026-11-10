"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, LoaderCircle, Megaphone, Search, Sparkles } from "lucide-react";
import type { NotificationPolicy } from "@/lib/notification-policy";
import { USER_ROLES, type UserRole } from "@/lib/auth/permissions";
import { RELEASE_CATEGORIES, type ReleaseCategory } from "@/lib/notifications/release-announcement";
import { ANNOUNCEMENT_TEMPLATES, buildOperationalAnnouncement, type AnnouncementTemplate } from "@/lib/notifications/announcement-templates";

type PolicyRow = NotificationPolicy & { label: string };
type AnnouncementLevel = "NORMAL" | "IMPORTANT" | "CRITICAL";
type Announcement = { id: string; title: string; content: string; published_at: string; recipient_roles: UserRole[] | null; recipient_count: number | null; delivery_level: AnnouncementLevel };
type ReleaseEvidence = { sha: string; message: string; details?: string; category: string; files: string[]; deployedAt: string; url: string; deploymentUrl: string; affectedRoles: UserRole[] | ["ALL"] };
const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "系统管理员", SUPERVISOR: "主管", SALES: "销售员", ORDER_CLERK: "跟单员", WAREHOUSE: "仓库员", FINANCE: "财务员" };
const policyGroups = [
  { label: "备货与仓库", types: ["STOCK_ORDER_CREATED", "STOCK_STATUS_CHANGED", "STOCK_PROGRESS_ROUTINE"] },
  { label: "PI 变更", types: ["PI_CHANGE_REQUESTED", "PI_CHANGE_APPLIED", "PI_CHANGE_REJECTED"] },
  { label: "客户与账号待办", types: ["REGISTRATION_REVIEW", "PROTECTION_RENEWAL_REVIEW", "CUSTOMER_ADMIN_ASSIGNED", "CUSTOMER_HANDOVER", "FOLLOWUP_DUE"] },
  { label: "系统公告", types: ["SYSTEM_ANNOUNCEMENT"] },
];

export function NotificationAdminPanel() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [deliveryLevel, setDeliveryLevel] = useState<AnnouncementLevel>("NORMAL");
  const [announcementType, setAnnouncementType] = useState<ReleaseCategory>("ALL");
  const [template, setTemplate] = useState<AnnouncementTemplate>("NONE");
  const [templateScope, setTemplateScope] = useState("");
  const [templateStart, setTemplateStart] = useState("");
  const [templateEnd, setTemplateEnd] = useState("");
  const [templateImpact, setTemplateImpact] = useState("");
  const [templateAction, setTemplateAction] = useState("");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const [releaseFrom, setReleaseFrom] = useState(today);
  const [releaseTo, setReleaseTo] = useState(today);
  const [generating, setGenerating] = useState(false);
  const [generatedSource, setGeneratedSource] = useState("");
  const [releaseEvidence, setReleaseEvidence] = useState<ReleaseEvidence[]>([]);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [appliedHistoryRange, setAppliedHistoryRange] = useState({ from: "", to: "" });
  const [audience, setAudience] = useState<"ALL" | "ROLES">("ALL");
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([]);
  const requestId = useRef<string | null>(null);

  const load = useCallback(async (afterPublish = false) => {
    try {
      const query = new URLSearchParams();
      if (appliedHistoryRange.from) query.set("from", appliedHistoryRange.from);
      if (appliedHistoryRange.to) query.set("to", appliedHistoryRange.to);
      const response = await fetch(`/api/admin/notifications${query.size ? `?${query}` : ""}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "通知设置加载失败");
      setPolicies(body.policies || []);
      setAnnouncements(body.announcements || []);
      setError("");
    } catch (cause) {
      if (afterPublish) {
        setSuccess(current => `${current}；发布记录暂未刷新，请稍后刷新页面查看`);
      } else {
        setError(cause instanceof Error ? cause.message : "通知设置加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [appliedHistoryRange]);
  useEffect(() => { void load(); }, [load]);

  async function updatePolicy(row: PolicyRow, key: "popup_enabled" | "voice_enabled") {
    const next = { ...row, [key]: !row[key] };
    setSavingType(row.type);
    setError("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json", "x-dtsmart-toast": "manual-error" },
        body: JSON.stringify(next),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "通知策略保存失败");
      setPolicies(current => current.map(item => item.type === row.type ? next : item));
      setSuccess(`${row.label}设置已保存，用户下次同步设置后生效`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通知策略保存失败");
    } finally {
      setSavingType("");
    }
  }

  async function publish() {
    const cleanTitle = title.trim();
    const cleanContent = content.trim();
    if (!cleanTitle || !cleanContent) return setError("请填写公告标题和内容");
    if (audience === "ROLES" && selectedRoles.length === 0) return setError("请至少选择一个接收角色");
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const currentRequestId = requestId.current;
    setPublishing(true);
    setError("");
    setSuccess("");
    let confirmed = false;
    try {
      const response = await fetch("/api/admin/notifications/announcements", {
        method: "POST", headers: { "Content-Type": "application/json", "x-dtsmart-toast": "manual-error" },
        body: JSON.stringify({ request_id: currentRequestId, title: cleanTitle, content: cleanContent, recipient_roles: audience === "ALL" ? null : selectedRoles, delivery_level: deliveryLevel }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "公告发布失败");
      confirmed = true;
    } catch (cause) {
      // A dropped response can arrive after the database transaction commits.
      // Verify by the same idempotency key before allowing a retry.
      try {
        const response = await fetch(`/api/admin/notifications/announcements?request_id=${encodeURIComponent(currentRequestId)}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        confirmed = response.ok && body.announcement?.title === cleanTitle
          && body.announcement?.content === cleanContent && body.announcement?.delivery_level === deliveryLevel;
      } catch { /* The result remains unknown; retry will reuse the request ID. */ }
      if (!confirmed) {
        const message = cause instanceof Error ? cause.message : "请求失败";
        setError(message === "Failed to fetch"
          ? "网络连接中断，发布结果尚未确认。请先查看公告发布记录；重试将使用同一请求编号，不会重复发送。"
          : message);
        setPublishing(false);
        return;
      }
    }
    try {
      requestId.current = null;
      setConfirming(false);
      setTitle("");
      setContent("");
      setAudience("ALL");
      setSelectedRoles([]);
      setDeliveryLevel("NORMAL");
      setSuccess(`公告已发布到${audience === "ALL" ? "所有启用中用户" : selectedRoles.map(role => ROLE_LABELS[role]).join("、") + "中的启用用户"}的通知中心`);
      await load(true);
    } finally {
      setPublishing(false);
    }
  }

  function invalidateGeneratedDraft() {
    setConfirming(false);
    requestId.current = null;
    if (!generatedSource) return;
    setGeneratedSource("");
    setReleaseEvidence([]);
    setTitle("");
    setContent("");
  }

  async function generateAnnouncement() {
    if (!releaseFrom || !releaseTo || releaseFrom > releaseTo) return setError("请选择有效的 GitHub/Vercel 统计时间范围");
    if (audience === "ROLES" && !selectedRoles.length) return setError("请先选择公告接收角色");
    setGenerating(true);
    setError("");
    setSuccess("");
    setTitle("");
    setContent("");
    setGeneratedSource("");
    setReleaseEvidence([]);
    setConfirming(false);
    requestId.current = null;
    try {
      const query = new URLSearchParams({ from: releaseFrom, to: releaseTo, category: announcementType });
      if (audience === "ROLES") selectedRoles.forEach(role => query.append("role", role));
      const response = await fetch(`/api/admin/notifications/release-summary?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "GitHub/Vercel 发布记录读取失败");
      if (!body.matched_count) throw new Error("没有符合条件的正式发布变更，未生成公告草稿。请调整时间、角色或通知类型后重试。");
      setTitle(body.title || "");
      setContent(body.content || "");
      setGeneratedSource(body.source || "");
      setReleaseEvidence(Array.isArray(body.commits) ? body.commits : []);
      setConfirming(false);
      requestId.current = null;
      setSuccess(`已依据 ${body.matched_count} 条匹配的 GitHub 提交与 ${body.deployments_checked ?? 0} 条正式部署记录生成摘要；请核对后发布。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GitHub/Vercel 发布记录读取失败");
    } finally {
      setGenerating(false);
    }
  }

  function generateOperationalNotice() {
    if (template === "NONE") return;
    try {
      const draft = buildOperationalAnnouncement({ template, scope: templateScope, start: templateStart, end: templateEnd, impact: templateImpact, action: templateAction });
      setTitle(draft.title);
      setContent(draft.content);
      setGeneratedSource("");
      setReleaseEvidence([]);
      setConfirming(false);
      requestId.current = null;
      setError("");
      setSuccess("公告模板已填入，请核对时间、影响范围与操作指引后发布。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公告模板内容不完整");
    }
  }

  const otherPolicies = policies.filter(row => !policyGroups.some(group => group.types.includes(row.type)));
  const visibleGroups = otherPolicies.length ? [...policyGroups, { label: "其他通知", types: otherPolicies.map(row => row.type) }] : policyGroups;
  const audienceLabel = audience === "ALL" ? "所有启用中的系统用户" : selectedRoles.map(role => ROLE_LABELS[role]).join("、");
  return <div className="min-w-0"><div className="space-y-5">
    <header><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BellRing className="text-blue-600"/>通知与公告</h1><p className="mt-1 text-sm text-slate-500">仅系统管理员可修改弹窗、语音策略和发布公告；关闭弹窗不会把消息标为已读。</p></header>
    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {success ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p> : null}
    <section className="rounded-xl border bg-white p-4 sm:p-5"><h2 className="font-semibold">通知方式</h2><p className="mt-1 text-sm text-slate-500">弹窗与语音按业务类型分组设置；站内通知始终送达。语音还须接收人自己开启，并由浏览器支持。</p>
      {loading ? <div className="grid min-h-28 place-items-center"><LoaderCircle className="animate-spin"/></div> : <div className="mt-4 space-y-2">{visibleGroups.map((group, index) => {
        const rows = policies.filter(row => group.types.includes(row.type));
        if (!rows.length) return null;
        return <details key={group.label} className="rounded-lg border border-slate-200 open:border-blue-200" {...(index === 0 ? { open: true } : {})}>
          <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"><span>{group.label}</span><span className="text-xs font-normal text-slate-500">{rows.length} 项</span></summary>
          <div className="divide-y px-4">{rows.map(row => <div key={row.type} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><b className="text-slate-800" title={row.type}>{row.label}</b><div className="flex gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={row.popup_enabled} disabled={Boolean(savingType)} onChange={() => void updatePolicy(row, "popup_enabled")}/>弹窗</label><label className="flex items-center gap-2"><input type="checkbox" checked={row.voice_enabled} disabled={Boolean(savingType)} onChange={() => void updatePolicy(row, "voice_enabled")}/>语音</label></div></div>)}</div>
        </details>;
      })}</div>}
    </section>
    <section className="rounded-xl border bg-white p-4 sm:p-5"><h2 className="flex items-center gap-2 font-semibold"><Megaphone size={18} className="text-blue-600"/>发布系统公告</h2><p className="mt-1 text-sm text-slate-500">发布变更摘要或运营公告前，请核对事实、影响范围及接收对象；请勿包含密码或敏感客户资料。</p><div className="mt-4 space-y-3">
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">常用运营公告模板</legend>
        <p className="mb-3 text-xs text-slate-500">维护、暂停、恢复及故障公告仅依据管理员填写的实际情况生成，不从代码提交推测服务状态。</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">公告模板<select value={template} onChange={event => setTemplate(event.target.value as AnnouncementTemplate)} className="mt-1 block h-10 w-full rounded-lg border bg-white px-3">{Object.entries(ANNOUNCEMENT_TEMPLATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {template !== "NONE" ? <>
            <label className="text-sm">影响范围<input value={templateScope} onChange={event => setTemplateScope(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border px-3" placeholder="例如：PI订单与备货单"/></label>
            <label className="text-sm">{template === "SERVICE_RESTORED" ? "恢复时间" : template === "INCIDENT" ? "发现时间" : "开始时间"}<input type="datetime-local" value={templateStart} onChange={event => setTemplateStart(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border px-3"/></label>
            {template === "MAINTENANCE" || template === "SERVICE_PAUSE" ? <label className="text-sm">预计结束时间<input type="datetime-local" value={templateEnd} min={templateStart || undefined} onChange={event => setTemplateEnd(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border px-3"/></label> : null}
            <label className="text-sm">实际影响或当前状态<input value={templateImpact} onChange={event => setTemplateImpact(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border px-3" placeholder="例如：维护期间部分操作不可用"/></label>
            <label className="text-sm">用户操作<input value={templateAction} onChange={event => setTemplateAction(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border px-3" placeholder="例如：请提前保存正在编辑的单据"/></label>
            <div className="flex items-end"><button type="button" onClick={generateOperationalNotice} className="h-10 w-full rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 hover:bg-blue-100">生成运营公告草稿</button></div>
          </> : null}
        </div>
      </fieldset>
      <fieldset className="rounded-lg border border-slate-200 p-3 text-sm"><legend className="px-1 font-medium">接收范围</legend><div className="flex flex-wrap gap-x-6 gap-y-2"><label className="flex items-center gap-2"><input type="radio" name="announcement-audience" checked={audience === "ALL"} onChange={() => { setAudience("ALL"); invalidateGeneratedDraft(); }}/>所有启用用户</label><label className="flex items-center gap-2"><input type="radio" name="announcement-audience" checked={audience === "ROLES"} onChange={() => { setAudience("ROLES"); invalidateGeneratedDraft(); }}/>指定角色</label></div>{audience === "ROLES" ? <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3">{USER_ROLES.map(role => <label key={role} className="flex items-center gap-2"><input type="checkbox" checked={selectedRoles.includes(role)} onChange={event => { setSelectedRoles(current => event.target.checked ? [...current, role] : current.filter(value => value !== role)); invalidateGeneratedDraft(); }}/>{ROLE_LABELS[role]}</label>)}</div> : null}<p className="mt-2 text-xs text-slate-500">按发布时的角色发送；之后角色变化不会补发或撤回。指定角色至少选择一项。</p></fieldset>
      <fieldset className="rounded-lg border border-slate-200 p-3 text-sm"><legend className="px-1 font-medium">提醒方式</legend><div className="grid gap-2 sm:grid-cols-3">{([ ["NORMAL", "普通通知", "仅进入通知中心，不打断操作"], ["IMPORTANT", "重要通知", "居中提醒，可稍后查看"], ["CRITICAL", "紧急公告", "居中提醒，须点击已知晓" ] ] as const).map(([value,label,description]) => <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${deliveryLevel === value ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}><input type="radio" name="announcement-level" checked={deliveryLevel === value} onChange={() => { setDeliveryLevel(value); setConfirming(false); requestId.current = null; }}/><span><b className="block">{label}</b><small className="text-slate-500">{description}</small></span></label>)}</div><p className="mt-2 text-xs text-slate-500">只有确需每位接收者确认的安全、停服等事项使用紧急公告；发布前请核对范围。</p></fieldset>
      <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-medium">按发布记录生成内容</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">通知类型<select value={announcementType} onChange={event => { setAnnouncementType(event.target.value as ReleaseCategory); invalidateGeneratedDraft(); }} className="mt-1 block h-10 w-full rounded-lg border bg-white px-3">{Object.entries(RELEASE_CATEGORIES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
        <label className="text-sm">变更起始日期<input type="date" value={releaseFrom} max={releaseTo || undefined} onChange={event => { setReleaseFrom(event.target.value); invalidateGeneratedDraft(); }} className="mt-1 block h-10 w-full rounded-lg border px-3"/></label>
        <label className="text-sm">变更截止日期<input type="date" value={releaseTo} min={releaseFrom || undefined} onChange={event => { setReleaseTo(event.target.value); invalidateGeneratedDraft(); }} className="mt-1 block h-10 w-full rounded-lg border px-3"/></label>
        <div className="flex items-end"><button type="button" disabled={generating || (audience === "ROLES" && !selectedRoles.length)} onClick={() => void generateAnnouncement()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">{generating ? <LoaderCircle className="animate-spin" size={16}/> : <Sparkles size={16}/>}生成标题与内容</button></div>
      </div><p className="mt-3 text-xs leading-5 text-slate-500">仅从 GitHub 提交与 Vercel Production READY 部署中按 commit SHA 和仓库匹配；选择角色后只汇总代码文件范围关联到该角色的已上线改动。生成结果不会使用本地未发布代码，也不会静默截断变更。标题与内容自动填入下方，发布前可编辑核对。</p>{generatedSource ? <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">数据源已核验：{generatedSource} · 已匹配 {releaseEvidence.length} 个提交</p> : null}{releaseEvidence.length ? <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50"><summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">查看 GitHub / Vercel 发布依据（{releaseEvidence.length} 项）</summary><div className="max-h-64 divide-y overflow-auto px-3">{releaseEvidence.map(item => <div key={item.sha} className="flex flex-wrap items-start justify-between gap-2 py-2 text-xs"><div className="min-w-0"><p className="font-medium text-slate-800">{item.message} <span className="font-mono text-slate-400">{item.sha}</span></p><p className="mt-1 text-slate-500">影响角色：{item.affectedRoles.includes("ALL") ? "所有角色" : item.affectedRoles.map(role => ROLE_LABELS[role]).join("、") || "待确认"} · 上线：{new Date(item.deployedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>{item.details ? <p className="mt-1 text-slate-600">{item.details}</p> : null}</div><div className="flex shrink-0 gap-3"><a href={item.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">GitHub</a><a href={item.deploymentUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Vercel</a></div></div>)}</div></details> : null}</fieldset>
      <label className="block text-sm font-medium">标题<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); setConfirming(false); requestId.current = null; }} className="mt-1 block w-full rounded-lg border px-3 py-2" placeholder="例如：PI 导出功能已更新"/></label><label className="block text-sm font-medium">内容<textarea value={content} maxLength={4000} rows={5} onChange={event => { setContent(event.target.value); setConfirming(false); requestId.current = null; }} className="mt-1 block w-full rounded-lg border px-3 py-2" placeholder="说明变更内容、影响范围和需要用户采取的操作"/></label>{confirming ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>请核对发布范围与内容</b><p className="mt-1">接收范围：{audienceLabel}。发布后无法收回已送达的通知。</p><p className="mt-2 font-medium">{title.trim()}</p><p className="mt-1 whitespace-pre-wrap break-words">{content.trim()}</p></div> : null}<div className="flex flex-wrap justify-end gap-2">{confirming ? <button type="button" disabled={publishing} onClick={() => setConfirming(false)} className="rounded-lg border px-4 py-2 text-sm">返回修改</button> : null}<button type="button" disabled={publishing || !title.trim() || !content.trim() || (audience === "ROLES" && !selectedRoles.length)} onClick={() => confirming ? void publish() : setConfirming(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{publishing ? "正在发布…" : confirming ? `确认发布给${audience === "ALL" ? "全部用户" : "指定角色"}` : "预览并发布"}</button></div></div>
    </section>
    <section className="rounded-xl border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">公告发布记录</h2><p className="mt-1 text-xs text-slate-500">按公告发布时间筛选，最多显示 100 条。</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-500">从<input type="date" value={historyFrom} onChange={event => setHistoryFrom(event.target.value)} className="mt-1 block h-9 rounded-lg border px-2 text-sm text-slate-800"/></label><label className="text-xs text-slate-500">至<input type="date" value={historyTo} onChange={event => setHistoryTo(event.target.value)} className="mt-1 block h-9 rounded-lg border px-2 text-sm text-slate-800"/></label><button type="button" onClick={() => setAppliedHistoryRange({ from: historyFrom, to: historyTo })} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm text-slate-700 hover:bg-slate-50"><Search size={15}/>筛选</button><button type="button" onClick={() => { setHistoryFrom(""); setHistoryTo(""); setAppliedHistoryRange({ from: "", to: "" }); }} className="h-9 rounded-lg border px-3 text-sm text-slate-600">重置</button></div></div><div className="mt-3 divide-y">{announcements.map(item => <article key={item.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{item.title}</b><time className="text-xs text-slate-400">{new Date(item.published_at).toLocaleString("zh-CN")}</time></div><p className="mt-1 text-xs text-slate-500">接收范围：{item.recipient_roles?.length ? item.recipient_roles.map(role => ROLE_LABELS[role] || role).join("、") : "所有启用用户"}{item.recipient_count !== null ? ` · ${item.recipient_count} 人` : ""}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{item.content}</p></article>)}{!announcements.length ? <p className="py-5 text-sm text-slate-400">当前日期范围内暂无已发布公告</p> : null}</div></section>
  </div></div>;
}

