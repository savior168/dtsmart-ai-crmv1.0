import { requirePermission } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";

export default async function AiUsagePage(){
  await requirePermission("ai.usage.view");
  redirect("/ai-usage?module=screening");
}
