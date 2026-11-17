import fs from "node:fs";
import readline from "node:readline";

// GeoNames alternate names, CC BY 4.0. Only non-historic names in the
// country's search language are used to match localized Places addresses.
const [citiesPath, adminPath, alternatePath] = process.argv.slice(2);
if (!citiesPath || !adminPath || !alternatePath) throw new Error("Usage: node scripts/generate-ai-acquisition-geography-local-aliases.mjs <cities5000.txt> <admin1CodesASCII.txt> <alternateNamesV2.txt>");
const registry = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-geography.json", import.meta.url), "utf8"));
const languages = { DE: "de", FR: "fr", ES: "es", PT: "pt", IT: "it", PL: "pl", NL: "nl", BR: "pt", TR: "tr" };
const targets = new Map();
for (const line of fs.readFileSync(adminPath, "utf8").split(/\r?\n/)) {
  const [key, , , id] = line.split("\t");
  const [country, code] = key?.split(".") || [];
  if (id && languages[country] && registry[country]?.some((region) => region.code === code)) targets.set(id, { kind: "region", country, code });
}
const bestCities = new Map();
for (const line of fs.readFileSync(citiesPath, "utf8").split(/\r?\n/)) {
  const columns = line.split("\t");
  const [id, name] = columns;
  const country = columns[8], code = columns[10];
  if (!id || !languages[country] || !registry[country]?.some((region) => region.code === code && region.cities.includes(name))) continue;
  const key = `${country}\n${code}\n${name}`;
  const population = Number(columns[14]) || 0;
  if (!bestCities.has(key) || population > bestCities.get(key).population) bestCities.set(key, { id, population, country, code, name });
}
for (const value of bestCities.values()) targets.set(value.id, { kind: "city", country: value.country, code: value.code, name: value.name });
const aliases = new Map();
const input = readline.createInterface({ input: fs.createReadStream(alternatePath, { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of input) {
  const fields = line.split("\t");
  const id = fields[1], locale = fields[2], name = fields[3]?.trim();
  const target = targets.get(id);
  if (!target || locale !== languages[target.country] || !name || fields[6] === "1" || fields[7] === "1" || fields[9]) continue;
  const current = aliases.get(id);
  if (!current || (fields[4] === "1" && !current.preferred)) aliases.set(id, { name, preferred: fields[4] === "1" });
}
const output = { regions: {}, cities: {} };
for (const [id, target] of targets) {
  const name = aliases.get(id)?.name;
  if (!name) continue;
  if (target.kind === "region") (output.regions[target.country] ||= {})[target.code] = name;
  else ((output.cities[target.country] ||= {})[target.code] ||= {})[target.name] = name;
}
fs.writeFileSync(new URL("../data/ai-acquisition-geography-local-aliases.json", import.meta.url), `${JSON.stringify(output)}\n`);
console.log(`Localized GeoNames aliases: ${Object.values(output.regions).reduce((n, entries) => n + Object.keys(entries).length, 0)} regions, ${Object.values(output.cities).reduce((n, regions) => n + Object.values(regions).reduce((m, entries) => m + Object.keys(entries).length, 0), 0)} cities`);
