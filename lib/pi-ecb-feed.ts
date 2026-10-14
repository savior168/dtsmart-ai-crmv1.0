export function parseEcbFeed(xml: string, now = Date.now()) {
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const perEuro: Record<string, number> = { EUR: 1 };
  for (const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g)) {
    const rate = Number(match[2]);
    if (Number.isFinite(rate) && rate > 0) perEuro[match[1]] = rate;
  }
  if (!date || !perEuro.CNY || !perEuro.USD) throw new Error("欧洲央行参考汇率数据不完整");
  const ageDays = (now - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays < -1 || ageDays > 7) throw new Error("欧洲央行参考汇率已过期");
  return { date, perEuro };
}
