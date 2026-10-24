"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, LoaderCircle, Megaphone } from "lucide-react";
import type { NotificationPolicy } from "@/lib/notification-policy";
import { USER_ROLES, type UserRole } from "@/lib/auth/permissions";
import { SYSTEM_ANNOUNCEMENT_PRIORITIES, SYSTEM_ANNOUNCEMENT_TYPES, type SystemAnnouncementPriority, type SystemAnnouncementType } from "@/lib/system-announcements";

type PolicyRow = NotificationPolicy & { label: string };
type Announcement = { id: string; title: string; content: string; announcement_type: SystemAnnouncementType; priority: SystemAnnouncementPriority; published_at: string; recipient_roles: UserRole[] | null; recipient_count: number | null };
const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "系统管理员", SUPERVISOR: "主管", SALES: "销售员", ORDER_CLERK: "跟单员", WAREHOUSE: "仓库员" };
const policyGroups = [
  { label: "备货与仓库", types: ["STOCK_ORDER_CREATED", "STOCK_STATUS_CHANGED", "STOCK_PROGRESS_ROUTINE"] },
  { label: "PI 变更", types: ["PI_CHANGE_REQUESTED", "PI_CHANGE_APPLIED", "PI_CHANGE_REJECTED"] },
  { label: "客户与账号待办", types: ["REGISTRATION_REVIEW", "PROTECTION_RENEWAL_REVIEW", "CUSTOMER_ADMIN_ASSIGNED", "CUSTOMER_HANDOVER", "FOLLOWUP_DUE"] },
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
  const [announcementType, setAnnouncementType] = useState<SystemAnnouncementType>("GENERAL");
  const [priority, setPriority] = useState<SystemAnnouncementPriority>("STANDARD");
  const [audience, setAudience] = useState<"ALL" | "ROLES">("ALL");
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([]);
  const requestId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/notifications", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "通知设置加载失败");
      setPolicies(body.policies || []);
      setAnnouncements(body.announcements || []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通知设置加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
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
    setPublishing(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/notifications/announcements", {
        method: "POST", headers: { "Content-Type": "application/json", "x-dtsmart-toast": "manual-error" },
        body: JSON.stringify({ request_id: requestId.current, title: cleanTitle, content: cleanContent, recipient_roles: audience === "ALL" ? null : selectedRoles, announcement_type: announcementType, priority }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "公告发布失败");
      requestId.current = null;
      setConfirming(false);
      setTitle("");
      setContent("");
      setAnnouncementType("GENERAL");
      setPriority("STANDARD");
      setAudience("ALL");
      setSelectedRoles([]);
      setSuccess(`公告已发布到${audience === "ALL" ? "所有启用中用户" : selectedRoles.map(role => ROLE_LABELS[role]).join("、") + "中的启用用户"}的通知中心`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布结果未知，请核对下方历史记录后重试");
    } finally {
      setPublishing(false);
    }
  }

  const otherPolicies = policies.filter(row => !policyGroups.some(group => group.types.includes(row.type)));
  const visibleGroups = otherPolicies.length ? [...policyGroups, { label: "其他通知", types: otherPolicies.map(row => row.type) }] : policyGroups;
  const audienceLabel = audience === "ALL" ? "所有启用中的系统用户" : selectedRoles.map(role => ROLE_LABELS[role]).join("、");
  return <main className="min-w-0 p-4 lg:p-6"><div className="mx-auto max-w-5xl space-y-5">
    <header><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BellRing className="text-blue-600"/>通知与公告</h1><p className="mt-1 text-sm text-slate-500">业务通知按接收人偏好弹出；系统公告单独发布、手动确认，不受业务通知开关影响。</p></header>
    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {success ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p> : null}
    <section className="rounded-xl border bg-white p-4 sm:p-5"><h2 className="font-semibold">业务通知方式</h2><p className="mt-1 text-sm text-slate-500">弹窗与语音按业务类型分组设置；站内通知始终送达。语音还须接收人自己开启，并由浏览器支持。系统公告不在此处控制。</p>
      {loading ? <div className="grid min-h-28 place-items-center"><LoaderCircle className="animate-spin"/></div> : <div className="mt-4 space-y-2">{visibleGroups.map((group, index) => {
        const rows = policies.filter(row => group.types.includes(row.type));
        if (!rows.length) return null;
        return <details key={group.label} className="rounded-lg border border-slate-200 open:border-blue-200" {...(index === 0 ? { open: true } : {})}>
          <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"><span>{group.label}</span><span className="text-xs font-normal text-slate-500">{rows.length} 项</span></summary>
          <div className="divide-y px-4">{rows.map(row => <div key={row.type} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><b className="text-slate-800" title={row.type}>{row.label}</b><div className="flex gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={row.popup_enabled} disabled={Boolean(savingType)} onChange={() => void updatePolicy(row, "popup_enabled")}/>弹窗</label><label className="flex items-center gap-2"><input type="checkbox" checked={row.voice_enabled} disabled={Boolean(savingType)} onChange={() => void updatePolicy(row, "voice_enabled")}/>语音</label></div></div>)}</div>
        </details>;
      })}</div>}
    </section>
    <section className="rounded-xl border bg-white p-4 sm:p-5"><h2 className="flex items-center gap-2 font-semibold"><Megaphone size={18} className="text-blue-600"/>发布系统公告</h2><p className="mt-1 text-sm text-slate-500">用于系统维护、问题修复和功能升级。只发送给发布时符合范围的启用用户，操作会留痕；请勿包含密码或敏感客户资料。</p><div className="mt-4 space-y-3">
      <fieldset className="rounded-lg border border-slate-200 p-3 text-sm"><legend className="px-1 font-medium">接收范围</legend><div className="flex flex-wrap gap-x-6 gap-y-2"><label className="flex items-center gap-2"><input type="radio" name="announcement-audience" checked={audience === "ALL"} onChange={() => { setAudience("ALL"); setConfirming(false); requestId.current = null; }}/>所有启用用户</label><label className="flex items-center gap-2"><input type="radio" name="announcement-audience" checked={audience === "ROLES"} onChange={() => { setAudience("ROLES"); setConfirming(false); requestId.current = null; }}/>指定角色</label></div>{audience === "ROLES" ? <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3">{USER_ROLES.map(role => <label key={role} className="flex items-center gap-2"><input type="checkbox" checked={selectedRoles.includes(role)} onChange={event => { setSelectedRoles(current => event.target.checked ? [...current, role] : current.filter(value => value !== role)); setConfirming(false); requestId.current = null; }}/>{ROLE_LABELS[role]}</label>)}</div> : null}<p className="mt-2 text-xs text-slate-500">按发布时的角色发送；之后角色变化不会补发或撤回。指定角色至少选择一项。</p></fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">公告类型<select value={announcementType} onChange={event => { setAnnouncementType(event.target.value as SystemAnnouncementType); setConfirming(false); requestId.current = null; }} className="mt-1 block w-full rounded-lg border bg-white px-3 py-2">{SYSTEM_ANNOUNCEMENT_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="block text-sm font-medium">重要级别<select value={priority} onChange={event => { setPriority(event.target.value as SystemAnnouncementPriority); setConfirming(false); requestId.current = null; }} className="mt-1 block w-full rounded-lg border bg-white px-3 py-2">{SYSTEM_ANNOUNCEMENT_PRIORITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
      <label className="block text-sm font-medium">标题<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); setConfirming(false); requestId.current = null; }} className="mt-1 block w-full rounded-lg border px-3 py-2" placeholder="简洁说明公告的核心事项"/></label><label className="block text-sm font-medium">公告内容<textarea value={content} maxLength={4000} rows={5} onChange={event => { setContent(event.target.value); setConfirming(false); requestId.current = null; }} className="mt-1 block w-full rounded-lg border px-3 py-2" placeholder="建议说明发生/生效时间、影响范围、用户需要采取的操作；维护公告请写明预计开始与结束时间"/></label><p className="text-xs text-slate-500">普通/重要公告会在页面顶部居中显示，需用户手动确认；紧急公告使用屏幕中央提示。公告不自动关闭，也不受业务通知弹窗开关影响。</p>{confirming ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>请核对发布范围与内容</b><p className="mt-1">接收范围：{audienceLabel}。类型：{SYSTEM_ANNOUNCEMENT_TYPES.find(item => item.value === announcementType)?.label}；级别：{SYSTEM_ANNOUNCEMENT_PRIORITIES.find(item => item.value === priority)?.label}。发布后无法收回已送达的通知。</p><p className="mt-2 font-medium">{title.trim()}</p><p className="mt-1 whitespace-pre-wrap break-words">{content.trim()}</p></div> : null}<div className="flex flex-wrap justify-end gap-2">{confirming ? <button type="button" disabled={publishing} onClick={() => setConfirming(false)} className="rounded-lg border px-4 py-2 text-sm">返回修改</button> : null}<button type="button" disabled={publishing || !title.trim() || !content.trim() || (audience === "ROLES" && !selectedRoles.length)} onClick={() => confirming ? void publish() : setConfirming(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{publishing ? "正在发布…" : confirming ? `确认发布给${audience === "ALL" ? "全部用户" : "指定角色"}` : "预览并发布"}</button></div></div>
    </section>
    <section className="rounded-xl border bg-white p-4 sm:p-5"><h2 className="font-semibold">最近发布</h2><div className="mt-3 divide-y">{announcements.map(item => <article key={item.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{item.title}</b><time className="text-xs text-slate-400">{new Date(item.published_at).toLocaleString("zh-CN")}</time></div><p className="mt-1 text-xs text-slate-500">{SYSTEM_ANNOUNCEMENT_TYPES.find(option => option.value === item.announcement_type)?.label || "一般通知"} · {SYSTEM_ANNOUNCEMENT_PRIORITIES.find(option => option.value === item.priority)?.label || "普通"} · 接收范围：{item.recipient_roles?.length ? item.recipient_roles.map(role => ROLE_LABELS[role] || role).join("、") : "所有启用用户"}{item.recipient_count !== null ? ` · ${item.recipient_count} 人` : ""}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{item.content}</p></article>)}{!announcements.length ? <p className="py-5 text-sm text-slate-400">暂无已发布公告</p> : null}</div></section>
  </div></main>;
}

