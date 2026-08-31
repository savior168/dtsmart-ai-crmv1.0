import { redirect } from "next/navigation";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export default async function SettingsPage() {
  const { account } = await requireUser();
  if (account.role === "ADMIN") redirect("/settings/users");
  if (hasPermission(account, "system.audit.view")) redirect("/settings/audit");
  if (hasPermission(account, "system.security.view")) redirect("/settings/security");
  redirect("/");
}
