import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission, requireUser, writeAudit } from "@/lib/auth/current-user";
import { QUOTE_CURRENCIES, QUOTE_CURRENCY_CODES } from "@/lib/currencies";
import { BAIDU_DISCOUNT_CURRENCIES } from "@/lib/pi-rate-sources";
import { businessRateForCurrency, loadBaiduFinScopeReferenceRates, loadReferenceRates, type RateRule } from "@/lib/pi-exchange-rates";
import { mergeReferenceRates, type RateSnapshot } from "@/lib/pi-rate-snapshot";
import { createAdminClient } from "@/lib/supabase/admin";

async function recentReferences(currency?: string) {
  const admin = createAdminClient();
  const requestedBaiduCurrencies = currency
    ? (BAIDU_DISCOUNT_CURRENCIES as readonly string[]).includes(currency) ? [currency as typeof BAIDU_DISCOUNT_CURRENCIES[number]] : []
    : [...BAIDU_DISCOUNT_CURRENCIES];
  const [{ data, error }, live, baidu] = await Promise.all([
    admin.from("pi_exchange_rate_snapshots").select("currency,cny_per_unit,source,reference_date"),
    loadReferenceRates(),
    loadBaiduFinScopeReferenceRates(requestedBaiduCurrencies),
  ]);
  if (error) throw error;
  return { ...mergeReferenceRates(live, (data || []) as RateSnapshot[]), ...baidu };
}

export async function GET(request: NextRequest) {
  try {
    const requestedCurrency = request.nextUrl.searchParams.get("currency")?.trim().toUpperCase() || null;
    if (requestedCurrency && !QUOTE_CURRENCY_CODES.has(requestedCurrency)) {
      return NextResponse.json({ error: "币种不正确" }, { status: 400 });
    }
    const { account } = await requireUser();
    if (!hasPermission(account, "orders.view") && !hasPermission(account, "pi.rates.view")) throw new Error("FORBIDDEN");
    const { data, error } = await createAdminClient().from("pi_exchange_rate_rules")
      .select("currency,adjustment_mode,adjustment_value,manual_reference_cny,updated_at");
    if (error) throw error;
    const ruleMap = new Map((data || []).map((item) => [item.currency, item as RateRule]));
    const references = await recentReferences(requestedCurrency || undefined);
    const rates = QUOTE_CURRENCIES.filter(([currency]) => !requestedCurrency || currency === requestedCurrency).map(([currency, label]) => {
      const rule = ruleMap.get(currency);
      const isBaiduManaged = (BAIDU_DISCOUNT_CURRENCIES as readonly string[]).includes(currency);
      const baiduMarket = references[currency]?.source === "BAIDU_FINSCOPE" ? references[currency] : undefined;
      const market = isBaiduManaged ? baiduMarket : references[currency];
      const reference = market?.cny ?? rule?.manual_reference_cny ?? (currency === "CNY" ? 1 : null);
      const source = market?.source ?? (rule?.manual_reference_cny != null ? "MANUAL" : currency === "CNY" ? "IDENTITY" : "UNAVAILABLE");
      const sourceUrl = isBaiduManaged
        ? `https://www.baidu.com/s?wd=${encodeURIComponent(`${label}人民币汇率`)}`
        : source === "CFETS" ? "https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do"
        : source === "AGGREGATED" ? `https://api.frankfurter.dev/v2/rates?base=CNY&symbols=${encodeURIComponent(currency)}`
        : null;
      const adjustmentMode = rule?.adjustment_mode ?? "OFFSET";
      const adjustmentValue = rule?.adjustment_value ?? (isBaiduManaged ? -0.1 : 0);
      const effectiveRule = { adjustment_mode: adjustmentMode, adjustment_value: adjustmentValue };
      return {
        currency, label, reference_cny: reference, source, source_url: sourceUrl,
        reference_date: market?.date ?? null, source_updated_at: market?.updatedAt ?? null,
        business_cny: businessRateForCurrency(currency, reference, effectiveRule),
        adjustment_mode: adjustmentMode, adjustment_value: adjustmentValue,
        manual_reference_cny: rule?.manual_reference_cny ?? null,
        updated_at: rule?.updated_at ?? null,
      };
    });
    // PI creators receive the effective rate and its public, verifiable source only.
    return NextResponse.json({ rates: hasPermission(account, "pi.rates.view")
      ? rates
      : rates.map(({ currency, label, reference_cny, source, source_url, reference_date, source_updated_at, business_cny }) => ({ currency, label, reference_cny, source, source_url, reference_date, source_updated_at, business_cny })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "汇率加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("pi.rates.manage");
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
    if (manual != null && businessRateForCurrency(currency, manual, { adjustment_mode: mode as RateRule["adjustment_mode"], adjustment_value: value }) == null) {
      throw new Error("按当前规则计算的业务汇率必须大于零");
    }
    if (currency === "CNY" && (mode !== "FIXED" || value !== 1)) throw new Error("人民币付款币种的业务汇率必须固定为1");
    if (mode !== "FIXED") {
      const marketReference = (await recentReferences())[currency]?.cny ?? null;
      if (marketReference != null && businessRateForCurrency(currency, marketReference, { adjustment_mode: mode as RateRule["adjustment_mode"], adjustment_value: value }) == null) {
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
