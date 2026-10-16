"use client";

import { usePathname } from "next/navigation";
import { SystemManagementNav } from "@/components/system-management-nav";

export function SettingsLayoutContent({ children, canManageUsers, canViewAudit, canViewSecurity, canViewCosts }: {
  children: React.ReactNode;
  canManageUsers: boolean;
  canViewAudit: boolean;
  canViewSecurity: boolean;
  canViewCosts: boolean;
}) {
  const path = usePathname();
  if (path === "/settings/pi-exchange-rates" || path === "/settings/pi-payment-accounts" || path === "/settings/notifications") return <>{children}</>;
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px]"><div className="mb-5"><h2 className="text-2xl font-bold tracking-tight text-slate-950">系统管理</h2><p className="mt-1 text-sm text-slate-500">查看本人关键操作与系统安全规则；账号、权限、费用和安全配置按角色严格控制。</p></div><SystemManagementNav canManageUsers={canManageUsers} canViewAudit={canViewAudit} canViewSecurity={canViewSecurity} canViewCosts={canViewCosts}/><div className="mt-5">{children}</div></div></main>;
}
