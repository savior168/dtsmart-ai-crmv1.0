import "server-only";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";

export async function protectPage(permission: string) {
  try {
    return await requirePermission(permission);
  } catch {
    redirect(`/access-denied?permission=${encodeURIComponent(permission)}`);
  }
}
