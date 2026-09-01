import { redirect } from "next/navigation";
import { SystemManagementNav } from "@/components/system-management-nav";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { account } = await requireUser();
  const canManageUsers = account.role === "ADMIN";
  const canViewAudit = hasPermission(account, "system.audit.view");
  const canViewSecurity = hasPermission(account, "system.security.view");
  const canViewCosts = hasPermission(account, "costs.view");
  if (!canManageUsers && !canViewAudit && !canViewSecurity && !canViewCosts) redirect("/");
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px]"><div className="mb-5"><h2 className="text-2xl font-bold tracking-tight text-slate-950">系统管理</h2><p className="mt-1 text-sm text-slate-500">查看本人关键操作与系统安全规则；账号、权限、费用和安全配置按角色严格控制。</p></div><SystemManagementNav canManageUsers={canManageUsers} canViewAudit={canViewAudit} canViewSecurity={canViewSecurity} canViewCosts={canViewCosts}/><div className="mt-5">{children}</div></div></main>;
}
