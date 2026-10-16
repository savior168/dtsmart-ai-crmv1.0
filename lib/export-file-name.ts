/** A stable, filesystem-safe timestamp in the team's business timezone. */
export function exportTimestamp(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const value = (key: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === key)?.value || "00";
  return `${value("year")}${value("month")}${value("day")}-${value("hour")}${value("minute")}${value("second")}`;
}

function safePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, "_").slice(0, 100) || "未编号";
}

export function documentExportFilename(number: string, category: "PI订单" | "备货单" | "报价单", extension: "xlsx" | "pdf", at = new Date()) {
  return `${safePart(number)}_${category}_${exportTimestamp(at)}.${extension}`;
}

export function batchExportFilename(category: "PI订单" | "备货单", extension: "zip" | "pdf", at = new Date()) {
  return `${category}_批量_${exportTimestamp(at)}.${extension}`;
}

export function dataExportFilename(category: string, extension: "xlsx" | "zip" = "xlsx", at = new Date()) {
  return `${safePart(category)}_${exportTimestamp(at)}.${extension}`;
}

export function customerExportFilename(category: string, at = new Date()) {
  return dataExportFilename(category, "xlsx", at);
}
