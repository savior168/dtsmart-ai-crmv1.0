import { protectPage } from "@/lib/auth/page-access";
import { redirect } from "next/navigation";

export default async function NotificationSettingsPage() {
  await protectPage("system.notifications.view");
  redirect("/notifications");
}
