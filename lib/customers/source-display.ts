const labels: Record<string, string> = {
  EXCEL_IMPORT: "Excel导入", BATCH_IMPORT: "Excel导入", MANUAL: "手动新增",
  MANUAL_CREATE: "手动新增", ADMIN_MANUAL: "手动新增", AI_ACQUISITION: "AI获客",
  GOOGLE_MAPS: "AI获客", FACEBOOK: "AI获客", INSTAGRAM: "AI获客", LINKEDIN: "AI获客",
};

export function customerSourceLabel(value?: unknown) {
  const source = String(value || "").trim();
  return labels[source.toUpperCase()] || source || "未知来源";
}
