"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bot,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Home,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UsersRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

type MenuItem = {
  label: string;
  href?: string;
  icon?: typeof Home;
  children?: MenuItem[];
};

const menu: MenuItem[] = [
  { label: "数据总览", href: "/", icon: LayoutDashboard },
  {
    label: "客户管理",
    icon: UsersRound,
    children: [
      { label: "客户列表", href: "/customers", icon: UsersRound },
      { label: "导入客户", href: "/import", icon: FileSpreadsheet },
      { label: "AI客户筛选", href: "/ai-screening", icon: Bot },
      { label: "客户详情CRM", href: "/customers", icon: UserCheck },
      { label: "客户认领保护", href: "/customers", icon: ShieldCheck },
    ],
  },
  {
    label: "销售管理",
    icon: BarChart3,
    children: [{ label: "销售报表", href: "/reports", icon: BarChart3 }],
  },
  {
    label: "系统管理",
    icon: Database,
    children: [{ label: "Supabase检测", href: "/supabase-test", icon: Database }],
  },
];

const routeTitles: Record<string, string> = {
  "/": "数据总览",
  "/customers": "客户列表",
  "/import": "导入客户",
  "/ai-screening": "AI客户筛选",
  "/reports": "销售报表",
  "/supabase-test": "Supabase检测",
};

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function hasActiveDescendant(item: MenuItem, pathname: string): boolean {
  return Boolean(item.children?.some((child) => isActive(pathname, child.href) || hasActiveDescendant(child, pathname)));
}

function findBreadcrumb(items: MenuItem[], pathname: string, parents: MenuItem[] = []): MenuItem[] {
  for (const item of items) {
    const branch = [...parents, item];
    if (isActive(pathname, item.href)) return branch;
    if (item.children) {
      const found = findBreadcrumb(item.children, pathname, branch);
      if (found.length) return found;
    }
  }
  return [];
}

function MenuNode({ item, pathname, depth = 0 }: { item: MenuItem; pathname: string; depth?: number }) {
  const Icon = item.icon;
  const active = isActive(pathname, item.href);
  const expanded = depth === 0 || active || hasActiveDescendant(item, pathname);
  const content = (
    <span
      className={[
        "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition",
        depth === 0 ? "font-medium text-slate-200" : "text-slate-400",
        depth === 1 ? "ml-4" : "",
        active ? "bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-400/30" : "hover:bg-white/[.06] hover:text-white",
      ].join(" ")}
    >
      {Icon ? <Icon size={depth > 0 ? 15 : 17} className={active ? "text-indigo-300" : "text-slate-500"} /> : null}
      <span className="truncate">{item.label}</span>
    </span>
  );

  return (
    <div>
      {item.href ? <Link href={item.href}>{content}</Link> : content}
      {item.children && expanded ? (
        <div className="mt-1 space-y-1 border-l border-white/10 pl-1">
          {item.children.map((child) => <MenuNode key={`${item.label}-${child.label}`} item={child} pathname={pathname} depth={depth + 1} />)}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return <>{children}</>;

  const breadcrumbs = pathname.startsWith("/customers/")
    ? [{ label: "客户管理" }, { label: "客户列表", href: "/customers" }, { label: "客户详情CRM" }]
    : findBreadcrumb(menu, pathname);
  const title = pathname.startsWith("/customers/") ? "客户详情CRM" : routeTitles[pathname] || "业务页面";

  return (
    <div className="min-h-screen bg-[#080b13] text-slate-100 lg:flex">
      <aside className="z-40 border-b border-white/10 bg-[#070b12] p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-72 lg:border-b-0 lg:border-r lg:p-5">
        <Link href="/" className="flex items-center gap-3 rounded-xl px-1 py-2">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-500 shadow-lg shadow-indigo-500/25">
            <Sparkles size={20} />
          </span>
          <span>
            <span className="block text-lg font-bold tracking-wide">DTSmart</span>
            <span className="block text-xs text-slate-500">AI获客CRM</span>
          </span>
        </Link>
        <nav className="mt-6 grid gap-3">
          {menu.map((item) => <MenuNode key={item.label} item={item} pathname={pathname} />)}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 lg:ml-72">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080b13]/90 px-5 py-3 backdrop-blur lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                <Link href="/" className="hover:text-white">首页</Link>
                {breadcrumbs.map((crumb) => (
                  <span key={crumb.label} className="flex items-center gap-1">
                    <ChevronRight size={13} />
                    {crumb.href ? <Link href={crumb.href} className="hover:text-white">{crumb.label}</Link> : <span>{crumb.label}</span>}
                  </span>
                ))}
              </div>
              <h1 className="mt-1 truncate text-lg font-semibold text-white">{title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => router.back()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/[.06] hover:text-white">
                <PanelLeftClose size={16} />
                返回上一页
              </button>
              <Link href="/" className="inline-flex items-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-400/15">
                <Home size={16} />
                返回数据总览
              </Link>
              <button onClick={() => router.push("/")} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/[.06] hover:text-white">
                <X size={16} />
                关闭
              </button>
              <Link href="/login" className="inline-flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-400/15">
                <LogOut size={16} />
                退出
              </Link>
            </div>
          </div>
        </header>
        <div className="min-h-[calc(100vh-73px)]">{children}</div>
      </div>
    </div>
  );
}
