"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  ChevronDown,
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  UploadCloud,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { uploadAvatar, validateAvatar } from "@/lib/avatar-upload";

const menu = [
  { label: "工作台", href: "/", icon: LayoutDashboard, permission: "dashboard.view" },
  {
    label: "客户中心", icon: UsersRound, defaultHref: "/customers", children: [
      { label: "客户库", href: "/customers", permission: "customers.view" },
      { label: "客户导入", href: "/import", permission: "imports.view" },
      { label: "跟进管理", href: "/followups", permission: "followups.view" },
    ],
  },
  {
    label: "AI获客与筛选", icon: Sparkles, defaultHref: "/ai-screening", children: [
      { label: "AI获客", href: "/ai-acquisition", permission: "imports.view", disabled: true },
      { label: "AI筛选", href: "/ai-screening", permission: "ai.tasks.view" },
    ],
  },
  {
    label: "销售管理", icon: ClipboardList, defaultHref: "/quotes", children: [
      { label: "报价单", href: "/quotes", permission: "quotes.view" },
      { label: "销售订单", href: "/orders", permission: "orders.view" },
    ],
  },
  { label: "仓库管理", href: "/stock-orders", icon: Boxes, permission: "stock.view" },
  { label: "报表中心", href: "/reports", icon: BarChart3, permission: "reports.view" },
  {
    label: "系统管理", icon: Settings, defaultHref: "/settings", children: [
      { label: "用户与权限", href: "/settings/users", permission: "system.users.view" },
      { label: "操作日志", href: "/settings/audit", permission: "system.audit.view" },
      { label: "安全设置", href: "/settings/security", permission: "system.security.view" },
      { label: "费用中心", href: "/settings/costs", permission: "costs.view" },
    ],
  },
] as const;

const roleLabels = {
  ADMIN: "系统管理员",
  SUPERVISOR: "主管",
  SALES: "销售员",
  WAREHOUSE: "仓库员",
} as const;

type ShellNotice = { id:string; type:string; title:string; content:string|null; href:string|null; read_at:string|null; action_status:"INFO"|"PENDING"|"RESOLVED"; created_at:string };

const pageTitles: Array<[RegExp, string]> = [
  [/^\/$/, "工作台 / 数据总览"],
  [/^\/customers\/new$/, "客户管理 / 新增客户"],
  [/^\/customers\/[^/]+$/, "客户管理 / 客户详情"],
  [/^\/customers$/, "客户中心 / 客户库"],
  [/^\/import$/, "客户中心 / 客户导入"],
  [/^\/ai-screening$/, "AI筛选 / 任务中心"],
  [/^\/ai-screening\/new$/, "AI筛选 / 任务中心 / 创建任务"],
  [/^\/ai-screening\/strategies$/, "AI筛选 / 任务中心 / 策略说明"],
  [/^\/ai-screening\/tasks\/[^/]+\/report$/, "AI筛选 / 任务详情 / 任务报告"],
  [/^\/ai-screening\/tasks\/[^/]+$/, "AI筛选 / 任务中心 / 任务详情"],
  [/^\/ai-screening\/results$/, "AI筛选 / 今日完成客户"],
  [/^\/ai-screening\/failures$/, "AI筛选 / 待重试客户"],
  [/^\/ai-screening\/usage$/, "AI筛选 / 任务中心 / AI筛选用量与费用"],
  [/^\/ai-screening\/customers\/[^/]+\/evidence$/, "AI筛选 / 任务详情 / 客户分析依据"],
  [/^\/followups$/, "客户中心 / 跟进管理"],
  [/^\/quotes\/new$/, "销售管理 / 报价单 / 创建报价单"],
  [/^\/quotes\/[^/]+\/print$/, "销售管理 / 报价单 / 打印预览"],
  [/^\/quotes\/[^/]+$/, "销售管理 / 报价单 / 报价详情"],
  [/^\/quotes$/, "销售管理 / 报价单"],
  [/^\/orders\/[^/]+$/, "销售管理 / 销售订单 / 订单详情"],
  [/^\/orders$/, "销售管理 / 销售订单"],
  [/^\/stock-orders\/[^/]+$/, "仓库管理 / 备货单详情"],
  [/^\/stock-orders$/, "仓库管理 / 备货单"],
  [/^\/reports$/, "报表中心"],
  [/^\/settings\/costs$/, "系统管理 / 费用中心"],
  [/^\/notifications$/, "站内通知"],
  [/^\/profile$/, "个人中心 / 账号资料"],
  [/^\/settings\/users$/, "系统管理 / 用户管理"],
  [/^\/settings\/roles$/, "系统管理 / 角色权限"],
  [/^\/settings\/audit$/, "系统管理 / 操作日志"],
  [/^\/settings\/security$/, "系统管理 / 安全设置"],
  [/^\/settings$/, "系统管理"],
];

