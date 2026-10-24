"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  ShoppingCart,
  ClipboardList,
  PackageSearch,
  ChevronDown,
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  KeyRound,
  UploadCloud,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { uploadAvatar, validateAvatar } from "@/lib/avatar-upload";
import { notificationVoiceText } from "@/lib/notification-voice";
import { notificationDisplayContent, notificationToastSessionKey, notificationToastStorageKey, notificationToastSummary, selectNotificationToastBatch, shouldShowNotificationToast } from "@/lib/notification-toast";
import { defaultNotificationPolicy, notificationPolicyType, type NotificationPolicy } from "@/lib/notification-policy";

const menu = [
  { label: "工作台", href: "/", icon: LayoutDashboard, permission: "dashboard.view" },
  {
    label: "商品中心", icon: PackageSearch, defaultHref: "/products", children: [
      { label: "商品资料", href: "/products", permission: "products.view" },
      { label: "商品分类", href: "/products/categories", permission: "products.categories.view" },
      { label: "产品价格表", href: "/products/prices", permission: "pricebooks.view" },
      { label: "销售报价设置", href: "/products/pricing", permission: "pricebooks.rules.view" },
      { label: "导入产品价格表", href: "/products/import", permission: "pricebooks.import" },
    ],
  },
  {
    label: "客户中心", icon: UsersRound, defaultHref: "/customers/pool", children: [
      { label: "客户公海", href: "/customers/pool", permission: "customers.view" },
      { label: "我的客户", href: "/customers", permission: "customers.view" },
      { label: "跟进管理", href: "/followups", permission: "followups.view" },
    ],
  },
  {
    label: "AI获客与筛选", icon: Sparkles, defaultHref: "/ai-screening", children: [
      { label: "AI获客", href: "/ai-acquisition", permission: "ai.acquisition.view" },
      { label: "获客结果", href: "/ai-acquisition/customers", permission: "ai.acquisition.view" },
      { label: "AI筛选", href: "/ai-screening", permission: "ai.tasks.view" },
    ],
  },
  {
    label: "销售管理", icon: ClipboardList, defaultHref: "/orders", children: [
      { label: "PI订单", href: "/orders", permission: "orders.view" },
    ],
  },
  { label: "采购管理", icon: ShoppingCart, defaultHref: "/stock-orders", children: [
    { label: "备货单", href: "/stock-orders", permission: "stock.view" },
  ] },
  { label: "PI财务设置", icon: Settings, defaultHref: "/settings/pi-exchange-rates", children: [
    { label: "汇率设置", href: "/settings/pi-exchange-rates", permission: "pi.rates.view" },
    { label: "收款账户", href: "/settings/pi-payment-accounts", permission: "pi.accounts.view" },
  ] },
  { label: "报表中心", href: "/reports", icon: BarChart3, permission: "reports.view" },
  {
    label: "系统管理", icon: Settings, defaultHref: "/settings", children: [
      { label: "用户与权限", href: "/settings/users", permission: "system.users.view" },
      { label: "费用中心", href: "/settings/costs", permission: "costs.view" },
      { label: "操作日志", href: "/settings/audit", permission: "system.audit.view" },
      { label: "通知与公告", href: "/settings/notifications", permission: "system.notifications.view" },
      { label: "安全设置", href: "/settings/security", permission: "system.security.view" },
    ],
  },
] as const;

type ShellNotice = { id:string; type:string; title:string; content:string|null; metadata?:Record<string,unknown>|null; href:string|null; read_at:string|null; dismissed_at:string|null; action_status:"INFO"|"PENDING"|"RESOLVED"; deliver_at:string; created_at:string };

