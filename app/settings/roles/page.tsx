import { redirect } from "next/navigation";
import { protectPage } from "@/lib/auth/page-access";
export default async function RolesSettingsPage() { await protectPage("system.roles.view"); redirect("/settings/users"); }
