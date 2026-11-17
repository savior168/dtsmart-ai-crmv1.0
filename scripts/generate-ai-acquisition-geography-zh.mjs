import fs from "node:fs";
import readline from "node:readline";

// GeoNames CC BY 4.0: https://download.geonames.org/export/dump/readme.txt
// Only attested Chinese alternate names are emitted. Original names remain the
// canonical search/address-matching values; translations are display-only.
const [citiesPath, adminPath, alternatePath] = process.argv.slice(2);
if (!citiesPath || !adminPath || !alternatePath) throw new Error("Usage: node scripts/generate-ai-acquisition-geography-zh.mjs <cities5000.txt> <admin1CodesASCII.txt> <alternateNamesV2.txt>");
const registry = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-geography.json", import.meta.url), "utf8"));
const targets = new Map();
for (const line of fs.readFileSync(adminPath, "utf8").split(/\r?\n/)) {
  const [key, , , id] = line.split("\t");
  const [country, code] = key?.split(".") || [];
  if (id && registry[country]?.some((region) => region.code === code)) targets.set(id, { kind: "region", country, code });
}
const bestCity = new Map();
for (const line of fs.readFileSync(citiesPath, "utf8").split(/\r?\n/)) {
  const columns = line.split("\t");
  const [id, name] = columns;
  const country = columns[8], code = columns[10];
  if (!id || !registry[country]?.some((region) => region.code === code && region.cities.includes(name))) continue;
  const key = `${country}\n${code}\n${name}`;
  const population = Number(columns[14]) || 0;
  if (!bestCity.has(key) || population > bestCity.get(key).population) bestCity.set(key, { id, population, country, code, name });
}
for (const value of bestCity.values()) targets.set(value.id, { kind: "city", country: value.country, code: value.code, name: value.name });
const translations = new Map();
const input = readline.createInterface({ input: fs.createReadStream(alternatePath, { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of input) {
  const fields = line.split("\t");
  const id = fields[1], locale = fields[2], name = fields[3]?.trim();
  if (!targets.has(id) || !name || !/\p{Script=Han}/u.test(name) || fields[6] === "1" || fields[7] === "1" || fields[9]) continue;
  const priority = { "zh-CN": 5, "zh-Hans": 4, zh: 3, "zh-TW": 2, "zh-Hant": 1 }[locale];
  if (!priority) continue;
  const score = priority * 10 + (fields[4] === "1" ? 2 : 0);
  if (!translations.has(id) || score > translations.get(id).score) translations.set(id, { name, score });
}
const output = { regions: {}, cities: {} };
for (const [id, target] of targets) {
  const zh = translations.get(id)?.name;
  if (!zh) continue;
  if (target.kind === "region") {
    (output.regions[target.country] ||= {})[target.code] = zh;
  } else {
    ((output.cities[target.country] ||= {})[target.code] ||= {})[target.name] = zh;
  }
}
fs.writeFileSync(new URL("../data/ai-acquisition-geography-zh.json", import.meta.url), `${JSON.stringify(output)}\n`);
const regionCount = Object.values(output.regions).reduce((sum, regions) => sum + Object.keys(regions).length, 0);
const cityCount = Object.values(output.cities).reduce((sum, regions) => sum + Object.values(regions).reduce((total, cities) => total + Object.keys(cities).length, 0), 0);
console.log(`Attested Chinese GeoNames labels: ${regionCount} regions, ${cityCount} cities`);
