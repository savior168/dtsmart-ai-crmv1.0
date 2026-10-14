import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { QUOTE_CURRENCIES, QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { businessRate, loadReferenceRates, type RateRule } from "@/lib/pi-exchange-rates";
import { mergeReferenceRates, type RateSnapshot } from "@/lib/pi-rate-snapshot";
import { createAdminClient } from "@/lib/supabase/admin";

async function recentReferences() {
  const admin = createAdminClient();
  const [{ data, error }, live] = await Promise.all([
    admin.from("pi_exchange_rate_snapshots").select("currency,cny_per_unit,source,reference_date"),
    loadReferenceRates(),
  ]);
  if (error) throw error;
  return mergeReferenceRates(live, (data || []) as RateSnapshot[]);
}

export async function GET() {
  try {
    const { supabase, account } = await requirePermission("orders.view");
    const { data, error } = await supabase.from("pi_exchange_rate_rules")
      .select("currency,adjustment_mode,adjustment_value,manual_reference_cny,updated_at");
    if (error) throw error;
    const ruleMap = new Map((data || []).map((item) => [item.currency, item as RateRule]));
    const references = await recentReferences();
    const rates = QUOTE_CURRENCIES.map(([currency, label]) => {
      const rule = ruleMap.get(currency);
      const market = references[currency];
      const reference = market?.cny ?? rule?.manual_reference_cny ?? (currency === "CNY" ? 1 : null);
      return {
        currency, label,
        reference_cny: reference,
        source: market?.source ?? (rule?.manual_reference_cny != null ? "MANUAL" : currency === "CNY" ? "IDENTITY" : "UNAVAILABLE"),
        reference_date: market?.date ?? null,
        business_cny: businessRate(reference, rule),
        adjustment_mode: rule?.adjustment_mode || "OFFSET",
        adjustment_value: rule?.adjustment_value || 0,
        manual_reference_cny: rule?.manual_reference_cny ?? null,
        updated_at: rule?.updated_at ?? null,
      };
    });
    // PI creators need the effective rate, not the administrator's reference
    // source, manual override or adjustment rule.
    return NextResponse.json({ rates: account.role === "ADMIN"
      ? rates
      : rates.map(({ currency, label, business_cny }) => ({ currency, label, business_cny })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "汇率加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("pi.rates.manage");
    if (account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const body = await request.json() as Record<string, unknown>;
    const currency = String(body.currency || "").trim().toUpperCase();
    const mode = String(body.adjustment_mode || "").trim();
    const value = Number(body.adjustment_value);
    const manual = body.manual_reference_cny === "" || body.manual_reference_cny == null ? null : Number(body.manual_reference_cny);
    if (!QUOTE_CURRENCY_CODES.has(currency) || !["OFFSET", "PERCENT", "FIXED"].includes(mode)
      || !Number.isFinite(value) || Math.abs(value) > 100000000 || Math.round(value * 1e6) !== value * 1e6
      || (mode === "FIXED" && value <= 0)
      || (mode === "PERCENT" && value <= -100)
      || (manual != null && (!Number.isFinite(manual) || manual <= 0 || Math.round(manual * 1e6) !== manual * 1e6))) {
      throw new Error("币种、调整方式或汇率数值不正确");
    }
    if (manual != null && businessRate(manual, { adjustment_mode: mode as RateRule["adjustment_mode"], adjustment_value: value }) == null) {
      throw new Error("按当前规则计算的业务汇率必须大于零");
    }
    if (currency === "CNY" && (mode !== "FIXED" || value !== 1)) throw new Error("人民币付款币种的业务汇率必须固定为1");
    if (mode !== "FIXED") {
      const marketReference = (await recentReferences())[currency]?.cny ?? null;
      if (marketReference != null && businessRate(marketReference, { adjustment_mode: mode as RateRule["adjustment_mode"], adjustment_value: value }) == null) {
        throw new Error("按当前市场参考价计算的业务汇率必须大于零");
      }
    }
    const { data, error } = await supabase.from("pi_exchange_rate_rules").upsert({
      currency, adjustment_mode: mode, adjustment_value: value,
      manual_reference_cny: manual, updated_by: account.id, updated_at: new Date().toISOString(),
    }, { onConflict: "currency" }).select("currency,adjustment_mode,adjustment_value,manual_reference_cny,updated_at").single();
    if (error) throw error;
    await writeAudit(supabase, account.id, "PI_EXCHANGE_RATE_RULE_UPDATE", "pi_exchange_rate_rule", null, { currency, mode, value, manual_reference_cny: manual });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "汇率规则保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
