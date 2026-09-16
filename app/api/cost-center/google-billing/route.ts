import { NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requireUser } from "@/lib/auth/current-user";
import { getGoogleMapsActualBilling, type GooglePlacesSkuKey } from "@/lib/google-cloud-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const normalizedUsd = (value: number) => {
  const rounded = Number(value.toFixed(6));
  return Math.abs(rounded) < 0.0000005 ? 0 : rounded;
};

export async function GET(request: Request) {
  try {
    const { account } = await requireUser();
    if (!hasPermission(account, "costs.view") && !hasPermission(account, "ai.cost_summary.view")) throw new Error("FORBIDDEN");
    const billing = await getGoogleMapsActualBilling({ force: new URL(request.url).searchParams.get("refresh") === "1" });
    if (billing.state !== "CONNECTED") return NextResponse.json(billing);
    const skuByKey: Record<GooglePlacesSkuKey, string> = {
      TEXT_SEARCH_IDS_ONLY: "PLACES_TEXT_SEARCH_ID_ONLY",
      TEXT_SEARCH_PRO: "PLACES_TEXT_SEARCH_PRO",
      PLACE_DETAILS_PRO: "PLACES_DETAILS_PRO",
      PLACE_DETAILS_ENTERPRISE: "PLACES_DETAILS_ENTERPRISE",
      PLACE_DETAILS_ATMOSPHERE: "PLACES_DETAILS_ENTERPRISE_ATMOSPHERE",
    };
    const admin = createAdminClient();
    const ledgerRows:Array<{task_id:string|null;service:string;model_or_sku:string|null;quantity:number;amount_usd:number;occurred_at:string}>=[];
    const trackedSkus=[...new Set(Object.values(skuByKey))];
    for (let offset=0;;offset+=1000) {
      const ledger = await admin.from("api_cost_ledger").select("task_id,service,model_or_sku,quantity,amount_usd,occurred_at")
        .eq("provider","GOOGLE_PLACES").in("model_or_sku",trackedSkus)
        .gte("occurred_at",billing.periodStart).lt("occurred_at",billing.periodEnd).range(offset,offset+999);
      if (ledger.error) throw ledger.error;
      ledgerRows.push(...(ledger.data||[]));
      if ((ledger.data||[]).length<1000) break;
    }
    const acquisitionCostTaskIds = new Set<string>();
    const ledgerTaskIds=[...new Set(ledgerRows.map((row)=>row.task_id).filter((id):id is string=>Boolean(id)))];
    for (let offset=0;offset<ledgerTaskIds.length;offset+=200) {
      const taskIds=ledgerTaskIds.slice(offset,offset+200);
      const [parents,children]=await Promise.all([
        admin.from("ai_acquisition_tasks").select("id").in("id",taskIds),
        admin.from("ai_acquisition_candidates").select("screening_task_id").in("screening_task_id",taskIds),
      ]);
      if (parents.error) throw parents.error;
      if (children.error) throw children.error;
      for (const row of parents.data||[]) acquisitionCostTaskIds.add(String(row.id));
      for (const row of children.data||[]) if (row.screening_task_id) acquisitionCostTaskIds.add(String(row.screening_task_id));
    }
    const skuUsage = billing.skuUsage.map((item) => {
      const rows=ledgerRows.filter((row)=>row.model_or_sku===skuByKey[item.key]);
      const isAcquisition=(row:(typeof rows)[number])=>row.service==="AI获客"||Boolean(row.task_id&&acquisitionCostTaskIds.has(String(row.task_id)));
      const quantity=(items:typeof rows)=>items.reduce((sum,row)=>sum+Math.max(0,Number(row.quantity||1)),0);
      const cost=(items:typeof rows)=>normalizedUsd(items.reduce((sum,row)=>sum+Math.max(0,Number(row.amount_usd||0)),0));
      const acquisitionRows=rows.filter(isAcquisition);
      const screeningRows=rows.filter((row)=>!isAcquisition(row));
      const pendingRows=rows.filter((row)=>item.latestUsageAt?row.occurred_at>item.latestUsageAt:row.occurred_at>=billing.periodStart);
      const pendingSystemUsage=quantity(pendingRows);
      const pendingSystemCostUsd=cost(pendingRows);
      const projectedUsage = item.usageCount + pendingSystemUsage;
      const pendingOverageCalls = item.freeLimit === null
        ? 0
        : Math.max(0, pendingSystemUsage - Math.max(0, item.freeLimit - item.usageCount));
      const averagePendingUnitCost = pendingSystemUsage > 0 ? pendingSystemCostUsd / pendingSystemUsage : 0;
      return {
        ...item,
        acquisitionSystemUsage:quantity(acquisitionRows),
        acquisitionSystemCostUsd:cost(acquisitionRows),
        screeningSystemUsage:quantity(screeningRows),
        screeningSystemCostUsd:cost(screeningRows),
        pendingSystemUsage,
        projectedUsage,
        projectedRemaining: item.freeLimit === null ? null : Math.max(0, item.freeLimit - projectedUsage),
        projectedOverageCalls: item.freeLimit === null ? 0 : Math.max(0, projectedUsage - item.freeLimit),
        projectedOverageCostUsd: normalizedUsd(item.netCostUsd + pendingOverageCalls * averagePendingUnitCost),
      };
    });
    return NextResponse.json({ ...billing, skuUsage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Cloud 账单状态读取失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
