type IndustryCustomer = {
  industry?: string | null;
  category?: string | null;
  ai_screening_done?: boolean | null;
};

const rawCategoryRules: Array<[RegExp, string]> = [
  [/(?:mobile phone|cell phone|smartphone|phone).{0,30}(?:repair|reparatur)|phone repair service|telefonreparatur/i, "手机维修"],
  [/(?:computer|laptop|notebook|pc).{0,30}(?:repair|reparatur)|computer repair service/i, "电脑维修"],
  [/(?:phone|mobile|cellular).{0,30}(?:accessor|parts)|accessory store/i, "手机配件零售"],
  [/(?:cell phone|mobile phone|telephone) store|mobile phone shop/i, "手机零售"],
  [/(?:telecommunications service provider|mobile network operator|telekom partner)/i, "电信运营服务"],
  [/(?:wholesale|wholesaler|distributor|importer)/i, "批发或分销"],
  [/(?:software|it service|computer service|technical support)/i, "软件或IT服务"],
  [/(?:electronics store|consumer electronics)/i, "电子产品零售"],
  [/(?:repair service)/i, "维修服务"],
];

export function customerIndustryLabels(customer: IndustryCustomer) {
  const verified = String(customer.industry || "").trim();
  if (customer.ai_screening_done && verified) return { labels: [verified], verified: true };
  const category = String(customer.category || "").trim().replace(/[_-]+/g, " ");
  const labels = rawCategoryRules.filter(([pattern]) => pattern.test(category)).map(([, label]) => label);
  return { labels: Array.from(new Set(labels)).slice(0, 3), verified: false };
}

export function customerIndustryDisplay(customer: IndustryCustomer) {
  const { labels: distinct, verified } = customerIndustryLabels(customer);
  const verifiedIndustry = String(customer.industry || "").trim();
  if (verified && verifiedIndustry) return { text: verifiedIndustry, verified: true, title: `AI核验行业：${verifiedIndustry}` };
  const text = distinct.length ? distinct.join("、") : "待AI核验";
  return { text, verified: false, title: distinct.length ? `原始商家类别映射：${text}（待AI核验）` : "尚无已核验行业，请先完成AI筛选" };
}

/**
 * Compact server-side filters for raw Google/business categories. The public
 * pool sends the normalized label instead of every raw category value, which
 * keeps multi-select URLs bounded even when thousands of source categories
 * map to the same user-facing industry.
 */
export function rawCategoryPatternsForIndustryLabel(label: string) {
  const patterns: Record<string, string[]> = {
    "手机维修": ["*phone*repair*", "*mobile*repair*", "*cell phone*repair*", "*smartphone*repair*", "*telefonreparatur*"],
    "电脑维修": ["*computer*repair*", "*laptop*repair*", "*notebook*repair*", "*pc repair*"],
    "手机配件零售": ["*phone*accessor*", "*mobile*accessor*", "*cellular*accessor*", "*accessory store*"],
    "手机零售": ["*cell phone*store*", "*mobile phone*store*", "*telephone store*", "*mobile phone shop*"],
    "电信运营服务": ["*telecommunications service provider*", "*mobile network operator*", "*telekom partner*"],
    "批发或分销": ["*wholesale*", "*wholesaler*", "*distributor*", "*importer*"],
    "软件或IT服务": ["*software*", "*it service*", "*computer service*", "*technical support*"],
    "电子产品零售": ["*electronics store*", "*consumer electronics*"],
    "维修服务": ["*repair service*"],
  };
  return patterns[label] || [];
}
