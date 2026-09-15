import { countryInfo } from "@/lib/countries";

export const ACQUISITION_COUNTRIES = [
  "US","CA","GB","IE","DE","FR","ES","PT","IT","NL","BE","PL","CZ","RO","GR","NO","SE","DK","FI","AT","CH",
  "AU","NZ","AE","SA","TR","ZA","NG","KE","GH","TZ","UG","MA","EG","MX","BR","AR","CL","CO","PE","IN","ID","MY","SG","PH","TH","VN","JP","KR",
] as const;

export type AcquisitionCountry = (typeof ACQUISITION_COUNTRIES)[number];

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

export function localizedSearchTerms(country: AcquisitionCountry, industry: string, keywords: string[]) {
  const requested = [...new Set([industry, ...keywords].map((value) => value.trim()).filter(Boolean))].slice(0, 5);
  const translations = COMMON_LOCAL_TERMS[country] || {};
  return [...new Set(requested.flatMap((term) => {
    const translated = translations[term.toLowerCase()];
    return translated && translated.toLowerCase() !== term.toLowerCase() ? [translated, term] : [term];
  }))].slice(0, 6);
}
