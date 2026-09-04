import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { getGoogleMapsActualBilling } from "@/lib/google-cloud-billing";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("costs.view");
    return NextResponse.json(await getGoogleMapsActualBilling());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Cloud 账单状态读取失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