const pageTitles: Array<[RegExp, string]> = [
  [/^\/$/, "工作台 / 数据总览"],
  [/^\/settings\/notifications$/, "系统管理 / 通知与公告"],
  [/^\/customers\/new$/, "客户管理 / 新增客户"],
  [/^\/customers\/pool$/, "客户中心 / 客户公海"],
  [/^\/customers\/protection$/, "客户中心 / 保护到期"],
  [/^\/customers\/[^/]+$/, "客户管理 / 客户详情"],
  [/^\/customers$/, "客户中心 / 我的客户"],
  [/^\/import$/, "客户中心 / 批量导入"],
  [/^\/ai-acquisition$/, "AI获客 / 任务中心"],
  [/^\/ai-acquisition\/new$/, "AI获客 / 创建任务"],
  [/^\/ai-acquisition\/settings$/, "AI获客 / 获客设置"],
  [/^\/ai-acquisition\/customers$/, "AI获客 / 客户结果"],
  [/^\/ai-acquisition\/tasks\/[^/]+\/report$/, "AI获客 / 任务报告"],
  [/^\/ai-acquisition\/tasks\/[^/]+$/, "AI获客 / 任务详情"],
  [/^\/ai-acquisition\/usage$/, "AI获客 / 用量与费用"],
  [/^\/ai-usage$/, "AI获客与筛选 / AI用量与费用"],
  [/^\/ai-screening$/, "AI筛选 / 任务中心"],
  [/^\/ai-screening\/new$/, "AI筛选 / 创建任务"],
  [/^\/ai-screening\/settings$/, "AI筛选 / 筛选设置"],
  [/^\/ai-screening\/strategies$/, "AI筛选 / 分析规则"],
  [/^\/ai-screening\/tasks\/[^/]+\/report$/, "AI筛选 / 任务报告"],
  [/^\/ai-screening\/tasks\/[^/]+$/, "AI筛选 / 任务详情"],
  [/^\/ai-screening\/results$/, "AI筛选 / 今日完成客户"],
  [/^\/ai-screening\/failures$/, "AI筛选 / 待重试客户"],
  [/^\/ai-screening\/usage$/, "AI筛选 / 用量与费用"],
  [/^\/ai-screening\/customers\/[^/]+\/evidence$/, "AI筛选 / 客户分析依据"],
  [/^\/followups$/, "客户中心 / 跟进管理"],
  [/^\/products\/import\/[^/]+$/, "商品中心 / 产品价格表 / 导入核对"],
  [/^\/products\/import$/, "商品中心 / 产品价格表 / 导入"],
  [/^\/products\/pricing$/, "商品中心 / 销售报价设置"],
  [/^\/products\/categories$/, "商品中心 / 商品分类"],
  [/^\/products\/prices$/, "商品中心 / 产品价格表"],
  [/^\/products$/, "商品中心 / 商品资料"],
  [/^\/orders\/new$/, "销售管理 / PI订单 / 创建PI"],
  [/^\/orders\/[^/]+$/, "销售管理 / PI订单 / 订单详情"],
  [/^\/orders$/, "销售管理 / PI订单"],
  [/^\/stock-orders\/[^/]+$/, "采购管理 / 备货单详情"],
  [/^\/stock-orders$/, "采购管理 / 备货单"],
  [/^\/reports$/, "报表中心"],
  [/^\/settings\/costs$/, "系统管理 / 费用中心"],
  [/^\/settings\/pi-exchange-rates$/, "PI财务设置 / 汇率设置"],
  [/^\/settings\/pi-payment-accounts$/, "PI财务设置 / 收款账户"],
  [/^\/notifications$/, "站内通知"],
  [/^\/profile$/, "个人中心 / 账号资料"],
  [/^\/settings\/users$/, "系统管理 / 用户管理"],
  [/^\/settings\/roles$/, "系统管理 / 角色权限"],
  [/^\/settings\/audit$/, "系统管理 / 操作日志"],
  [/^\/settings\/security$/, "系统管理 / 安全设置"],
  [/^\/settings$/, "系统管理"],
];

