import { redirect } from "next/navigation";
import { SystemManagementNav } from "@/components/system-management-nav";
import { requireUser } from "@/lib/auth/current-user";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { account } = await requireUser();
  if (account.role !== "ADMIN") redirect("/");
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px]"><div className="mb-5"><h2 className="text-2xl font-bold tracking-tight text-slate-950">系统管理</h2><p className="mt-1 text-sm text-slate-500">审核账号、维护固定角色权限并追踪关键安全操作。</p></div><SystemManagementNav/><div className="mt-5">{children}</div></div></main>;
}
