import { NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { getGoogleMapsActualBilling, type GooglePlacesSkuKey } from "@/lib/google-cloud-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("costs.view");
    const billing = await getGoogleMapsActualBilling();
    if (billing.state !== "CONNECTED") return NextResponse.json(billing);
    const skuByKey: Record<GooglePlacesSkuKey, string> = {
      TEXT_SEARCH_IDS_ONLY: "PLACES_TEXT_SEARCH_ID_ONLY",
      PLACE_DETAILS_PRO: "PLACES_DETAILS_PRO",
      PLACE_DETAILS_ENTERPRISE: "PLACES_DETAILS_ENTERPRISE",
      PLACE_DETAILS_ATMOSPHERE: "PLACES_DETAILS_ENTERPRISE_ATMOSPHERE",
    };
    const admin = createAdminClient();
    const skuUsage = await Promise.all(billing.skuUsage.map(async (item) => {
      let pendingSystemUsage = 0;
      for (let offset=0;;offset+=1000) {
        let pendingQuery = admin.from("api_cost_ledger").select("quantity")
          .eq("provider", "GOOGLE_PLACES")
          .eq("model_or_sku", skuByKey[item.key])
          .lt("occurred_at", billing.periodEnd);
        pendingQuery = item.latestUsageAt
          ? pendingQuery.gt("occurred_at", item.latestUsageAt)
          : pendingQuery.gte("occurred_at", billing.periodStart);
        const pending = await pendingQuery.range(offset,offset+999);
        if (pending.error) throw pending.error;
        pendingSystemUsage += (pending.data||[]).reduce((sum,row)=>sum+Math.max(0,Number(row.quantity||1)),0);
        if ((pending.data||[]).length<1000) break;
      }
      const projectedUsage = item.usageCount + pendingSystemUsage;
      return {
        ...item,
        pendingSystemUsage,
        projectedUsage,
        projectedRemaining: item.freeLimit === null ? null : Math.max(0, item.freeLimit - projectedUsage),
      };
    }));
    return NextResponse.json({ ...billing, skuUsage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Cloud 账单状态读取失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
