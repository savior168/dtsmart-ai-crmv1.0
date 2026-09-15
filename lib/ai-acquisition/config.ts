import { countryInfo } from "@/lib/countries";

export const ACQUISITION_COUNTRIES = [
  "US","CA","GB","IE","DE","FR","ES","PT","IT","NL","BE","PL","CZ","RO","GR","NO","SE","DK","FI","AT","CH",
  "AU","NZ","AE","SA","TR","ZA","NG","KE","GH","TZ","UG","MA","EG","MX","BR","AR","CL","CO","PE","IN","ID","MY","SG","PH","TH","VN","JP","KR",
] as const;

export type AcquisitionCountry = (typeof ACQUISITION_COUNTRIES)[number];
export const MAX_ACQUISITION_INDUSTRIES = 20;
export const MAX_ACQUISITION_KEYWORDS = 30;
export const MAX_ACQUISITION_SEARCH_TERMS = 80;

export const ACQUISITION_INDUSTRY_TERMS: Record<string, string> = {
  "手机维修店": "mobile phone repair",
  "手机配件批发商": "phone parts wholesale",
  "手机配件零售商": "mobile phone accessories store",
  "手机进口商": "mobile phone importer",
  "电脑维修店": "computer repair",
  "电脑配件批发商": "computer parts wholesale",
  "消费电子批发商": "consumer electronics wholesale",
  "电子元器件经销商": "electronic components distributor",
  "家电维修服务商": "appliance repair service",
  "汽车配件批发商": "auto parts wholesale",
  "汽车维修服务商": "auto repair service",
  "机械设备经销商": "industrial machinery distributor",
  "工业设备维修商": "industrial equipment repair",
  "建材批发商": "building materials wholesale",
  "五金工具经销商": "hardware tools distributor",
  "家具批发商": "furniture wholesale",
  "服装批发商": "clothing wholesale",
  "鞋类批发商": "footwear wholesale",
  "珠宝首饰批发商": "jewelry wholesale",
  "美妆产品批发商": "beauty products wholesale",
  "医疗器械经销商": "medical equipment distributor",
  "实验室设备供应商": "laboratory equipment supplier",
  "食品饮料批发商": "food and beverage wholesale",
  "农产品进口商": "agricultural products importer",
  "包装材料供应商": "packaging materials supplier",
  "印刷服务商": "commercial printing service",
  "物流货运服务商": "freight forwarding company",
  "仓储服务商": "warehousing service",
  "酒店用品供应商": "hotel supplies distributor",
  "餐饮设备供应商": "restaurant equipment supplier",
  "办公用品批发商": "office supplies wholesale",
  "安防设备经销商": "security equipment distributor",
  "光伏设备经销商": "solar equipment distributor",
  "照明产品批发商": "lighting products wholesale",
  "化工产品经销商": "chemical products distributor",
  "塑料制品批发商": "plastic products wholesale",
  "橡胶制品供应商": "rubber products supplier",
  "跨境电商卖家": "cross-border ecommerce seller",
  "软件服务公司": "software services company",
  "信息技术服务商": "information technology service provider",
  "广告营销服务商": "advertising marketing agency",
};

export const ACQUISITION_COMMON_INDUSTRIES = [
  "手机维修店",
  "手机配件批发商",
  "手机配件零售商",
  "手机进口商",
  "电脑维修店",
  "电脑配件批发商",
] as const;

function industryFeatures(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const features = new Set(normalized.split(/\s+/).filter(Boolean));
  const compactHan = normalized.replace(/[^\p{Script=Han}]/gu, "");
  for (let index = 0; index < compactHan.length - 1; index += 1) features.add(compactHan.slice(index, index + 2));
  return features;
}

export function acquisitionIndustrySuggestions(query: string, limit = 8) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];
  const queryFeatures = industryFeatures(normalized);
  return Object.entries(ACQUISITION_INDUSTRY_TERMS)
    .map(([label, searchTerm]) => {
      const candidate = `${label} ${searchTerm}`.toLowerCase();
      const candidateFeatures = industryFeatures(candidate);
      const matched = [...queryFeatures].filter((feature) => candidateFeatures.has(feature)).length;
      const coverage = queryFeatures.size ? matched / queryFeatures.size : 0;
      const candidateCoverage = candidateFeatures.size ? matched / candidateFeatures.size : 0;
      const exactBoost = candidate.includes(normalized) || normalized.includes(label.toLowerCase()) ? 2 : 0;
      return { label, score: exactBoost + coverage * 0.8 + candidateCoverage * 0.2 };
    })
    .filter((item) => item.score >= 0.22)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "zh-CN"))
    .slice(0, limit)
    .map((item) => item.label);
}

