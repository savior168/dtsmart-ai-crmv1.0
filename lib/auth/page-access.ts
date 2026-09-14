import "server-only";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";

export async function protectPage(permission: string) {
  try {
    return await requirePermission(permission);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["UNAUTHORIZED", "SESSION_REVOKED"].includes(message)) redirect("/login");
    if (message === "AUTHORIZATION_UNAVAILABLE") {
      redirect(`/access-unavailable?permission=${encodeURIComponent(permission)}`);
    }
    redirect(`/access-denied?permission=${encodeURIComponent(permission)}`);
  }
}
