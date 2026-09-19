export type DiscoveryRelevanceCandidate = {
  companyName: string;
  businessStatus: string;
  types: string[];
  matchedTerms?: string[];
};

export function discoveryCandidateLooksRelevant(candidate: DiscoveryRelevanceCandidate, industries: string[], keywords: string[]) {
  const normalizeToken = (token: string) => {
    const value = token.toLowerCase();
    if (!/^[a-z]+$/.test(value) || value.length < 4) return value;
    if (value.endsWith("ies") && value.length > 5) return `${value.slice(0, -3)}y`;
    if (value.endsWith("sses")) return value.slice(0, -2);
    if (value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
    return value;
  };
  const normalizeTokens = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2).map(normalizeToken);
  const roleTerms = new Set(["repair", "repairs", "repairing", "service", "services", "wholesale", "wholesaler", "supplier", "supplies", "distribution", "distributor", "importer", "manufacturer", "factory", "agency", "contractor", "维修", "批发", "供应", "经销", "进口", "制造", "服务商"]);
  const genericTerms = new Set(["shop", "store", "company", "business", "limited", "ltd", "inc", "group", "center", "centre", "official", "near", "best"]);
  // Consumer-electronics product words are too broad on their own: a phone
  // retailer or finished-device brand is not necessarily a repair/parts lead.
  const broadFinishedGoodsTerms = new Set(["phone", "mobile", "smartphone", "iphone", "ipad", "macbook", "laptop", "computer", "electronics", "device", "手机", "电脑", "电子", "数码"]);
  const requested = [...industries, ...keywords, ...(candidate.matchedTerms || [])].flatMap(normalizeTokens);
  const requestedDomainTerms = [...new Set(requested.filter((term) => !roleTerms.has(term) && !genericTerms.has(term)))];
  const companyTokens = new Set(normalizeTokens(candidate.companyName));
  const typeTokens = new Set(candidate.types.flatMap(normalizeTokens));
  const candidateTokens = new Set([...companyTokens, ...typeTokens]);
  const equivalentDomainGroups = [
    new Set(["computer", "pc", "laptop", "notebook", "mac", "macbook", "desktop", "计算机", "电脑", "笔记本"]),
    new Set(["phone", "mobile", "smartphone", "iphone", "handy", "telefon", "手机", "移动电话"]),
    new Set(["electronic", "electronics", "device", "gadget", "电子", "数码", "设备"]),
    new Set(["part", "parts", "spare", "component", "accessory", "配件", "零件", "部件"]),
  ];
  const equivalentMatch = (requestedTerm: string) => equivalentDomainGroups.some((group) => group.has(requestedTerm) && [...candidateTokens].some((term) => group.has(term)));
  const matchedDomainTerms = requestedDomainTerms.filter((term) => candidateTokens.has(term) || equivalentMatch(term));
  const hasSpecificDomainMatch = matchedDomainTerms.some((term) => !broadFinishedGoodsTerms.has(term));
  const businessText = `${candidate.companyName} ${candidate.types.join(" ")}`.toLowerCase().replace(/[_-]+/g, " ");
  const requestedText = `${industries.join(" ")} ${keywords.join(" ")}`.toLowerCase();
  const requestedAutomotive = /(?:汽车|汽配|机动车|轮胎|automotive|auto parts|car parts|motor parts|truck parts|tyre)/i.test(requestedText);
  const requestedFood = /(?:食品|饮料|果蔬|水果|蔬菜|餐饮|农业|food|beverage|fruit|vegetable|produce|catering)/i.test(requestedText);
  const requestedRecycling = /(?:回收|废品|电子废弃物|清运|recycl|e-?waste|WEEE|asset disposal|removal)/i.test(requestedText);
  const requestedTelecomMarketing = /(?:电信|通信|营销|广告|网站设计|telecom|marketing|advertising|web design|call cent)/i.test(requestedText);
  const automotiveCandidate = candidate.types.some((value)=>/^(?:auto_parts_store|car_repair|car_dealer|tire_shop|truck_parts_supplier)$/i.test(value))
    || /(?:\b(?:auto|automotive|motor|vehicle|truck|trailer|car)\s+(?:parts?|spares?|components?|accessories?)\b|motor factors?|tyres?|汽车(?:配件|零件)|轮胎)/i.test(businessText);
  const foodCandidate = candidate.types.some((value)=>/^(?:food_wholesaler|food_store|grocery_store|restaurant|cafe|catering_service)$/i.test(value))
    || /(?:fresh produce|fruit and vegetable|food wholesal|food distributor|果蔬|食品批发|餐饮供应)/i.test(businessText);
  const recyclingCandidate = /(?:computer recycling|electronics? recycling|e-?waste|WEEE|IT asset disposal|computer removal|office clearance|废旧电脑回收|电子废弃物|废品回收|清运)/i.test(businessText);
  const telecomMarketingCandidate = /(?:digital marketing|marketing agency|call cent(?:er|re)|website design|电信服务商|数字营销|网站设计)/i.test(businessText);
  // A verified top-level sector mismatch is stronger than generic words such
  // as parts, repair, wholesale or computer. Stop it before any paid evidence
  // collection, while still allowing the same sector for users who selected it.
  if ((automotiveCandidate && !requestedAutomotive)
    || (foodCandidate && !requestedFood)
    || (recyclingCandidate && !requestedRecycling)
    || (telecomMarketingCandidate && !requestedTelecomMarketing)) return false;
  const targetBusinessSignal = /(?:repair|refurbish|wholesale|supplier|distribut|importer|manufacturer|factory|agency|contractor|screen replacement|battery replacement|spare parts|维修|翻新|批发|供应|经销|进口|制造|配件)/i.test(businessText);
  const relevantGoogleType = candidate.types.some((value) => /(?:^|_)(?:repair|wholesaler|supplier|manufacturer|distributor|importer|agency|contractor)(?:_|$)/i.test(value));
  const explicitlyIrrelevantType = candidate.types.some((value) => /^(?:hair_salon|hair_care|finance|courier_service|shipping_service|furniture_store|general_contractor|auto_parts_store|car_repair|restaurant|cafe|pharmacy|lodging|real_estate_agency)$/i.test(value));
  // Discovery is a recall-oriented gate. It may send an uncertain candidate to
  // evidence verification, but must never reject an obvious repair/supply lead
  // merely because Google returned a generic category or a plural/synonym.
  const requestedMatch = matchedDomainTerms.length > 0 && (hasSpecificDomainMatch || targetBusinessSignal || relevantGoogleType);
  return candidate.businessStatus !== "CLOSED_PERMANENTLY"
    && !(explicitlyIrrelevantType && !requestedMatch)
    && requestedMatch;
}
