import { countryInfo } from "@/lib/countries";

export const ACQUISITION_COUNTRIES = [
  "US","CA","GB","IE","DE","FR","ES","PT","IT","NL","BE","PL","CZ","RO","GR","NO","SE","DK","FI","AT","CH",
  "AU","NZ","AE","SA","TR","ZA","NG","KE","GH","TZ","UG","MA","EG","MX","BR","AR","CL","CO","PE","IN","ID","MY","SG","PH","TH","VN","JP","KR",
] as const;

export type AcquisitionCountry = (typeof ACQUISITION_COUNTRIES)[number];
export const ACQUISITION_COUNTRY_GROUPS = [
  { key: "EUROPE", label: "欧洲", countries: ["GB","IE","DE","FR","ES","PT","IT","NL","BE","PL","CZ","RO","GR","NO","SE","DK","FI","AT","CH"] },
  { key: "ASIA", label: "亚洲", countries: ["AE","SA","TR","IN","ID","MY","SG","PH","TH","VN","JP","KR"] },
  { key: "AFRICA", label: "非洲", countries: ["ZA","NG","KE","GH","TZ","UG","MA","EG"] },
  { key: "NORTH_AMERICA", label: "北美洲", countries: ["US","CA","MX"] },
  { key: "SOUTH_AMERICA", label: "南美洲", countries: ["BR","AR","CL","CO","PE"] },
  { key: "OCEANIA", label: "大洋洲", countries: ["AU","NZ"] },
] as const satisfies ReadonlyArray<{key:string;label:string;countries:ReadonlyArray<AcquisitionCountry>}>;
export const MAX_ACQUISITION_INDUSTRIES = 20;
export const MAX_ACQUISITION_KEYWORDS = 30;
export const MAX_ACQUISITION_SEARCH_TERMS = 80;
export const DEFAULT_ACQUISITION_DISCOVERY_CEILING = 50000;
export const ACQUISITION_FRESH_SEARCH_SCOPES_PER_COUNTRY = 1000;

