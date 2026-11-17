import fs from "node:fs";

// Unicode CLDR subdivision names (Unicode-3.0):
// https://github.com/unicode-org/cldr/tree/main/common/subdivisions
// Match only an unambiguous English name in the same country. The local
// GeoNames name remains the canonical query and address-matching key.
const [englishPath, chinesePath] = process.argv.slice(2);
if (!englishPath || !chinesePath) throw new Error("Usage: node scripts/augment-ai-acquisition-geography-cldr-zh.mjs <en.xml> <zh.xml>");
const geographyUrl = new URL("../data/ai-acquisition-geography.json", import.meta.url);
const labelsUrl = new URL("../data/ai-acquisition-geography-zh.json", import.meta.url);
const geography = JSON.parse(fs.readFileSync(geographyUrl, "utf8"));
const labels = JSON.parse(fs.readFileSync(labelsUrl, "utf8"));
function subdivisions(path) {
  const entries = new Map();
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.includes("deprecated")) continue;
    const match = line.match(/<subdivision type="([a-z0-9]+)"[^>]*>([^<]+)<\/subdivision>/);
    if (match) entries.set(match[1], match[2].replaceAll("&amp;", "&").trim());
  }
  return entries;
}
const english = subdivisions(englishPath);
const chinese = subdivisions(chinesePath);
const keyFor = (name) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const byCountry = new Map();
for (const [code, name] of english) {
  if (!chinese.has(code) || !/\p{Script=Han}/u.test(chinese.get(code))) continue;
  const country = code.slice(0, 2).toUpperCase();
  const key = `${country}\n${keyFor(name)}`;
  const candidates = byCountry.get(key) || [];
  candidates.push(chinese.get(code));
  byCountry.set(key, candidates);
}
let added = 0;
for (const [country, regions] of Object.entries(geography)) {
  for (const region of regions) {
    if (labels.regions[country]?.[region.code]) continue;
    const key = `${country}\n${keyFor(region.name.replace(/^State of /i, ""))}`;
    const matches = byCountry.get(key) || [];
    if (matches.length !== 1) continue;
    (labels.regions[country] ||= {})[region.code] = matches[0];
    added += 1;
  }
}
fs.writeFileSync(labelsUrl, `${JSON.stringify(labels)}\n`);
console.log(`Added ${added} unambiguous Unicode CLDR Chinese region labels`);
