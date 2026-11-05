import { requirePermission } from "@/lib/auth/current-user";
import { NotificationsView } from "@/components/notifications-view";

export default async function NotificationsPage(){const { account } = await requirePermission("notifications.view");return <NotificationsView canAdmin={account.role === "ADMIN"}/>}