function isActive(path: string, href: string) {
  return href === "/"
    ? path === "/"
    : path === href || path.startsWith(`${href}/`);
}

function ProfileModal({
  type,
  close,
  saved,
  profile,
}: {
  type: "avatar" | "name" | "password";
  close: () => void;
  saved: () => void;
  profile: { name: string; avatar_url: string };
}) {
  const [value, setValue] = useState({
    avatar_url: "",
    name: "",
    old_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(profile.avatar_url);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  useEffect(() => {
    setValue((current) => ({ ...current, name: profile.name, avatar_url: profile.avatar_url }));
    if (!avatarFile) setAvatarPreview(profile.avatar_url);
  }, [avatarFile, profile.avatar_url, profile.name]);
  useEffect(() => () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
  }, []);
  function selectAvatar(file?: File) {
    setMessage("");
    if (!file) return;
    const validationError = validateAvatar(file);
    if (validationError) return setMessage(validationError);
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewObjectUrlRef.current = previewUrl;
    setAvatarFile(file);
    setAvatarPreview(previewUrl);
  }
  async function submit() {
    setMessage("");
    if (type === "name" && !value.name.trim()) return setMessage("请输入用户名");
    if (type === "password" && value.new_password !== value.confirm_password)
      return setMessage("两次输入的新密码不一致");
    setBusy(true);
    const isPassword = type === "password";
    try {
      const body = isPassword
        ? value
        : type === "avatar"
          ? { avatar_url: await uploadAvatar(avatarFile as File) }
          : { name: value.name.trim() };
      const response = await fetch(
        isPassword ? "/api/users/password" : "/api/users/profile",
        {
          method: isPassword ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "保存失败");
      window.dispatchEvent(new CustomEvent("dtsmart-profile-updated"));
      saved();
      close();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  const title =
    type === "avatar"
      ? "修改头像"
      : type === "name"
        ? "修改用户名"
        : "修改登录密码";
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/30 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={close}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X size={19} />
          </button>
        </div>
        <div className="mt-5 space-y-3">
          {type === "avatar" ? (
            <>
              <input ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => selectAvatar(event.target.files?.[0])}
                className="hidden"
              />
              <button type="button" onClick={() => inputRef.current?.click()} className="group flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-blue-200 bg-gradient-to-b from-blue-50 to-white px-6 py-7 transition hover:border-blue-400 hover:bg-blue-50">
                <span className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border-4 border-white bg-blue-100 text-3xl font-bold text-blue-600 shadow-lg">
                  {avatarPreview ? <Image unoptimized width={112} height={112} src={avatarPreview} alt="头像预览" className="h-full w-full object-cover"/> : profile.name.slice(0, 1)}
                </span>
                <span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm group-hover:bg-blue-700"><UploadCloud size={17}/>选择头像图片</span>
                <small className="mt-2 text-slate-500">支持 JPG、PNG、WebP，文件不超过 5MB</small>
              </button>
            </>
          ) : null}
          {type === "name" ? (
            <input
              value={value.name}
              onChange={(event) =>
                setValue({ ...value, name: event.target.value })
              }
              placeholder="请输入用户名"
              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
            />
          ) : null}
          {type === "password" ? (
            <>
              <input
                type="password"
                value={value.old_password}
                onChange={(event) =>
                  setValue({ ...value, old_password: event.target.value })
                }
                placeholder="原密码"
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
              />
              <input
                type="password"
                value={value.new_password}
                onChange={(event) =>
                  setValue({ ...value, new_password: event.target.value })
                }
                placeholder="新密码"
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
              />
              <input
                type="password"
                value={value.confirm_password}
                onChange={(event) =>
                  setValue({ ...value, confirm_password: event.target.value })
                }
                placeholder="确认新密码"
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
              />
            </>
          ) : null}
        </div>
        {message ? (
          <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700">
            {message}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (type === "avatar" && !avatarFile)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<"light" | "dark">("light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(["客户中心", "获客与筛选"]));
  const [profile, setProfile] = useState<{
    name: string;
    email: string;
    avatar_url: string;
    role: "ADMIN" | "SUPERVISOR" | "SALES" | "WAREHOUSE";
    must_change_password: boolean;
    permissions: string[];
  } | null>(null);
  const [noticeCount, setNoticeCount] = useState(0);
  const [notices, setNotices] = useState<ShellNotice[]>([]);
  const [toastNotices, setToastNotices] = useState<ShellNotice[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pageTitleOverride, setPageTitleOverride] = useState("");
  const [modal, setModal] = useState<"avatar" | "name" | "password" | null>(
    null,
  );
  const profileRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const profileRequestRef = useRef(0);
  const loadProfile = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    try {
      const response = await fetch("/api/users/me", {
        cache: "no-store",
        headers: { "x-dtsmart-profile": "current-session" },
      });
      const body = await response.json().catch(() => ({}));
      if (requestId !== profileRequestRef.current) return;
      if (!response.ok) {
        setProfile(null);
        return;
      }
      const email = String(body.email || "").trim();
      const name = String(body.name || "").trim() || email.split("@")[0] || "用户";
      setProfile({ name, email, avatar_url: String(body.avatar_url || ""), role: body.role === "ADMIN" ? "ADMIN" : body.role === "SUPERVISOR" ? "SUPERVISOR" : body.role === "WAREHOUSE" ? "WAREHOUSE" : "SALES", must_change_password: Boolean(body.must_change_password), permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [] });
    } catch {
      // 短暂网络异常时保留已经核验的当前用户，避免菜单切换时闪回占位账号。
    }
  }, []);
  const loadNotices = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?status=active&page_size=30", { cache:"no-store" });
      const body = await response.json();
      if(response.ok){
        const next=(body.data||[]) as ShellNotice[];
        setNotices(next);setNoticeCount(Number(body.unread||0));
        const storageKey="dtsmart-notification-toasts";
        const shown=new Set<string>(JSON.parse(window.sessionStorage.getItem(storageKey)||"[]"));
        const incoming=next.filter(item=>!item.read_at&&!shown.has(item.id)).slice(0,3);
        if(incoming.length){
          incoming.forEach(item=>shown.add(item.id));
          window.sessionStorage.setItem(storageKey,JSON.stringify([...shown].slice(-200)));
          setToastNotices(current=>[...incoming,...current.filter(item=>!incoming.some(nextItem=>nextItem.id===item.id))].slice(0,3));
        }
      }
    } catch { /* 保留已加载通知 */ }
  },[]);
  const openNotice = useCallback(async (item:ShellNotice) => {
    if(!item.read_at)await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id,action:"READ"})});
    setToastNotices(current=>current.filter(notice=>notice.id!==item.id));setNoticeOpen(false);void loadNotices();if(item.href)router.push(item.href);
  },[loadNotices,router]);
  useEffect(() => {
    const refresh = () => void loadProfile();
    window.addEventListener("dtsmart-profile-updated", refresh);
    window.addEventListener("dtsmart-auth-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("dtsmart-profile-updated", refresh);
      window.removeEventListener("dtsmart-auth-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadProfile]);
  const canLoadNotices = Boolean(profile) && path !== "/login" && path !== "/reset-password";
  useEffect(() => {
    if (!canLoadNotices) {
      setNotices([]); setNoticeCount(0); setToastNotices([]);
      return;
    }
    const refresh = () => void loadNotices();
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [canLoadNotices, loadNotices]);
  useEffect(() => { if(profile?.must_change_password && path !== "/profile") router.replace("/profile?password=required"); },[path,profile?.must_change_password,router]);
  useEffect(() => {
    const saved = window.localStorage.getItem("dtsmart-sidebar-mode");
    setSidebarMode(saved === "dark" ? "dark" : "light");
  }, []);
  useEffect(() => {
    setMobileOpen(false);
    setPageTitleOverride("");
    setProfileOpen(false);
    setNoticeOpen(false);
    if (path === "/login" || path === "/reset-password") {
      profileRequestRef.current += 1;
      setProfile(null);
    } else {
      void loadProfile();
    }
  }, [loadProfile, path]);
  useEffect(() => {
    const updateTitle = (event: Event) => setPageTitleOverride(String((event as CustomEvent<string>).detail || ""));
    window.addEventListener("dtsmart-page-title", updateTitle);
    return () => window.removeEventListener("dtsmart-page-title", updateTitle);
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      )
        setProfileOpen(false);
      if (noticeRef.current && !noticeRef.current.contains(event.target as Node)) setNoticeOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (path === "/login" || path === "/reset-password") return <>{children}</>;
  const title = pageTitleOverride || pageTitles.find(([pattern]) => pattern.test(path))?.[1] || "智客云";
  const titleParts = title.split(" / ");
  const effectiveWidth = collapsed ? 76 : sidebarWidth;
  const sidebarDark = sidebarMode === "dark";
  const canSeePermission = (permission: string) => profile?.role === "ADMIN" || Boolean(profile?.permissions.includes(permission));
  function toggleSidebarMode() {
    const next = sidebarDark ? "light" : "dark";
    setSidebarMode(next);
    window.localStorage.setItem("dtsmart-sidebar-mode", next);
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.clear();
    sessionStorage.clear();
    profileRequestRef.current += 1;
    setProfile(null);
    setProfileOpen(false);
    setModal(null);
    router.replace("/login");
    router.refresh();
  }
  const sidebar = (
    <>
      <div
        className={`flex h-[76px] items-center border-b ${sidebarDark ? "border-slate-800" : "border-slate-100"} ${collapsed ? "justify-center px-3" : "px-4"}`}
      >
        <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-2.5">
          <Image
            src="/zhikeyun-logo.svg"
            width={40}
            height={40}
            priority
            alt="智客云 Logo"
            className="h-10 w-10 shrink-0 rounded-xl shadow-sm"
          />
          {!collapsed ? (
            <span className="min-w-0">
              <b className={`block whitespace-nowrap text-[15px] font-bold leading-5 tracking-tight ${sidebarDark ? "text-white" : "text-slate-950"}`}>
                智客云
              </b>
              <small className={`block whitespace-nowrap text-[12px] ${sidebarDark ? "text-slate-400" : "text-slate-500"}`}>
                真实识别&amp;精准转化
              </small>
            </span>
          ) : null}
        </Link>
      </div>
      <nav className="h-[calc(100vh-196px)] space-y-2 overflow-y-auto px-3 py-4">
        {menu.map((item) => {
          const Icon = item.icon;
          if ("children" in item) {
            const children = item.children.filter((child) => canSeePermission(child.permission));
            if (!children.length) return null;
            const selected = children.some((child) => !("disabled" in child && child.disabled) && isActive(path, child.href));
            const expanded = !collapsed && (expandedGroups.has(item.label) || selected);
            if (collapsed) return <Link key={item.label} href={children.find((child) => !("disabled" in child && child.disabled))?.href || item.defaultHref} prefetch={false} title={item.label} className={`flex items-center justify-center rounded-lg px-2 py-3 transition ${selected ? "bg-blue-600 text-white" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}><Icon size={21} strokeWidth={1.8}/><span className="sr-only">{item.label}</span></Link>;
            return <div key={item.label} className="space-y-1">
              <button type="button" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(item.label)) next.delete(item.label); else next.add(item.label); return next; })} className={`flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left transition ${selected ? sidebarDark ? "bg-slate-800 font-semibold text-white" : "bg-blue-50 font-semibold text-blue-700" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                <Icon size={21} strokeWidth={1.8}/><span className="min-w-0 flex-1 text-[15px]">{item.label}</span><ChevronDown size={16} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}/>
              </button>
              {expanded ? <div className={`space-y-1 border-l ${sidebarDark ? "border-slate-700" : "border-slate-200"} ml-7 pl-3`}>{children.map((child) => { if ("disabled" in child && child.disabled) return <div key={child.href} aria-disabled="true" title="该功能已预留，本期暂不开发" className={`flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2.5 text-[14px] ${sidebarDark ? "text-slate-600" : "text-slate-400"}`}><span>{child.label}</span><small className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">规划中</small></div>; const childSelected = isActive(path, child.href); return <Link key={child.href} href={child.href} prefetch={false} className={`block rounded-lg px-3 py-2.5 text-[14px] transition ${childSelected ? sidebarDark ? "bg-blue-600 font-semibold text-white" : "bg-blue-600 font-semibold text-white shadow-sm" : sidebarDark ? "text-slate-400 hover:bg-slate-800 hover:text-white" : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"}`}>{child.label}</Link>; })}</div> : null}
            </div>;
          }
          const permitted = canSeePermission(item.permission);
          if (!permitted) return null;
          const selected = isActive(path, item.href);
          return <Link key={item.href} href={item.href} prefetch={false} title={collapsed ? item.label : undefined} className={`flex items-center rounded-lg transition ${collapsed ? "justify-center px-2 py-3" : "gap-4 px-4 py-3"} ${selected ? sidebarDark ? "bg-blue-600 font-semibold text-white" : "bg-gradient-to-r from-blue-600 to-blue-700 font-semibold text-white shadow-sm shadow-blue-200" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}><Icon size={21} strokeWidth={1.8}/><span className={collapsed ? "sr-only" : "text-[15px]"}>{item.label}</span></Link>;
        })}
      </nav>
      <button
        type="button"
        onClick={toggleSidebarMode}
        title={sidebarDark ? "切换浅色菜单" : "切换深色菜单"}
        className={`absolute bottom-[72px] left-0 right-0 flex h-12 items-center border-t transition ${sidebarDark ? "border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white" : "border-slate-100 text-slate-600 hover:bg-slate-50 hover:text-blue-700"} ${collapsed ? "justify-center" : "gap-4 px-7"}`}
      >
        {sidebarDark ? <Sun size={19} /> : <Moon size={19} />}
        {!collapsed ? <span className="text-[13px] font-medium">{sidebarDark ? "浅色菜单" : "深色菜单"}</span> : null}
      </button>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={`absolute bottom-0 left-0 right-0 flex h-[72px] items-center border-t transition ${sidebarDark ? "border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white" : "border-slate-100 text-slate-600 hover:bg-slate-50 hover:text-blue-700"} ${collapsed ? "justify-center" : "gap-4 px-7"}`}
      >
        <ChevronLeft
          size={20}
          className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
        />
        {!collapsed ? (
          <span className="text-[14px] font-medium">收起菜单</span>
        ) : null}
      </button>
    </>
  );
  return (
    <div className="min-h-screen bg-[#f7f9fc] text-slate-900 lg:flex">
      <aside
        style={{ width: effectiveWidth }}
        className={`sticky top-0 hidden h-screen shrink-0 self-start overflow-hidden border-r transition-[width] duration-200 lg:block ${sidebarDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}
      >
        {sidebar}
        {!collapsed ? (
          <div
            onMouseDown={(event) => {
              const startX = event.clientX;
              const initial = sidebarWidth;
              const move = (moveEvent: MouseEvent) =>
                setSidebarWidth(
                  Math.max(
                    210,
                    Math.min(300, initial + moveEvent.clientX - startX),
                  ),
                );
              const stop = () => {
                removeEventListener("mousemove", move);
                removeEventListener("mouseup", stop);
              };
              addEventListener("mousemove", move);
              addEventListener("mouseup", stop);
            }}
            className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-blue-200"
          />
        ) : null}
      </aside>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-900/35 lg:hidden"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setMobileOpen(false)
          }
        >
          <aside className={`relative h-full w-[240px] shadow-2xl ${sidebarDark ? "bg-slate-950" : "bg-white"}`}>
            {sidebar}
            <button
              type="button"
              aria-label="关闭菜单"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1 text-slate-500"
            >
              <X size={20} />
            </button>
          </aside>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <header className="crm-topbar sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-slate-200 bg-white px-4 lg:px-6">
          <button
            type="button"
            aria-label="打开菜单"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Menu size={21} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-bold tracking-tight text-slate-950">
            {titleParts.length > 1 ? (
              <>
                <span className="text-slate-500">{titleParts[0]}</span>
                <span className="mx-2 text-slate-300">/</span>
                <span>{titleParts[1]}</span>
              </>
            ) : (
              title
            )}
          </h1>
          <div ref={noticeRef} className="relative">
          <button
            type="button"
            onClick={() => setNoticeOpen(value=>!value)}
            aria-label="通知"
            title="查看系统通知"
            className="relative grid h-10 w-10 place-items-center rounded-full text-slate-800 hover:bg-slate-100"
          >
            <Bell size={22} strokeWidth={1.8} />
            {noticeCount > 0 ? (
              <span className="absolute right-0 top-0 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
                {Math.min(noticeCount, 99)}
              </span>
            ) : null}
          </button>
          {noticeOpen?<div className="absolute right-0 mt-3 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><b className="text-sm">系统通知</b>{noticeCount?<button type="button" onClick={async()=>{await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"READ_ALL"})});void loadNotices();}} className="text-xs font-medium text-blue-600">全部已读</button>:null}</div><div className="max-h-96 overflow-y-auto">{notices.map(item=><button key={item.id} type="button" onClick={()=>void openNotice(item)} className={`block w-full border-b px-4 py-3 text-left hover:bg-slate-50 ${item.read_at?"bg-white":"bg-blue-50/60"}`}><span className="flex items-center justify-between gap-3"><b className="text-sm">{item.title}</b><span className="flex items-center gap-2">{item.action_status==="PENDING"?<small className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">待处理</small>:null}{!item.read_at?<i className="h-2 w-2 shrink-0 rounded-full bg-blue-600"/>:null}</span></span><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.content}</p><time className="mt-1 block text-[11px] text-slate-400">{new Date(item.created_at).toLocaleString("zh-CN")}</time></button>)}{!notices.length?<p className="py-10 text-center text-sm text-slate-400">暂无系统通知</p>:null}</div><Link href="/notifications" onClick={()=>setNoticeOpen(false)} className="block border-t px-4 py-3 text-center text-sm font-medium text-blue-600">查看全部通知</Link></div>:null}
          </div>
          <ThemeSwitcher />
          <div ref={profileRef} className="relative">
            <button
              type="button"
              title={profile ? `欢迎您，${profile.name}（${roleLabels[profile.role]}）` : "正在读取当前登录用户"}
              aria-label={profile ? `当前用户：${profile.name}，${roleLabels[profile.role]}` : "正在读取当前登录用户"}
              disabled={!profile}
              onClick={() => profile && setProfileOpen((value) => !value)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-slate-50"
            >
              <span className={`grid h-9 w-9 place-items-center overflow-hidden rounded-full ring-2 ring-slate-100 ${profile ? "bg-blue-100 font-semibold text-blue-700" : "animate-pulse bg-slate-200"}`}>
                {profile?.avatar_url ? (
                  <Image
                    unoptimized
                    width={36}
                    height={36}
                    src={profile.avatar_url}
                    alt="用户头像"
                    className="h-full w-full object-cover"
                  />
                ) : profile ? profile.name.slice(0, 1) : null}
              </span>
              {profile ? <>
                <span className="hidden max-w-24 truncate text-sm font-medium text-slate-800 sm:block">{profile.name}</span>
                <ChevronDown size={15} className="hidden text-slate-500 sm:block" />
              </> : <span className="hidden h-4 w-16 animate-pulse rounded bg-slate-200 sm:block" aria-hidden="true" />}
            </button>
            {profileOpen && profile ? (
              <div className="absolute right-0 mt-3 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <b className="block text-sm">欢迎您，{profile.name}（{roleLabels[profile.role]}）</b>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {profile.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setModal("avatar");
                    setProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <UserRound size={15} />
                  修改头像
                </button>
                <Link href="/profile" prefetch={false} onClick={()=>setProfileOpen(false)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50"><UserRound size={15}/>个人中心</Link>
                <button
                  type="button"
                  onClick={() => {
                    setModal("name");
                    setProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <Sparkles size={15} />
                  修改用户名
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModal("password");
                    setProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <Settings size={15} />
                  修改登录密码
                </button>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50"
                >
                  <LogOut size={15} />
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <div className="crm-content min-h-[calc(100vh-64px)]">{children}</div>
      </div>
      {toastNotices.length?<aside aria-live="polite" className="fixed bottom-5 right-5 z-[70] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3">{toastNotices.map(item=><article key={item.id} className="rounded-xl border border-blue-100 bg-white p-4 shadow-2xl"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><Bell size={18}/></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="text-sm">{item.title}</b>{item.action_status==="PENDING"?<small className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">待处理</small>:null}</div><p className="mt-1 text-xs leading-5 text-slate-600">{item.content}</p><div className="mt-3 flex gap-2">{item.href?<button type="button" onClick={()=>void openNotice(item)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">立即查看</button>:null}<button type="button" onClick={()=>setToastNotices(current=>current.filter(notice=>notice.id!==item.id))} className="rounded-lg border px-3 py-1.5 text-xs text-slate-600">稍后处理</button></div></div><button type="button" aria-label="关闭通知" onClick={()=>setToastNotices(current=>current.filter(notice=>notice.id!==item.id))} className="text-slate-400"><X size={17}/></button></div></article>)}</aside>:null}
      {modal && profile ? (
        <ProfileModal
          type={modal}
          close={() => setModal(null)}
          saved={loadProfile}
          profile={profile}
        />
      ) : null}
    </div>
  );
}