// Google Text Search exposes only a small number of pages for one broad query.
// Geographic shards let later tasks keep expanding coverage instead of paying
// for the same country-wide result set. Keep these as recognizable market
// centres/regions rather than postal-code guesses so queries remain auditable.
export const ACQUISITION_COUNTRY_SEARCH_AREAS: Partial<Record<AcquisitionCountry, readonly string[]>> = {
  US: ["New York NY","Los Angeles CA","Chicago IL","Houston TX","Phoenix AZ","Philadelphia PA","San Antonio TX","San Diego CA","Dallas TX","San Jose CA","Miami FL","Atlanta GA","Boston MA","Seattle WA","Denver CO","Detroit MI","Minneapolis MN","Portland OR","Las Vegas NV","Orlando FL"],
  CA: ["Toronto ON","Montreal QC","Vancouver BC","Calgary AB","Edmonton AB","Ottawa ON","Winnipeg MB","Quebec City QC","Hamilton ON","Halifax NS"],
  GB: ["London","Birmingham","Manchester","Leeds","Glasgow","Liverpool","Bristol","Sheffield","Edinburgh","Leicester","Nottingham","Newcastle upon Tyne","Cardiff","Belfast","Coventry","Bradford","Stoke-on-Trent","Southampton","Reading","Aberdeen"],
  IE: ["Dublin","Cork","Limerick","Galway","Waterford","Drogheda","Dundalk","Swords"],
  DE: ["Berlin","Hamburg","Munich","Cologne","Frankfurt","Stuttgart","Dusseldorf","Leipzig","Dortmund","Essen","Bremen","Dresden"],
  FR: ["Paris","Marseille","Lyon","Toulouse","Nice","Nantes","Montpellier","Strasbourg","Bordeaux","Lille","Rennes","Grenoble"],
  ES: ["Madrid","Barcelona","Valencia","Seville","Zaragoza","Malaga","Murcia","Palma","Bilbao","Alicante"],
  PT: ["Lisbon","Porto","Braga","Coimbra","Setubal","Faro","Aveiro","Leiria"],
  IT: ["Rome","Milan","Naples","Turin","Palermo","Genoa","Bologna","Florence","Bari","Catania","Venice","Verona"],
  NL: ["Amsterdam","Rotterdam","The Hague","Utrecht","Eindhoven","Tilburg","Groningen","Almere"],
  BE: ["Brussels","Antwerp","Ghent","Charleroi","Liege","Bruges","Leuven"],
  PL: ["Warsaw","Krakow","Lodz","Wroclaw","Poznan","Gdansk","Szczecin","Katowice","Lublin"],
  CZ: ["Prague","Brno","Ostrava","Plzen","Liberec","Olomouc"],
  RO: ["Bucharest","Cluj-Napoca","Timisoara","Iasi","Constanta","Brasov","Craiova"],
  GR: ["Athens","Thessaloniki","Patras","Heraklion","Larissa","Volos"],
  NO: ["Oslo","Bergen","Trondheim","Stavanger","Drammen","Kristiansand"],
  SE: ["Stockholm","Gothenburg","Malmo","Uppsala","Vasteras","Orebro"],
  DK: ["Copenhagen","Aarhus","Odense","Aalborg","Esbjerg","Randers"],
  FI: ["Helsinki","Espoo","Tampere","Vantaa","Oulu","Turku"],
  AT: ["Vienna","Graz","Linz","Salzburg","Innsbruck","Klagenfurt"],
  CH: ["Zurich","Geneva","Basel","Lausanne","Bern","Winterthur","Lucerne"],
  AU: ["Sydney NSW","Melbourne VIC","Brisbane QLD","Perth WA","Adelaide SA","Gold Coast QLD","Newcastle NSW","Canberra ACT","Wollongong NSW","Geelong VIC"],
  NZ: ["Auckland","Christchurch","Wellington","Hamilton","Tauranga","Dunedin","Palmerston North"],
  AE: ["Dubai","Abu Dhabi","Sharjah","Ajman","Al Ain","Ras Al Khaimah"],
  SA: ["Riyadh","Jeddah","Mecca","Medina","Dammam","Khobar","Taif"],
  TR: ["Istanbul","Ankara","Izmir","Bursa","Antalya","Adana","Konya","Gaziantep"],
  ZA: ["Johannesburg","Cape Town","Durban","Pretoria","Gqeberha","Bloemfontein","East London"],
  NG: ["Lagos","Abuja","Kano","Ibadan","Port Harcourt","Benin City","Kaduna"],
  KE: ["Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Thika"],
  GH: ["Accra","Kumasi","Tema","Takoradi","Tamale","Cape Coast"],
  TZ: ["Dar es Salaam","Dodoma","Mwanza","Arusha","Mbeya","Morogoro"],
  UG: ["Kampala","Entebbe","Jinja","Mbarara","Gulu","Mbale"],
  MA: ["Casablanca","Rabat","Marrakesh","Fes","Tangier","Agadir","Meknes"],
  EG: ["Cairo","Alexandria","Giza","Mansoura","Tanta","Suez","Asyut"],
  MX: ["Mexico City","Guadalajara","Monterrey","Puebla","Tijuana","Leon","Merida","Queretaro","Toluca"],
  BR: ["Sao Paulo","Rio de Janeiro","Brasilia","Salvador","Fortaleza","Belo Horizonte","Manaus","Curitiba","Recife","Porto Alegre"],
  AR: ["Buenos Aires","Cordoba","Rosario","Mendoza","La Plata","Tucuman","Mar del Plata"],
  CL: ["Santiago","Valparaiso","Concepcion","Antofagasta","Vina del Mar","Temuco"],
  CO: ["Bogota","Medellin","Cali","Barranquilla","Cartagena","Bucaramanga","Pereira"],
  PE: ["Lima","Arequipa","Trujillo","Chiclayo","Piura","Cusco","Huancayo"],
  IN: ["Delhi","Mumbai","Bengaluru","Hyderabad","Chennai","Kolkata","Pune","Ahmedabad","Jaipur","Surat","Lucknow","Kochi"],
  ID: ["Jakarta","Surabaya","Bandung","Medan","Semarang","Makassar","Palembang","Denpasar"],
  MY: ["Kuala Lumpur","George Town","Johor Bahru","Ipoh","Shah Alam","Kota Kinabalu","Kuching"],
  SG: ["Central Singapore","Jurong","Tampines","Woodlands","Punggol"],
  PH: ["Metro Manila","Cebu City","Davao City","Quezon City","Cagayan de Oro","Iloilo City","Baguio"],
  TH: ["Bangkok","Chiang Mai","Pattaya","Phuket","Khon Kaen","Hat Yai","Nakhon Ratchasima"],
  VN: ["Ho Chi Minh City","Hanoi","Da Nang","Hai Phong","Can Tho","Bien Hoa","Nha Trang"],
  JP: ["Tokyo","Osaka","Yokohama","Nagoya","Sapporo","Fukuoka","Kobe","Kyoto","Sendai","Hiroshima"],
  KR: ["Seoul","Busan","Incheon","Daegu","Daejeon","Gwangju","Suwon","Ulsan"],
};

export const ACQUISITION_INDUSTRY_TERMS: Record<string, string> = {
  "手机维修店": "mobile phone repair",
  "手机维修连锁店": "mobile phone repair chain",
  "Apple设备维修店": "Apple device repair service",
  "手机配件批发商": "mobile phone repair replacement parts wholesale",
  "手机内配件经销商": "mobile phone replacement parts distributor",
  "手机配件零售商": "mobile phone repair replacement parts retailer",
  "手机进口商": "mobile phone repair replacement parts importer",
  "手机翻新商": "mobile phone refurbisher",
  "二手手机整备商": "used phone refurbishment company",
  "电脑维修店": "computer repair",
  "笔记本电脑维修店": "laptop repair service",
  "电脑配件批发商": "computer parts wholesale",
  "笔记本配件经销商": "laptop replacement parts distributor",
  "电子设备维修服务商": "electronics repair service",
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
  "手机维修连锁店",
  "Apple设备维修店",
  "手机配件批发商",
  "手机内配件经销商",
  "电脑维修店",
  "笔记本电脑维修店",
  "电脑配件批发商",
  "笔记本配件经销商",
  "电子设备维修服务商",
] as const;

