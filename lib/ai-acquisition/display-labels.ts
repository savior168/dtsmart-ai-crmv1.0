const BUSINESS_TYPE_LABELS: Record<string, string> = {
  point_of_interest: "商家",
  establishment: "商家",
  service: "服务商",
  store: "零售门店",
  electronics_store: "电子产品店",
  electronics_repair_shop: "电子产品维修店",
  mobile_phone_shop: "手机门店",
  mobile_phone_repair_shop: "手机维修店",
  computer_store: "电脑门店",
  computer_repair_service: "电脑维修服务",
  appliance_repair_service: "家电维修服务",
  repair_service: "维修服务",
  wholesaler: "批发商",
  distributor: "分销商",
};

export function acquisitionBusinessLabel(value?: string | null) {
  const original = String(value || "").trim();
  if (!original) return "待确认行业";
  const translated = original
    .split(/[|,，、;/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => BUSINESS_TYPE_LABELS[item.toLowerCase()] || (/^[a-z][a-z0-9_ -]*$/i.test(item) ? "" : item))
    .filter(Boolean);
  const specific = translated.filter((item) => item !== "商家" && item !== "服务商");
  const labels = [...new Set(specific.length ? specific : translated)];
  return labels.length ? labels.slice(0, 3).join("、") : "行业待核验";
}
