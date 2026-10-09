import "server-only";
import { redirect } from "next/navigation";
import { hasPermission, requireUser } from "@/lib/auth/current-user";

export async function protectPage(permission: string) {
  return protectAnyPage([permission]);
}

export async function protectAnyPage(permissions: readonly string[]) {
  try {
    const context = await requireUser();
    if (!permissions.some((permission) => hasPermission(context.account, permission))) throw new Error("FORBIDDEN");
    return context;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["UNAUTHORIZED", "SESSION_REVOKED"].includes(message)) redirect("/login");
    if (message === "AUTHORIZATION_UNAVAILABLE") {
      redirect(`/access-unavailable?permission=${encodeURIComponent(permissions[0] || "")}`);
    }
    redirect(`/access-denied?permission=${encodeURIComponent(permissions[0] || "")}`);
  }
}
