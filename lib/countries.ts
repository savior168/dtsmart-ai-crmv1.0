const aliases: Record<string, string> = {
  美国: "US", USA: "US", "UNITED STATES": "US", 中国: "CN", CHINA: "CN",
  印度: "IN", INDIA: "IN", 巴西: "BR", BRAZIL: "BR", 英国: "GB", UK: "GB", "UNITED KINGDOM": "GB",
  墨西哥: "MX", MEXICO: "MX", 俄罗斯: "RU", RUSSIA: "RU", 西班牙: "ES", SPAIN: "ES",
  阿联酋: "AE", UAE: "AE", "UNITED ARAB EMIRATES": "AE", 德国: "DE", GERMANY: "DE", 法国: "FR", FRANCE: "FR",
  意大利: "IT", ITALY: "IT", 爱尔兰: "IE", IRELAND: "IE", 挪威: "NO", NORWAY: "NO", 厄瓜多尔: "EC", ECUADOR: "EC",
  澳大利亚: "AU", AUSTRALIA: "AU", 加拿大: "CA", CANADA: "CA", 日本: "JP", JAPAN: "JP", 韩国: "KR", "SOUTH KOREA": "KR",
};
const displayNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const englishDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const isoCodes = Array.from({ length: 26 * 26 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)),
).filter((code) => displayNames.of(code) !== code);
const namesToCode = new Map<string, string>();
for (const code of isoCodes) {
  const chinese = displayNames.of(code);
  const english = englishDisplayNames.of(code);
  if (chinese) namesToCode.set(chinese.toUpperCase(), code);
  if (english) namesToCode.set(english.toUpperCase(), code);
}
Object.entries(aliases).forEach(([name, code]) => namesToCode.set(name.toUpperCase(), code));
export function countryInfo(value?: string | null) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  const prefixCode = upper.match(/^([A-Z]{2})(?=\s|[-/]|[\u4e00-\u9fff]|$)/)?.[1] || "";
  const directAlias = namesToCode.get(upper);
  const normalizedPrefix = prefixCode ? namesToCode.get(prefixCode) || prefixCode : "";
  const code = directAlias || (/^[A-Z]{2}$/.test(upper) ? upper : normalizedPrefix);
  return { code, name: code ? displayNames.of(code) || raw : raw || "未知地区" };
}
export function countrySearchTokens(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const info = countryInfo(raw);
  return Array.from(new Set([raw, info.code, info.name].filter(Boolean)));
}
