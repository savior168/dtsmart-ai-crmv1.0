"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileClock, KeyRound, UsersRound } from "lucide-react";

const items = [
  { href: "/settings/users", label: "用户与权限", icon: UsersRound },
  { href: "/settings/audit", label: "操作日志", icon: FileClock },
  { href: "/settings/security", label: "安全设置", icon: KeyRound },
];

export function SystemManagementNav() {
  const path = usePathname();
  return <nav aria-label="系统管理导航" className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">{items.map(({ href, label, icon: Icon }) => { const active = path === href; return <Link key={href} href={href} prefetch={false} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition ${active ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-blue-700"}`}><Icon size={17}/>{label}</Link>; })}</nav>;
}
