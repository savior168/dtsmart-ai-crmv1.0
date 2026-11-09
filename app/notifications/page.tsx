import { protectPage } from "@/lib/auth/page-access";
import { NotificationsView } from "@/components/notifications-view";

export default async function NotificationsPage() {
  const { account } = await protectPage("notifications.view");
  return <NotificationsView canAdmin={account.role === "ADMIN"} />;
}
