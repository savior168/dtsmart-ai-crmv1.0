import fs from "node:fs";
import path from "node:path";

// Offline build input: extracted cities5000.txt and admin1CodesASCII.txt,
// supplied as argv[2] and argv[3]. Download from
// https://download.geonames.org/export/dump/ before regeneration.
// GeoNames data is CC BY 4.0: https://download.geonames.org/export/dump/readme.txt
const root = path.resolve(import.meta.dirname, "..");
const [citiesPath, adminPath] = process.argv.slice(2);
if (!citiesPath || !adminPath) throw new Error("Usage: node scripts/generate-ai-acquisition-geography.mjs <cities5000.txt> <admin1CodesASCII.txt>");
const countriesSource = fs.readFileSync(path.join(root, "lib/ai-acquisition/config.ts"), "utf8");
const codes = [...countriesSource.matchAll(/^  (?:AFRICA|ANTARCTICA|ASIA|EUROPE|NORTH_AMERICA|OCEANIA|SOUTH_AMERICA): "([A-Z,]+)"/gm)]
  .flatMap((match) => match[1].split(","));
if (codes.length !== 249 || new Set(codes).size !== codes.length) throw new Error("Country registry is incomplete or duplicated");
const supported = new Set(codes);
const adminNames = new Map();
for (const row of fs.readFileSync(adminPath, "utf8").split(/\r?\n/)) {
  const [key, name] = row.split("\t");
  if (key && name) adminNames.set(key, name);
}
const byCountry = new Map();
for (const row of fs.readFileSync(citiesPath, "utf8").split(/\r?\n/)) {
  if (!row) continue;
  const columns = row.split("\t");
  const country = columns[8];
  if (!supported.has(country)) continue;
  const regionCode = columns[10] || "00";
  const regionName = adminNames.get(`${country}.${regionCode}`) || "";
  const name = columns[1]?.trim();
  const population = Number(columns[14]) || 0;
  if (!name || name.length > 100 || !regionName || regionCode === "00") continue;
  let regions = byCountry.get(country);
  if (!regions) { regions = new Map(); byCountry.set(country, regions); }
  let cities = regions.get(regionCode);
  if (!cities) { cities = new Map(); regions.set(regionCode, cities); }
  const old = cities.get(name);
  if (old == null || population > old) cities.set(name, population);
}
const output = {};
const defaultAreas = {};
for (const country of [...supported].sort()) {
  const regions = byCountry.get(country) || new Map();
  defaultAreas[country] = [...regions].flatMap(([code, cities]) => [...cities].map(([city, population]) => ({ city, population, region: adminNames.get(`${country}.${code}`) })))
    .sort((a, b) => b.population - a.population || a.city.localeCompare(b.city))
    .slice(0, 12)
    .map(({ city, region }) => `${city}, ${region}`);
  output[country] = [...regions].map(([code, cities]) => ({
    code,
    name: adminNames.get(`${country}.${code}`),
    cities: [...cities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([city]) => city),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data/ai-acquisition-geography.json"), `${JSON.stringify(output)}\n`);
fs.writeFileSync(path.join(root, "data/ai-acquisition-default-areas.json"), `${JSON.stringify(defaultAreas)}\n`);
const regionCount = Object.values(output).reduce((sum, regions) => sum + regions.length, 0);
const cityCount = Object.values(output).reduce((sum, regions) => sum + regions.reduce((total, region) => total + region.cities.length, 0), 0);
console.log(`GeoNames regions: ${regionCount}, cities: ${cityCount}, countries with regions: ${byCountry.size}/${supported.size}`);
