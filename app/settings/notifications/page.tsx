import { NotificationAdminPanel } from "@/components/notification-admin-panel";
import { protectPage } from "@/lib/auth/page-access";

export default async function NotificationSettingsPage() {
  await protectPage("system.notifications.view");
  return <NotificationAdminPanel />;
}
