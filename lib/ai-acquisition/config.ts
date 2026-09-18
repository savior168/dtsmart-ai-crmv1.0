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
  "汽车配件批发商",
  "机械设备经销商",
  "建材批发商",
  "服装批发商",
  "医疗器械经销商",
  "食品饮料批发商",
  "包装材料供应商",
  "物流货运服务商",
  "酒店用品供应商",
  "软件服务公司",
] as const;

function industryFeatures(value: string) {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const features = new Set(normalized.split(/\s+/).filter(Boolean));
  const compactHan = normalized.replace(/[^\p{Script=Han}]/gu, "");
  for (let index = 0; index < compactHan.length - 1; index += 1) features.add(compactHan.slice(index, index + 2));
  return features;
}

const ACQUISITION_INDUSTRY_GROUPS = [
  { aliases: ["电子", "消费电子", "数码", "electronics"], industries: ["消费电子批发商", "电子元器件经销商", "电子设备维修服务商", "手机维修店", "手机维修连锁店", "Apple设备维修店", "手机配件批发商", "手机内配件经销商", "电脑维修店", "笔记本电脑维修店", "电脑配件批发商", "笔记本配件经销商", "家电维修服务商"] },
  { aliases: ["汽车", "汽配", "automotive", "auto parts"], industries: ["汽车配件批发商", "汽车维修服务商"] },
  { aliases: ["工业", "机械", "设备", "industrial", "machinery"], industries: ["机械设备经销商", "工业设备维修商", "五金工具经销商", "实验室设备供应商"] },
  { aliases: ["建筑", "建材", "五金", "construction", "building"], industries: ["建材批发商", "五金工具经销商", "照明产品批发商", "安防设备经销商"] },
  { aliases: ["服装", "鞋服", "时尚", "fashion", "apparel"], industries: ["服装批发商", "鞋类批发商", "珠宝首饰批发商"] },
  { aliases: ["医疗", "医药", "实验室", "medical", "laboratory"], industries: ["医疗器械经销商", "实验室设备供应商"] },
  { aliases: ["食品", "饮料", "农业", "农产品", "food", "agricultural"], industries: ["食品饮料批发商", "农产品进口商", "餐饮设备供应商"] },
  { aliases: ["包装", "印刷", "packaging", "printing"], industries: ["包装材料供应商", "印刷服务商", "塑料制品批发商", "橡胶制品供应商"] },
  { aliases: ["物流", "货运", "仓储", "logistics", "freight"], industries: ["物流货运服务商", "仓储服务商"] },
  { aliases: ["酒店", "餐饮", "办公", "hospitality", "restaurant"], industries: ["酒店用品供应商", "餐饮设备供应商", "办公用品批发商", "家具批发商"] },
  { aliases: ["能源", "光伏", "照明", "solar", "energy"], industries: ["光伏设备经销商", "照明产品批发商", "安防设备经销商"] },
  { aliases: ["化工", "塑料", "橡胶", "材料", "chemical", "materials"], industries: ["化工产品经销商", "塑料制品批发商", "橡胶制品供应商", "包装材料供应商"] },
  { aliases: ["软件", "信息技术", "互联网", "数字营销", "software", "IT service"], industries: ["软件服务公司", "信息技术服务商", "广告营销服务商", "跨境电商卖家"] },
] as const;

export function acquisitionIndustrySuggestions(query: string, limit = 8) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];
  const queryFeatures = industryFeatures(normalized);
  const categoryMatches = ACQUISITION_INDUSTRY_GROUPS
    .filter((group)=>group.aliases.some((alias)=>normalized.includes(alias.toLowerCase())||alias.toLowerCase().includes(normalized)))
    .flatMap((group)=>group.industries);
  const similarityMatches = Object.entries(ACQUISITION_INDUSTRY_TERMS)
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
    .map((item) => item.label);
  return [...new Set([...categoryMatches,...similarityMatches])].slice(0,limit);
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
  [/批发|wholesale/i, ["wholesaler", "B2B wholesale", "bulk supplier"]],
  [/进口|import/i, ["importer", "import distributor", "B2B importer"]],
  [/经销|distribut/i, ["distributor", "authorized distributor", "B2B distributor"]],
  [/供应|supplier/i, ["supplier", "B2B supplier", "commercial supplier"]],
  [/零售|retail|商店|store/i, ["retailer", "retail store", "specialist shop"]],
  [/维修|repair/i, ["repair service", "repair centre", "maintenance service"]],
  [/服务|service/i, ["service provider", "commercial service", "business service"]],
];

export function acquisitionKeywordRecommendations(industries: string[]) {
  return [...new Set(acquisitionKeywordRecommendationGroups(industries).flatMap((group) => group.keywords))].slice(0, MAX_ACQUISITION_KEYWORDS);
}


export function acquisitionKeywordRecommendationGroups(industries: string[]) {
  return industries.map((industry) => {
    const exact = INDUSTRY_KEYWORD_RECOMMENDATIONS[industry];
    const searchTerm = ACQUISITION_INDUSTRY_TERMS[industry] || industry;
    const roleKeywords = ROLE_KEYWORD_RECOMMENDATIONS.find(([pattern]) => pattern.test(`${industry} ${searchTerm}`))?.[1] || [];
    const keywords = exact || [searchTerm, ...roleKeywords.map((role)=>`${searchTerm} ${role}`)];
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
  for (const group of acquisitionKeywordRecommendationGroups(industries)) {
    for (const keyword of group.keywords) {
      const normalized = keyword.trim().toLowerCase();
      if (!knownKeywordOwners.has(normalized)) knownKeywordOwners.set(normalized, new Set());
      knownKeywordOwners.get(normalized)?.add(group.industry);
    }
  }
  const groups = industryTerms.map((term, index) => {
    const translated = translations[term.toLowerCase()];
    const bases = translated && translated.toLowerCase() !== term.toLowerCase() ? [translated, term] : [term];
    const industry = industries[index];
    const applicableKeywords = normalizedKeywords.filter((keyword) => {
      const owners = knownKeywordOwners.get(keyword.toLowerCase());
      return !owners?.size || owners.has(industry);
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
