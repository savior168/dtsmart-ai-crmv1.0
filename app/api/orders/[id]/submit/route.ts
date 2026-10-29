import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { loadBaiduFinScopeReferenceRates } from "@/lib/pi-exchange-rates";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReferenceRate } from "@/lib/pi-rate-sources";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, account } = await requirePermission("orders.create");
    const { id } = await params;
    const { revision } = await request.json() as { revision?: number };
    if (!Number.isInteger(revision) || Number(revision) < 1) throw new Error("PI草稿版本不正确，请刷新");
    const { data: draft, error: draftError } = await supabase.from("sales_orders")
      .select("id").eq("id", id).eq("prepared_by", account.id).eq("status", "DRAFT").maybeSingle();
    if (draftError) throw draftError;
    if (!draft) throw new Error("PI草稿不存在或已提交，请刷新后重试");

    let usdRate: ReferenceRate | undefined;
    try {
      usdRate = (await loadBaiduFinScopeReferenceRates(["USD"], true)).USD;
    } catch (rateError) {
      console.error("Baidu USD rate fetch failed before PI submit", rateError);
      return NextResponse.json({ error: "百度美元实时汇率暂不可用，PI草稿已保留，请稍后重试" }, { status: 503 });
    }
    if (!usdRate) return NextResponse.json({ error: "百度美元实时汇率暂不可用，PI草稿已保留，请稍后重试" }, { status: 503 });
    const admin = createAdminClient();
    const { error: snapshotError } = await admin.from("pi_exchange_rate_snapshots").upsert({
      currency: "USD", cny_per_unit: usdRate.cny, source: "BAIDU_FINSCOPE",
      reference_date: usdRate.date, synced_at: new Date().toISOString(),
    }, { onConflict: "currency" });
    if (snapshotError) {
      console.error("Baidu USD rate snapshot persistence failed before PI submit", snapshotError);
      return NextResponse.json({ error: "汇率快照保存失败，PI草稿已保留，请稍后重试" }, { status: 503 });
    }

    const { data, error } = await supabase.rpc("submit_direct_pi_order", {
      p_order_id: id, p_expected_revision: revision,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI提交仓库失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