const INDUSTRY_KEYWORD_RECOMMENDATIONS: Record<string, string[]> = {
  "手机维修店": ["screen repair", "battery replacement", "board repair", "phone parts"],
  "手机配件批发商": ["LCD screens", "replacement parts", "spare parts", "B2B supplier"],
  "手机配件零售商": ["phone cases", "chargers", "screen protectors", "mobile accessories"],
  "手机进口商": ["mobile devices", "wholesale", "distributor", "B2B"],
  "电脑维修店": ["laptop repair", "hardware repair", "motherboard repair", "computer parts"],
  "电脑配件批发商": ["laptop parts", "replacement parts", "spare parts", "B2B supplier"],
};

const ROLE_KEYWORD_RECOMMENDATIONS: Array<[RegExp, string[]]> = [
  [/批发|wholesale/i, ["B2B supplier", "distributor", "bulk order"]],
  [/进口|import/i, ["importer", "distributor", "wholesale"]],
  [/经销|distribut/i, ["authorized distributor", "B2B supplier", "wholesale"]],
  [/供应|supplier/i, ["B2B supplier", "manufacturer", "wholesale"]],
  [/零售|retail|商店|store/i, ["retail store", "shop", "dealer"]],
  [/维修|repair/i, ["repair service", "spare parts", "replacement"]],
  [/服务|service/i, ["service company", "commercial service", "business service"]],
];

export function acquisitionKeywordRecommendations(industries: string[]) {
  const values = industries.flatMap((industry) => {
    const exact = INDUSTRY_KEYWORD_RECOMMENDATIONS[industry];
    if (exact) return exact;
    return ROLE_KEYWORD_RECOMMENDATIONS.find(([pattern]) => pattern.test(industry))?.[1] || [];
  });
  return [...new Set(values)].slice(0, MAX_ACQUISITION_KEYWORDS);
}

const COMMON_LOCAL_TERMS: Partial<Record<AcquisitionCountry, Record<string, string>>> = {
  DE: { "mobile phone repair": "Handyreparatur", "computer repair": "Computerreparatur", "phone parts wholesale": "Handy Ersatzteile Großhandel" },
  FR: { "mobile phone repair": "réparation téléphone mobile", "computer repair": "réparation ordinateur", "phone parts wholesale": "grossiste pièces téléphone" },
  ES: { "mobile phone repair": "reparación de móviles", "computer repair": "reparación de ordenadores", "phone parts wholesale": "mayorista repuestos móviles" },
  PT: { "mobile phone repair": "reparação de telemóveis", "computer repair": "reparação de computadores", "phone parts wholesale": "grossista peças telemóveis" },
  IT: { "mobile phone repair": "riparazione cellulari", "computer repair": "riparazione computer", "phone parts wholesale": "ingrosso ricambi cellulari" },
  PL: { "mobile phone repair": "serwis telefonów", "computer repair": "serwis komputerów", "phone parts wholesale": "hurtownia części telefonów" },
  NL: { "mobile phone repair": "telefoon reparatie", "computer repair": "computer reparatie", "phone parts wholesale": "groothandel telefoononderdelen" },
  BR: { "mobile phone repair": "conserto de celular", "computer repair": "conserto de computador", "phone parts wholesale": "atacado peças celular" },
  TR: { "mobile phone repair": "telefon tamiri", "computer repair": "bilgisayar tamiri", "phone parts wholesale": "telefon yedek parça toptan" },
};

export function normalizeAcquisitionCountries(values: unknown): AcquisitionCountry[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => countryInfo(String(value)).code).filter((code): code is AcquisitionCountry => ACQUISITION_COUNTRIES.includes(code as AcquisitionCountry)))];
}

export function localizedSearchTerms(country: AcquisitionCountry, industries: string[], keywords: string[]) {
  const industryTerms = industries.map((value) => ACQUISITION_INDUSTRY_TERMS[value] || value);
  const translations = COMMON_LOCAL_TERMS[country] || {};
  const normalizedKeywords = [...new Set(keywords.map((value) => value.trim()).filter(Boolean))];
  const groups = industryTerms.map((term) => {
    const translated = translations[term.toLowerCase()];
    const bases = translated && translated.toLowerCase() !== term.toLowerCase() ? [translated, term] : [term];
    if (!normalizedKeywords.length) return bases;
    // Keywords may refine a selected industry, but must never become a
    // standalone broad search that escapes the user's target industry.
    return [...bases, ...bases.flatMap((base) => normalizedKeywords.map((keyword) => `${base} ${keyword}`))];
  });
  const requested: string[] = [];
  for (let round = 0; requested.length < MAX_ACQUISITION_SEARCH_TERMS; round += 1) {
    let added = false;
    for (const group of groups) if (group[round]) { requested.push(group[round]); added = true; }
    if (!added) break;
  }
  return [...new Set(requested)].slice(0, MAX_ACQUISITION_SEARCH_TERMS);
}