// 成品手机、翻新整机和普通外配件商家并不是维修配件业务的目标客户。
// 保留旧标签映射仅用于兼容历史任务，但不得继续作为系统推荐行业。
const NON_TARGET_RECOMMENDED_INDUSTRIES = new Set([
  "手机配件零售商",
  "手机进口商",
  "手机翻新商",
  "二手手机整备商",
]);

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
    .filter(([label]) => !NON_TARGET_RECOMMENDED_INDUSTRIES.has(label))
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
  "手机维修连锁店": ["multiple locations", "screen repair", "battery replacement", "repair center"],
  "Apple设备维修店": ["iPhone repair", "iPad repair", "MacBook repair", "Apple parts"],
  "手机配件批发商": ["phone LCD wholesale", "phone replacement batteries wholesale", "charging port supplier", "repair parts B2B"],
  "手机内配件经销商": ["LCD screens", "batteries", "charging ports", "replacement parts"],
  "手机配件零售商": ["phone repair parts store", "phone LCD retailer", "replacement battery retailer", "charging port parts"],
  "手机进口商": ["phone repair parts importer", "phone LCD importer", "replacement battery distributor", "repair parts B2B"],
  "手机翻新商": ["device refurbishment workshop", "board repair", "screen replacement", "battery replacement"],
  "二手手机整备商": ["phone refurbishment workshop", "device repair center", "screen replacement", "battery replacement"],
  "电脑维修店": ["laptop repair", "hardware repair", "motherboard repair", "computer parts"],
  "笔记本电脑维修店": ["laptop screen repair", "keyboard replacement", "battery replacement", "motherboard repair"],
  "电脑配件批发商": ["laptop parts", "replacement parts", "spare parts", "B2B supplier"],
  "笔记本配件经销商": ["laptop screens", "laptop batteries", "keyboards", "replacement parts"],
  "电子设备维修服务商": ["electronics repair", "board repair", "component replacement", "repair center"],
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
  return [...new Set(acquisitionKeywordRecommendationGroups(industries).flatMap((group) => group.keywords))].slice(0, MAX_ACQUISITION_KEYWORDS);
}


export function acquisitionKeywordRecommendationGroups(industries: string[]) {
  return industries.map((industry) => {
    const exact = INDUSTRY_KEYWORD_RECOMMENDATIONS[industry];
    const keywords = exact || ROLE_KEYWORD_RECOMMENDATIONS.find(([pattern]) => pattern.test(industry))?.[1] || [];
    return { industry, keywords: [...new Set(keywords)] };
  }).filter((group) => group.keywords.length > 0);
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
  const knownKeywordOwners = new Map<string, Set<string>>();
  for (const [industry, recommendations] of Object.entries(INDUSTRY_KEYWORD_RECOMMENDATIONS)) {
    for (const keyword of recommendations) {
      const normalized = keyword.trim().toLowerCase();
      if (!knownKeywordOwners.has(normalized)) knownKeywordOwners.set(normalized, new Set());
      knownKeywordOwners.get(normalized)?.add(industry);
    }
  }
  const groups = industryTerms.map((term, index) => {
    const translated = translations[term.toLowerCase()];
    const bases = translated && translated.toLowerCase() !== term.toLowerCase() ? [translated, term] : [term];
    const industry = industries[index];
    const applicableKeywords = normalizedKeywords.filter((keyword) => {
      const owners = knownKeywordOwners.get(keyword.toLowerCase());
      return !owners?.size || !INDUSTRY_KEYWORD_RECOMMENDATIONS[industry] || owners.has(industry);
    });
    if (!applicableKeywords.length) return bases;
    // Keywords may refine a selected industry, but must never become a
    // standalone broad search that escapes the user's target industry. Known
    // recommendation keywords are paired only with their owning industries;
    // genuinely custom keywords remain available to every selected industry.
    return [...bases, ...bases.flatMap((base) => applicableKeywords.map((keyword) => `${base} ${keyword}`))];
  });
  const requested: string[] = [];
  for (let round = 0; requested.length < MAX_ACQUISITION_SEARCH_TERMS; round += 1) {
    let added = false;
    for (const group of groups) if (group[round]) { requested.push(group[round]); added = true; }
    if (!added) break;
  }
  return [...new Set(requested)].slice(0, MAX_ACQUISITION_SEARCH_TERMS);
}
