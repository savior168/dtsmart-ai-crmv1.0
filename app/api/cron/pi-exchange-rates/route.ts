import { NextRequest, NextResponse } from "next/server";
import { QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { loadReferenceRates } from "@/lib/pi-exchange-rates";
import { shouldSaveSnapshot, type RateSnapshot } from "@/lib/pi-rate-snapshot";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const rates = await loadReferenceRates();
    const entries = Object.entries(rates).filter(([currency]) => QUOTE_CURRENCY_CODES.has(currency));
    if (!entries.length) throw new Error("NO_RECENT_REFERENCE_RATES");
    const admin = createAdminClient();
    const { data, error } = await admin.from("pi_exchange_rate_snapshots")
      .select("currency,cny_per_unit,source,reference_date");
    if (error) throw error;
    const existing = new Map(((data || []) as RateSnapshot[]).map((row) => [row.currency, row]));
    const now = Date.now();
    const updates = entries.filter(([currency, rate]) => shouldSaveSnapshot(existing.get(currency), rate, now))
      .map(([currency, rate]) => ({ currency, cny_per_unit: rate.cny, source: rate.source,
        reference_date: rate.date, synced_at: new Date(now).toISOString() }));
    if (updates.length) {
      const { error: writeError } = await admin.from("pi_exchange_rate_snapshots")
        .upsert(updates, { onConflict: "currency" });
      if (writeError) throw writeError;
    }
    console.info("[pi-exchange-rates] daily sync", { received: entries.length, saved: updates.length,
      official: entries.filter(([, rate]) => rate.source === "CFETS").length });
    return NextResponse.json({ ok: true, received: entries.length, saved: updates.length });
  } catch (error) {
    console.error("[pi-exchange-rates] daily sync failed", error);
    return NextResponse.json({ error: "RATE_SYNC_FAILED" }, { status: 503 });
  }
}
