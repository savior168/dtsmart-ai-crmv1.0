import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const { data, error } = await createAdminClient().rpc("refresh_shipped_pi_document_reminders");
    if (error) throw error;
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    console.error("[stock-document-reminders] refresh failed", error);
    return NextResponse.json({ error: "DOCUMENT_REMINDERS_FAILED" }, { status: 503 });
  }
}
