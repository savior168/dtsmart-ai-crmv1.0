import { redirect } from "next/navigation";
import { SettingsLayoutContent } from "@/components/settings-layout-content";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { account } = await requireUser();
  const canManageUsers = account.role === "ADMIN";
  const canViewAudit = hasPermission(account, "system.audit.view");
  const canViewSecurity = hasPermission(account, "system.security.view");
  const canViewCosts = hasPermission(account, "costs.view");
  if (!canManageUsers && !canViewAudit && !canViewSecurity && !canViewCosts) redirect("/");
  return <SettingsLayoutContent canManageUsers={canManageUsers} canViewAudit={canViewAudit} canViewSecurity={canViewSecurity} canViewCosts={canViewCosts}>{children}</SettingsLayoutContent>;
}
