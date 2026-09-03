"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileClock, HandCoins, KeyRound, UsersRound } from "lucide-react";

const items = [
  { href: "/settings/users", label: "用户与权限", icon: UsersRound, access: "users" },
  { href: "/settings/costs", label: "费用中心", icon: HandCoins, access: "costs" },
  { href: "/settings/audit", label: "操作日志", icon: FileClock, access: "audit" },
  { href: "/settings/security", label: "安全设置", icon: KeyRound, access: "security" },
];

export function SystemManagementNav({ canManageUsers, canViewAudit, canViewSecurity, canViewCosts }: { canManageUsers:boolean; canViewAudit:boolean; canViewSecurity:boolean; canViewCosts:boolean }) {
  const path = usePathname();
  const visibleItems = items.filter((item) => item.access === "users" ? canManageUsers : item.access === "audit" ? canViewAudit : item.access === "security" ? canViewSecurity : canViewCosts);
  return <nav aria-label="系统管理导航" className="flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{visibleItems.map(({ href, label, icon: Icon }) => { const active = path === href; return <Link key={href} href={href} prefetch={false} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition ${active ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}><Icon size={17}/>{label}</Link>; })}</nav>;
}
