"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Bot,
  ChevronDown,
  ChevronLeft,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Settings,
  Sparkles,
  UploadCloud,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { uploadAvatar, validateAvatar } from "@/lib/avatar-upload";

const menu = [
  { label: "工作台", href: "/", icon: LayoutDashboard },
  { label: "客户管理", href: "/customers", icon: UsersRound },
  { label: "数据导入", href: "/import", icon: FileSpreadsheet },
  { label: "AI筛选", href: "/ai-screening", icon: Bot },
  { label: "跟进管理", href: "/followups", icon: MessageSquareText },
  { label: "报表中心", href: "/reports", icon: BarChart3 },
  { label: "系统设置", href: "/settings", icon: Settings },
] as const;

const pageTitles: Array<[RegExp, string]> = [
  [/^\/$/, "工作台 / 数据总览"],
  [/^\/customers\/new$/, "客户管理 / 新增客户"],
  [/^\/customers\/[^/]+$/, "客户管理 / 客户详情"],
  [/^\/customers$/, "客户管理 / 客户列表"],
  [/^\/import$/, "数据导入"],
  [/^\/ai-screening$/, "AI筛选 / 任务中心"],
  [/^\/ai-screening\/new$/, "AI筛选 / 任务中心 / 创建任务"],
  [/^\/ai-screening\/tasks\/[^/]+\/report$/, "AI筛选 / 任务详情 / 任务报告"],
  [/^\/ai-screening\/tasks\/[^/]+$/, "AI筛选 / 任务中心 / 任务详情"],
  [/^\/ai-screening\/results$/, "AI筛选 / 今日完成客户"],
  [/^\/ai-screening\/failures$/, "AI筛选 / 待重试客户"],
  [/^\/ai-screening\/usage$/, "AI筛选 / 任务中心 / AI筛选用量与费用"],
  [/^\/ai-screening\/customers\/[^/]+\/evidence$/, "AI筛选 / 任务详情 / 客户分析依据"],
  [/^\/followups$/, "跟进管理中心"],
  [/^\/reports$/, "报表中心"],
  [/^\/settings$/, "系统设置与个人资料"],
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
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue((current) => ({ ...current, name: profile.name, avatar_url: profile.avatar_url })), [profile]);
  function selectAvatar(file?: File) {
    setMessage("");
    if (!file) return;
    const validationError = validateAvatar(file);
    if (validationError) return setMessage(validationError);
    setAvatarFile(file);
    setValue((current) => ({ ...current, avatar_url: URL.createObjectURL(file) }));
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
                  {value.avatar_url ? <Image unoptimized width={112} height={112} src={value.avatar_url} alt="头像预览" className="h-full w-full object-cover"/> : profile.name.slice(0, 1)}
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
  const [profile, setProfile] = useState({
    name: "当前用户",
    email: "",
    avatar_url: "",
  });
  const [noticeCount, setNoticeCount] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pageTitleOverride, setPageTitleOverride] = useState("");
  const [modal, setModal] = useState<"avatar" | "name" | "password" | null>(
    null,
  );
  const profileRef = useRef<HTMLDivElement>(null);
  const loadProfile = () =>
    fetch("/api/users/me", { cache: "no-store", headers: { "x-dtsmart-profile": "current-session" } })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!ok) return setProfile({ name: "当前用户", email: "", avatar_url: "" });
        setProfile({ name: body.name || "当前用户", email: body.email || "", avatar_url: body.avatar_url || "" });
      })
      .catch(() => undefined);
  useEffect(() => {
    void loadProfile();
    fetch("/api/dashboard/stats?summary=1")
      .then((response) => response.json())
      .then((body) =>
        setNoticeCount(
          Number(body?.totals?.today_followups || 0) +
            Number(body?.totals?.expiring_protection || 0),
        ),
      )
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const refresh = () => void loadProfile();
    window.addEventListener("dtsmart-profile-updated", refresh);
    return () => window.removeEventListener("dtsmart-profile-updated", refresh);
  }, []);
  useEffect(() => {
    const saved = window.localStorage.getItem("dtsmart-sidebar-mode");
    setSidebarMode(saved === "dark" ? "dark" : "light");
  }, []);
  useEffect(() => {
    setMobileOpen(false);
    setPageTitleOverride("");
    setProfileOpen(false);
    if (path !== "/login" && path !== "/reset-password") {
      setProfile({ name: "当前用户", email: "", avatar_url: "" });
      void loadProfile();
    }
  }, [path]);
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
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (path === "/login" || path === "/reset-password") return <>{children}</>;
  const title = pageTitleOverride || pageTitles.find(([pattern]) => pattern.test(path))?.[1] || "DTSmart TradeOS";
  const titleParts = title.split(" / ");
  const effectiveWidth = collapsed ? 76 : sidebarWidth;
  const sidebarDark = sidebarMode === "dark";
  function toggleSidebarMode() {
    const next = sidebarDark ? "light" : "dark";
    setSidebarMode(next);
    window.localStorage.setItem("dtsmart-sidebar-mode", next);
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.clear();
    sessionStorage.clear();
    setProfile({ name: "当前用户", email: "", avatar_url: "" });
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
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <Image
            src="/dtsmart-tradeos-logo.png"
            width={40}
            height={40}
            priority
            alt="DTSmart TradeOS Logo"
            className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-sm"
          />
          {!collapsed ? (
            <span className="min-w-0">
              <b className={`block whitespace-nowrap text-[15px] font-bold leading-5 tracking-tight ${sidebarDark ? "text-white" : "text-slate-950"}`}>
                DTSmart TradeOS
              </b>
              <small className={`block whitespace-nowrap text-[12px] ${sidebarDark ? "text-slate-400" : "text-slate-500"}`}>
                精准识客&amp;高效转化
              </small>
            </span>
          ) : null}
        </Link>
      </div>
      <nav className="h-[calc(100vh-196px)] space-y-2 overflow-y-auto px-3 py-4">
        {menu.map((item) => {
          const Icon = item.icon;
          const selected = isActive(path, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-lg transition ${collapsed ? "justify-center px-2 py-3" : "gap-4 px-4 py-3"} ${selected ? sidebarDark ? "bg-blue-600 font-semibold text-white" : "bg-gradient-to-r from-blue-600 to-blue-700 font-semibold text-white shadow-sm shadow-blue-200" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}
            >
              <Icon size={21} strokeWidth={1.8} />
              <span className={collapsed ? "sr-only" : "text-[15px]"}>
                {item.label}
              </span>
            </Link>
          );
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
          <Link
            href="/followups"
            aria-label="通知"
            title="查看待办提醒"
            className="relative grid h-10 w-10 place-items-center rounded-full text-slate-800 hover:bg-slate-100"
          >
            <Bell size={22} strokeWidth={1.8} />
            {noticeCount > 0 ? (
              <span className="absolute right-0 top-0 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
                {Math.min(noticeCount, 99)}
              </span>
            ) : null}
          </Link>
          <ThemeSwitcher />
          <div ref={profileRef} className="relative">
            <button
              type="button"
              title={`欢迎您，${profile.name}`}
              onClick={() => setProfileOpen((value) => !value)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-slate-50"
            >
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700 ring-2 ring-slate-100">
                {profile.avatar_url ? (
                  <Image
                    unoptimized
                    width={36}
                    height={36}
                    src={profile.avatar_url}
                    alt="用户头像"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (profile.name || "用").slice(0, 1)
                )}
              </span>
              <span className="hidden max-w-24 truncate text-sm font-medium text-slate-800 sm:block">
                {profile.name}
              </span>
              <ChevronDown
                size={15}
                className="hidden text-slate-500 sm:block"
              />
            </button>
            {profileOpen ? (
              <div className="absolute right-0 mt-3 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <b className="block text-sm">欢迎您，{profile.name}</b>
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
      {modal ? (
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