function isActive(path: string, href: string, fromPool = false) {
  if (fromPool && /^\/customers\/[^/]+$/.test(path)) return href === "/customers/pool";
  if (href === "/customers") {
    const belongsToAnotherCustomerWorkspace = [
      "/customers/pool",
      "/customers/protection",
      "/customers/conflicts",
    ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    return !belongsToAnotherCustomerWorkspace &&
      (path === "/customers" || path.startsWith("/customers/"));
  }
  // “获客结果” is a separate list entry.  Keep the acquisition task hub
  // highlighted for task routes, but never highlight both entries at once.
  if (href === "/ai-acquisition") {
    return path !== "/ai-acquisition/customers" &&
      (path === "/ai-acquisition" || path.startsWith("/ai-acquisition/"));
  }
  // Product center has several sibling pages below /products. The product
  // master entry is exact-match only, otherwise every sibling looks selected.
  if (href === "/products") return path === "/products";
  return href === "/"
    ? path === "/"
    : path === href || path.startsWith(`${href}/`);
}

function ProfileModal({
  type,
  close,
  saved,
  passwordRequired,
  profile,
}: {
  type: "avatar" | "profile" | "password";
  close: () => void;
  saved: (changes?: { name?: string; avatar_url?: string; business_phone?: string; business_email?: string }) => void;
  passwordRequired: boolean;
  profile: { name: string; email: string; phone: string; business_phone: string; business_email: string; avatar_url: string };
}) {
  const canClose = type !== "password" || !passwordRequired;
  const [value, setValue] = useState({
    avatar_url: "",
    name: "",
    business_phone: "",
    business_email: "",
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
    setValue((current) => ({ ...current, name: profile.name, business_phone: profile.business_phone, business_email: profile.business_email, avatar_url: profile.avatar_url }));
    if (!avatarFile) setAvatarPreview(profile.avatar_url);
  }, [avatarFile, profile.avatar_url, profile.name, profile.business_phone, profile.business_email]);
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
    if (type === "profile" && !value.name.trim()) return setMessage("请输入用户名");
    if (type === "password" && value.new_password !== value.confirm_password)
      return setMessage("两次输入的新密码不一致");
    setBusy(true);
    const isPassword = type === "password";
    try {
      const body = isPassword
        ? value
        : type === "avatar"
          ? avatarFile ? { avatar_url: await uploadAvatar(avatarFile) } : null
          : { name: value.name.trim(), business_phone: value.business_phone.trim(), business_email: value.business_email.trim(), ...(avatarFile ? { avatar_url: await uploadAvatar(avatarFile) } : {}) };
      if (!body) return setMessage("请选择头像图片");
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
      const savedChanges = isPassword ? undefined : {
        ...(type === "profile" ? { name: value.name.trim() } : {}),
        ...(type === "profile" ? { business_phone: value.business_phone.trim(), business_email: value.business_email.trim() } : {}),
        ...(typeof body === "object" && body && "avatar_url" in body
          ? { avatar_url: `/api/users/avatar?v=${encodeURIComponent(String(body.avatar_url))}` }
          : {}),
      };
      saved(savedChanges);
      window.dispatchEvent(new CustomEvent("dtsmart-profile-updated"));
      close();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  const title = type === "avatar" ? "修改头像" : type === "profile" ? "修改个人资料" : "修改登录密码";
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/30 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && canClose && close()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          {canClose ? <button
            type="button"
            aria-label="关闭"
            onClick={close}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X size={19} />
          </button> : null}
        </div>
        <div className="mt-5 space-y-3">
          {type === "avatar" || type === "profile" ? (
            <>
              <input ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => selectAvatar(event.target.files?.[0])}
                className="hidden"
              />
              <button type="button" onClick={() => inputRef.current?.click()} className={`group flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-blue-200 bg-gradient-to-b from-blue-50 to-white transition hover:border-blue-400 hover:bg-blue-50 ${type === "avatar" ? "px-6 py-7" : "px-4 py-4"}`}>
                <span className={`grid place-items-center overflow-hidden rounded-full border-4 border-white bg-blue-100 font-bold text-blue-600 shadow-lg ${type === "avatar" ? "h-28 w-28 text-3xl" : "h-16 w-16 text-xl"}`}>
                  {avatarPreview ? <Image unoptimized width={112} height={112} src={avatarPreview} alt="头像预览" className="h-full w-full object-cover"/> : profile.name.slice(0, 1)}
                </span>
                <span className={`inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm group-hover:bg-blue-700 ${type === "avatar" ? "mt-4" : "mt-2"}`}><UploadCloud size={17}/>{type === "avatar" ? "选择头像图片" : "点击更换头像"}</span>
                <small className="mt-2 text-slate-500">支持 JPG、PNG、WebP，文件不超过 5MB</small>
              </button>
            </>
          ) : null}
          {type === "profile" ? (
            <input
              name="display-name"
              autoComplete="name"
              type="text"
              value={value.name}
              onChange={(event) =>
                setValue({ ...value, name: event.target.value })
              }
              placeholder="请输入用户名"
              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
            />
          ) : null}
          {type === "profile" ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">登录邮箱<input value={profile.email || "未绑定"} readOnly aria-readonly="true" className="mt-1.5 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-500"/></label>
              <label className="block text-sm font-medium text-slate-700">绑定手机号<input value={profile.phone || "未绑定"} readOnly aria-readonly="true" className="mt-1.5 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-500"/></label>
              <p className="text-xs leading-5 text-slate-500">邮箱与手机号用于登录和账号识别，当前不支持自行修改；如需变更请联系系统管理员。</p>
              <label className="block text-sm font-medium text-slate-700">PI业务联系电话<input name="business-phone" autoComplete="tel" value={value.business_phone} onChange={(event) => setValue({ ...value, business_phone: event.target.value })} placeholder="用于客户PI，不改变登录手机号" className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 text-sm" /></label>
              <label className="block text-sm font-medium text-slate-700">PI业务邮箱<input name="business-email" autoComplete="email" type="email" value={value.business_email} onChange={(event) => setValue({ ...value, business_email: event.target.value })} placeholder="用于客户PI，不改变登录邮箱" className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 text-sm" /></label>
              <p className="text-xs leading-5 text-slate-500">创建新PI时自动带入并保存快照；留空则使用原有账号联系方式。请确保对外联系方式准确。</p>
            </div>
          ) : null}
          {type === "password" ? (
            <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-3">
              {/* Keep credential autofill scoped to this dialog. Without an in-form
                  username field Chrome may inject the login email into a customer search input. */}
              <input
                aria-hidden="true"
                tabIndex={-1}
                type="text"
                name="dtsmart-password-account"
                autoComplete="username"
                value={profile.email}
                readOnly
                className="sr-only"
              />
              <input
                name="dtsmart-current-password"
                autoComplete="off"
                type="password"
                value={value.old_password}
                data-lpignore="true"
                data-1p-ignore="true"
                onChange={(event) =>
                  setValue({ ...value, old_password: event.target.value })
                }
                placeholder="原密码"
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
              />
              <input
                name="dtsmart-new-password"
                autoComplete="new-password"
                type="password"
                value={value.new_password}
                data-lpignore="true"
                data-1p-ignore="true"
                onChange={(event) =>
                  setValue({ ...value, new_password: event.target.value })
                }
                placeholder="新密码"
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
              />
              <input
                name="dtsmart-confirm-password"
                autoComplete="new-password"
                type="password"
                value={value.confirm_password}
                data-lpignore="true"
                data-1p-ignore="true"
                onChange={(event) =>
                  setValue({ ...value, confirm_password: event.target.value })
                }
                placeholder="确认新密码"
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
              />
            </form>
          ) : null}
        </div>
        {message ? (
          <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700">
            {message}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          {canClose ? <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
          >
            取消
          </button> : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
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
  const [fromPool, setFromPool] = useState(false);
  useLayoutEffect(() => {
    setFromPool(new URLSearchParams(window.location.search).get("from") === "pool");
  }, [path]);
  const router = useRouter();
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<"light" | "dark">("light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(["客户中心", "获客与筛选"]));
  const [profile, setProfile] = useState<{
    name: string;
    email: string;
    phone: string;
    business_phone: string;
    business_email: string;
    avatar_url: string;
    role: "ADMIN" | "SUPERVISOR" | "SALES" | "ORDER_CLERK" | "WAREHOUSE";
    must_change_password: boolean;
    permissions: string[];
  } | null>(null);
  const [noticeCount, setNoticeCount] = useState(0);
  const [notices, setNotices] = useState<ShellNotice[]>([]);
  const [toastNotices, setToastNotices] = useState<ShellNotice[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pageTitleOverride, setPageTitleOverride] = useState("");
  const [modal, setModal] = useState<"avatar" | "profile" | "password" | null>(
    null,
  );
  const profileRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const toastNoticesRef = useRef<ShellNotice[]>([]);
  const toastDismissTimersRef = useRef(new Map<string, number>());
  const policyRef = useRef<Record<string, NotificationPolicy>>({});
  const voiceEnabledRef = useRef(false);
  const settingsRequestRef = useRef(0);
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
      setProfile({ name, email, phone: String(body.phone || "").trim(), business_phone: String(body.business_phone || "").trim(), business_email: String(body.business_email || "").trim(), avatar_url: String(body.avatar_url || ""), role: body.role === "ADMIN" ? "ADMIN" : body.role === "SUPERVISOR" ? "SUPERVISOR" : body.role === "WAREHOUSE" ? "WAREHOUSE" : body.role === "ORDER_CLERK" ? "ORDER_CLERK" : "SALES", must_change_password: Boolean(body.must_change_password), permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [] });
    } catch {
      // 短暂网络异常时保留已经核验的当前用户，避免菜单切换时闪回占位账号。
    }
  }, []);
  const loadNotices = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?status=active&page_size=100", { cache:"no-store" });
      const body = await response.json();
      if(response.ok){
        const next=(body.data||[]) as ShellNotice[];
        setNotices(next);setNoticeCount(Number(body.unread||0));
        const identity=profile?.email || "unknown";
        const storageKey=notificationToastStorageKey(identity);
        const sessionKey=notificationToastSessionKey(identity);
        const sessionStartedAt=window.sessionStorage.getItem(sessionKey);
        if (!sessionStartedAt) window.sessionStorage.setItem(sessionKey,new Date().toISOString());
        const shown=new Set<string>(JSON.parse(window.sessionStorage.getItem(storageKey)||"[]"));
        const fresh=next.filter(item=>shouldShowNotificationToast(item,shown,sessionStartedAt));
        const popupCandidates=fresh.filter(item=>
          (policyRef.current[notificationPolicyType(item)] || defaultNotificationPolicy(notificationPolicyType(item))).popup_enabled);
        const visibleIds=new Set(toastNoticesRef.current.map(item=>item.id));
        const incoming=selectNotificationToastBatch(popupCandidates,visibleIds);
        incoming.forEach(item=>shown.add(item.id));
        window.sessionStorage.setItem(storageKey,JSON.stringify([...shown].slice(-200)));
        if (profile?.email) {
          const voiceSeenKey=`dtsmart-notification-voice-seen:${profile.email}`;
          const voiceSeen=new Set<string>(JSON.parse(window.localStorage.getItem(voiceSeenKey)||"[]"));
          const voiceFresh=next.filter(item=>shouldShowNotificationToast(item,voiceSeen,sessionStartedAt));
          const unseen=voiceFresh.filter(item=>
            (policyRef.current[notificationPolicyType(item)] || defaultNotificationPolicy(notificationPolicyType(item))).voice_enabled);
          voiceFresh.forEach(item=>voiceSeen.add(item.id));
          window.localStorage.setItem(voiceSeenKey,JSON.stringify([...voiceSeen].slice(-300)));
          if (voiceEnabledRef.current && "speechSynthesis" in window) {
            const spoken=unseen.map(item=>({item,words:notificationVoiceText(item)}))
              .filter(({item,words})=>words && Date.now()-new Date(item.created_at).getTime()<=60*60*1000)
              .slice(0,3);
            for (const {words} of spoken) {
              const utterance=new SpeechSynthesisUtterance(words!);
              utterance.lang="zh-CN";
              utterance.rate=1;
              window.speechSynthesis.speak(utterance);
            }
          }
        }
        if(incoming.length){
          setToastNotices(current=>{
            const currentIds=new Set(current.map(item=>item.id));
            const next=[...current,...incoming.filter(item=>!currentIds.has(item.id))].slice(0,3);
            toastNoticesRef.current=next;
            return next;
          });
        }
      }
    } catch { /* 保留已加载通知 */ }
  },[profile?.email]);
  useLayoutEffect(() => {
    toastNoticesRef.current = toastNotices;
  }, [toastNotices]);
  const openNotice = useCallback(async (item:ShellNotice) => {
    if(!item.read_at)await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id,action:"READ"})});
    setToastNotices(current=>current.filter(notice=>notice.id!==item.id));setNoticeOpen(false);void loadNotices();if(item.href)router.push(item.href);
  },[loadNotices,router]);
  const dismissToast = useCallback(async (item: ShellNotice) => {
    setToastNotices(current => current.filter(notice => notice.id !== item.id));
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json", "x-dtsmart-toast": "manual-error" }, body: JSON.stringify({ id: item.id, action: "DISMISS" }) });
      if (!response.ok) throw new Error("关闭通知未能保存，下次登录时可能再次提醒");
    } catch {
      window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { message: "关闭通知未能保存，下次登录时可能再次提醒", type: "error" } }));
    }
  }, []);
  useEffect(() => {
    const refresh = () => void loadProfile();
    window.addEventListener("dtsmart-profile-updated", refresh);
    window.addEventListener("dtsmart-auth-changed", refresh);
    return () => {
      window.removeEventListener("dtsmart-profile-updated", refresh);
      window.removeEventListener("dtsmart-auth-changed", refresh);
    };
  }, [loadProfile]);
  const canLoadNotices = Boolean(profile && (profile.role === "ADMIN" || profile.permissions.includes("notifications.view"))) && path !== "/login" && path !== "/reset-password";
  useEffect(() => {
    setSpeechSupported("speechSynthesis" in window);
  }, []);
  useEffect(() => {
    if (!canLoadNotices) {
      settingsRequestRef.current += 1;
      policyRef.current = {};
      voiceEnabledRef.current = false;
      setVoiceEnabled(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const requestId = ++settingsRequestRef.current;
      try {
        const response = await fetch("/api/notifications/settings", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled || requestId !== settingsRequestRef.current) return;
        policyRef.current = Object.fromEntries((body.policies || []).map((item: NotificationPolicy) => [item.type, item]));
        voiceEnabledRef.current = Boolean(body.voice_enabled);
        setVoiceEnabled(Boolean(body.voice_enabled));
      } catch { /* Keep the last confirmed server setting during a transient outage. */ }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [canLoadNotices, profile?.email]);
  async function toggleVoice() {
    if (!profile?.email || voiceSaving) return;
    settingsRequestRef.current += 1;
    const next = !voiceEnabled;
    setVoiceSaving(true);
    try {
      const response = await fetch("/api/notifications/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json", "x-dtsmart-toast": "manual-error" },
        body: JSON.stringify({ voice_enabled: next }),
      });
      if (!response.ok) throw new Error();
      voiceEnabledRef.current = next;
      setVoiceEnabled(next);
      if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
      if (next && "speechSynthesis" in window) {
        const sample = new SpeechSynthesisUtterance("重要工作交接语音提醒已开启");
        sample.lang = "zh-CN";
        window.speechSynthesis.speak(sample);
      }
    } catch {
      window.dispatchEvent(new CustomEvent("dtsmart-toast", { detail: { message: "语音偏好保存失败，请稍后重试", type: "error" } }));
    } finally {
      setVoiceSaving(false);
    }
  }
  useEffect(() => {
    if (!canLoadNotices) {
      setNotices([]); setNoticeCount(0); setToastNotices([]);
      return;
    }
    const refresh = () => void loadNotices();
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [canLoadNotices, loadNotices]);
  useEffect(() => {
    const activeIds = new Set(toastNotices.map(item => item.id));
    for (const [id, timer] of toastDismissTimersRef.current) {
      if (!activeIds.has(id)) {
        window.clearTimeout(timer);
        toastDismissTimersRef.current.delete(id);
      }
    }
    for (const item of toastNotices) {
      if (toastDismissTimersRef.current.has(item.id)) continue;
      const timer = window.setTimeout(() => {
        toastDismissTimersRef.current.delete(item.id);
        void dismissToast(item);
      }, 30_000);
      toastDismissTimersRef.current.set(item.id, timer);
    }
  }, [toastNotices, dismissToast]);
  useEffect(() => () => {
    for (const timer of toastDismissTimersRef.current.values()) window.clearTimeout(timer);
    toastDismissTimersRef.current.clear();
  }, []);
  useEffect(() => {
    if (profile?.must_change_password) setModal("password");
  }, [profile?.must_change_password]);
  useEffect(() => {
    if (profile && new URLSearchParams(window.location.search).get("profile") === "1") setModal("profile");
  }, [profile, path]);
  useEffect(() => {
    const saved = window.localStorage.getItem("dtsmart-sidebar-mode");
    setSidebarMode(saved === "dark" ? "dark" : "light");
    const savedWidth = Number(window.localStorage.getItem("dtsmart-sidebar-width") || 248);
    setSidebarWidth(Math.max(232, Math.min(320, savedWidth)));
    setCollapsed(window.localStorage.getItem("dtsmart-sidebar-collapsed") === "1");
  }, []);
  useEffect(() => {
    setMobileOpen(false);
    setPageTitleOverride("");
    setProfileOpen(false);
    setNoticeOpen(false);
    if (path === "/login" || path === "/reset-password") {
      profileRequestRef.current += 1;
      setProfile(null);
    } else if (!profile) {
      void loadProfile();
    }
  }, [loadProfile, path, profile]);
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
  const contextualCustomerTitle = fromPool && /^\/customers\/[^/]+$/.test(path)
    ? "客户中心 / 客户公海 / 客户详情"
    : null;
  const title = pageTitleOverride || contextualCustomerTitle || pageTitles.find(([pattern]) => pattern.test(path))?.[1] || "智客云";
  const titleParts = title.split(" / ");
  const effectiveWidth = collapsed ? 76 : sidebarWidth;
  const sidebarDark = sidebarMode === "dark";
  // Do not turn a transient profile refresh into an empty sidebar.  The API
  // remains the permission boundary; this only keeps the shell usable while
  // the current session profile is still loading or a request briefly fails.
  const canSeePermission = (permission: string) => !profile || profile.role === "ADMIN" || profile.permissions.includes(permission);
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
        className={`flex h-[76px] items-center border-b ${sidebarDark ? "border-slate-800" : "border-slate-100"} ${collapsed ? "justify-center px-3" : "px-6"}`}
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
                智能获客&amp;精准筛选
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
            const selected = children.some((child) => !("disabled" in child && child.disabled) && isActive(path, child.href, fromPool));
            const expanded = !collapsed && (expandedGroups.has(item.label) || selected);
            if (collapsed) return <Link key={item.label} href={children.find((child) => !("disabled" in child && child.disabled))?.href || item.defaultHref} prefetch={false} title={item.label} className={`flex items-center justify-center rounded-lg px-2 py-3 transition ${selected ? sidebarDark ? "bg-slate-800 text-blue-300" : "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}><Icon size={21} strokeWidth={1.8}/><span className="sr-only">{item.label}</span></Link>;
            return <div key={item.label} className="space-y-1">
              <button type="button" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(item.label)) next.delete(item.label); else next.add(item.label); return next; })} className={`flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left transition ${selected ? sidebarDark ? "bg-slate-800 font-semibold text-white" : "bg-blue-50 font-semibold text-blue-700" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                <Icon size={21} strokeWidth={1.8}/><span className="min-w-0 flex-1 text-[15px]">{item.label}</span><ChevronDown size={16} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}/>
              </button>
              {expanded ? <div className={`space-y-1 border-l ${sidebarDark ? "border-slate-700" : "border-slate-200"} ml-7 pl-3`}>{children.map((child) => { if ("disabled" in child && child.disabled) return <div key={child.href} aria-disabled="true" title="该功能已预留，本期暂不开发" className={`flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2.5 text-[14px] ${sidebarDark ? "text-slate-600" : "text-slate-400"}`}><span>{child.label}</span><small className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">规划中</small></div>; const childSelected = isActive(path, child.href, fromPool); return <Link key={child.href} href={child.href} prefetch={false} aria-current={childSelected ? "page" : undefined} className={`block rounded-lg px-3 py-2.5 text-[14px] transition ${childSelected ? sidebarDark ? "bg-slate-800 font-semibold text-blue-300" : "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-100" : sidebarDark ? "text-slate-400 hover:bg-slate-800 hover:text-white" : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"}`}>{child.label}</Link>; })}</div> : null}
            </div>;
          }
          const permitted = canSeePermission(item.permission);
          if (!permitted) return null;
          const selected = isActive(path, item.href, fromPool);
          return <Link key={item.href} href={item.href} prefetch={false} aria-current={selected ? "page" : undefined} title={collapsed ? item.label : undefined} className={`flex items-center rounded-lg transition ${collapsed ? "justify-center px-2 py-3" : "gap-4 px-4 py-3"} ${selected ? sidebarDark ? "bg-slate-800 font-semibold text-blue-300" : "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-100" : sidebarDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}><Icon size={21} strokeWidth={1.8}/><span className={collapsed ? "sr-only" : "text-[15px]"}>{item.label}</span></Link>;
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
        onClick={() => setCollapsed((value) => { const next=!value;window.localStorage.setItem("dtsmart-sidebar-collapsed",next?"1":"0");return next; })}
        aria-label={collapsed ? "展开左侧菜单" : "收起左侧菜单"}
        title={collapsed ? "展开左侧菜单" : "收起左侧菜单"}
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
                    232,
                    Math.min(320, initial + moveEvent.clientX - startX),
                  ),
                );
              const stop = () => {
                setSidebarWidth((value) => { window.localStorage.setItem("dtsmart-sidebar-width",String(value)); return value; });
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
          <aside className={`relative h-full w-[272px] shadow-2xl ${sidebarDark ? "bg-slate-950" : "bg-white"}`}>
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
          {canLoadNotices ? <div ref={noticeRef} className="relative">
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
          {noticeOpen ? <div className="fixed left-3 right-3 top-[4.5rem] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-3 sm:w-[360px]">
            <div className="flex items-center justify-between border-b px-4 py-3"><b className="text-sm">系统通知</b><div className="flex items-center gap-2"><button type="button" disabled={!speechSupported || !profile?.email || voiceSaving} onClick={() => void toggleVoice()} aria-label="重要工作交接语音提醒" aria-pressed={voiceEnabled} title={speechSupported ? "保存到当前账号，仅播报管理员允许的重要通知" : "当前浏览器不支持语音播报"} className="rounded border px-2 py-1 text-xs text-slate-600 disabled:opacity-50">语音{voiceSaving ? "保存中" : voiceEnabled ? "已开启" : "已关闭"}</button>{noticeCount ? <button type="button" onClick={async () => { await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "READ_ALL" }) }); void loadNotices(); }} className="text-xs font-medium text-blue-600">全部已读</button> : null}</div></div>
            <div className="max-h-[min(24rem,calc(100dvh-9rem))] overflow-y-auto">{notices.map(item => <button key={item.id} type="button" onClick={() => void openNotice(item)} className={`block w-full border-b px-4 py-3 text-left hover:bg-slate-50 ${item.read_at ? "bg-white" : "bg-blue-50/60"}`}><span className="flex items-center justify-between gap-3"><b className="text-sm">{item.title}</b><span className="flex items-center gap-2">{item.action_status === "PENDING" ? <small className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">待处理</small> : null}{!item.read_at ? <i className="h-2 w-2 shrink-0 rounded-full bg-blue-600"/> : null}</span></span><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{notificationDisplayContent(item.content)}</p><time className="mt-1 block text-[11px] text-slate-400">{new Date(item.created_at).toLocaleString("zh-CN")}</time></button>)}{!notices.length ? <p className="py-10 text-center text-sm text-slate-400">暂无系统通知</p> : null}</div><Link href="/notifications" onClick={() => setNoticeOpen(false)} className="block border-t px-4 py-3 text-center text-sm font-medium text-blue-600">查看全部通知</Link>
          </div> : null}
          </div> : null}
          <ThemeSwitcher />
          <div ref={profileRef} className="relative">
            <button
              type="button"
              title={profile ? `欢迎您，${profile.name}！` : "正在读取当前登录用户"}
              aria-label={profile ? `欢迎您，${profile.name}！` : "正在读取当前登录用户"}
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
              {profile ? <span className="hidden max-w-32 truncate text-sm font-medium text-slate-800 sm:block">{profile.name}</span> : null}
              {profile ? <>
                <ChevronDown size={15} className="hidden text-slate-500 sm:block" />
              </> : <span className="hidden h-4 w-16 animate-pulse rounded bg-slate-200 sm:block" aria-hidden="true" />}
            </button>
            {profileOpen && profile ? (
              <div className="absolute right-0 mt-3 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <b className="block text-sm">欢迎您，{profile.name}！</b>
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
                  <UploadCloud size={15} />
                  修改头像
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModal("profile");
                    setProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <UserRound size={15} />
                  修改个人资料
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModal("password");
                    setProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <KeyRound size={15} />
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
      {toastNotices.length ? <aside aria-live="polite" className="fixed bottom-5 right-5 z-[70] flex max-h-[calc(100dvh-2.5rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto">{toastNotices.map(item => <article key={item.id} className="rounded-xl border border-blue-100 bg-white p-4 shadow-2xl"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><Bell size={18}/></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="text-sm">{item.title}</b>{item.action_status === "PENDING" ? <small className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">待处理</small> : null}</div><p className="mt-1 text-xs leading-5 text-slate-600">{notificationToastSummary(item)}</p><time className="mt-1 block text-[11px] text-slate-400" dateTime={item.created_at} title={new Date(item.created_at).toLocaleString("zh-CN")}>操作时间 {new Date(item.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time><div className="mt-3 flex gap-2">{item.href ? <button type="button" onClick={() => void openNotice(item)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">立即查看</button> : null}<button type="button" onClick={() => void dismissToast(item)} className="rounded-lg border px-3 py-1.5 text-xs text-slate-600">稍后查看</button></div></div><button type="button" aria-label="关闭通知弹框，保留未读" title="关闭弹框，通知仍保留在通知中心" onClick={() => void dismissToast(item)} className="text-slate-400"><X size={17}/></button></div></article>)}</aside> : null}
      {modal && profile ? (
        <ProfileModal
          type={modal}
          close={() => setModal(null)}
          saved={(changes) => {
            if (changes) setProfile((current) => current ? { ...current, ...changes } : current);
          }}
          passwordRequired={profile.must_change_password}
          profile={profile}
        />
      ) : null}
    </div>
  );
}
