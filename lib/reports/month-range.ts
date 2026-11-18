export function monthRange(year: number, startMonth: number, endMonth: number) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100
    || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12
    || !Number.isInteger(endMonth) || endMonth < startMonth || endMonth > 12) {
    throw new Error("请选择有效的年份和月份范围");
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return { from: `${year}-${pad(startMonth)}-01`, to: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}
