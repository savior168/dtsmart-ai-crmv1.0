import { countryInfo } from "@/lib/countries";

export const ACQUISITION_COUNTRIES = [
  "US","CA","GB","IE","DE","FR","ES","PT","IT","NL","BE","PL","CZ","RO","GR","NO","SE","DK","FI","AT","CH",
  "AU","NZ","AE","SA","TR","ZA","NG","KE","GH","TZ","UG","MA","EG","MX","BR","AR","CL","CO","PE","IN","ID","MY","SG","PH","TH","VN","JP","KR",
] as const;

export type AcquisitionCountry = (typeof ACQUISITION_COUNTRIES)[number];

export const ACQUISITION_INDUSTRY_TERMS: Record<string, string> = {
  "手机维修店": "mobile phone repair",
  "手机配件批发商": "phone parts wholesale",
  "手机配件零售商": "mobile phone accessories store",
  "手机进口商": "mobile phone importer",
  "电脑维修店": "computer repair",
  "电脑配件批发商": "computer parts wholesale",
};

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
  const requested = industryTerms.flatMap((term) => {
    const translated = translations[term.toLowerCase()];
    const bases = translated && translated.toLowerCase() !== term.toLowerCase() ? [translated, term] : [term];
    if (!normalizedKeywords.length) return bases;
    // Keywords may refine a selected industry, but must never become a
    // standalone broad search that escapes the user's target industry.
    return [...bases, ...bases.flatMap((base) => normalizedKeywords.map((keyword) => `${base} ${keyword}`))];
  });
  return [...new Set(requested)].slice(0, 24);
}
