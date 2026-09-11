import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { AI_CLOUD_DISPATCH_POLICY, AI_DISPATCH_POLICY_LABELS } from "@/lib/ai/task-types";

export async function GET() {
  try {
    await requirePermission("ai.tasks.create");
    return NextResponse.json({
      policy: AI_CLOUD_DISPATCH_POLICY,
      label: AI_DISPATCH_POLICY_LABELS[AI_CLOUD_DISPATCH_POLICY],
      executor: "VERCEL_WORKFLOW",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行策略加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
