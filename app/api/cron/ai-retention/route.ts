import { NextRequest, NextResponse } from "next/server";
import { cleanExpiredAiData } from "@/lib/ai/retention";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await cleanExpiredAiData();
    console.info("[ai-retention] completed", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ai-retention] failed", error);
    return NextResponse.json({ error: "AI_RETENTION_FAILED" }, { status: 503 });
  }
}
