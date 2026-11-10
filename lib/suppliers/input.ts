export const SETTLEMENT_CYCLES = ["CASH", "WEEKLY", "SEMI_MONTHLY", "MONTHLY", "NET_DAYS", "OTHER", "UNSET"] as const;
export type SettlementCycle = (typeof SETTLEMENT_CYCLES)[number];

const optionalText = (value: unknown, max: number) => {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new Error(`字段内容不能超过${max}字`);
  return text || null;
};

export function parseSupplierInput(value: unknown, previousIsActive = true) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("供应商资料格式不正确");
  const body = value as Record<string, unknown>;
  const requestedCycle = String(body.settlement_cycle || "UNSET").toUpperCase();
  const settlementCycle = requestedCycle === "NET_DAYS" && Number(body.settlement_days) === 15
    ? "SEMI_MONTHLY" : requestedCycle;
  if (!SETTLEMENT_CYCLES.includes(settlementCycle as SettlementCycle)) throw new Error("结算方式不正确");
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") throw new Error("供应商启用状态不正确");
  const isActive = body.is_active === undefined ? previousIsActive : body.is_active;
  if (settlementCycle === "UNSET") throw new Error("请选择供应商商务条件");
  const legacyCode = optionalText(body.legacy_code, 40);
  const requestedCode = optionalText(body.system_code, 40)?.toUpperCase() || null;
  const systemCode = requestedCode || legacyCode?.toUpperCase() || null;
  if (systemCode && !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(systemCode)) throw new Error("供应商代码只能使用大写字母、数字、连字符或下划线");
  if (settlementCycle !== "CASH" && !systemCode) throw new Error("账期供应商必须填写供应商代码");
  const shortName = optionalText(body.short_name, 200);
  const englishShortName = optionalText(body.english_short_name, 200);
  const mainProducts = optionalText(body.main_products, 2000);
  if (!mainProducts) throw new Error("请填写主供产品");
  const settlementDays = settlementCycle === "NET_DAYS" ? Number(body.settlement_days) : null;
  if (settlementCycle === "NET_DAYS" && (!Number.isInteger(settlementDays) || settlementDays! < 1 || settlementDays! > 365)) {
    throw new Error("固定账期天数须为1至365天");
  }
  return {
    system_code: systemCode,
    legacy_code: legacyCode,
    short_name: shortName,
    english_short_name: englishShortName,
    main_products: mainProducts,
    settlement_cycle: settlementCycle as SettlementCycle,
    settlement_days: settlementDays,
    settlement_terms_original: settlementCycle === "SEMI_MONTHLY" ? "半月结（15天）" : optionalText(body.settlement_terms_original, 200),
    cooperation_note: optionalText(body.cooperation_note, 2000),
    after_sales_note: optionalText(body.after_sales_note, 2000),
    price_advantage_note: optionalText(body.price_advantage_note, 2000),
    is_active: isActive,
  };
}
