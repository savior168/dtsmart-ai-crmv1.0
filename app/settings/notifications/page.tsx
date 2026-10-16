import { NotificationAdminPanel } from "@/components/notification-admin-panel";
import { requireAdmin } from "@/lib/auth/current-user";

export default async function NotificationSettingsPage() {
  await requireAdmin();
  return <NotificationAdminPanel />;
}
