import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { getOpenAiActualBilling } from "@/lib/openai-billing";

export async function GET() {
  try { await requirePermission("costs.view"); return NextResponse.json(await getOpenAiActualBilling()); }
  catch (error) { const message = error instanceof Error ? error.message : "OpenAI 账单状态读取失败"; return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 }); }
}
