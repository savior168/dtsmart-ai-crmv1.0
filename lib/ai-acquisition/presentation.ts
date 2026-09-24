export function acquisitionErrorMessageZh(message?: string | null) {
  const value = String(message || "").trim();
  if (!value) return "";
  if (/ACQUISITION_SCREENING_ITEMS_FAILED/i.test(value)) {
    const count = value.match(/:\s*(\d+)/)?.[1] || "部分";
    return `${count} 条候选因 AI 核验技术错误未完成，已完成的结果与检索检查点均已保留。可点击“重试失败项”，无需重新采集全部候选。`;
  }
  if (/google_place_id.*does not exist|42703/i.test(value)) {
    return "候选客户保存时检测到数据字段不一致，任务已安全停止。已完成的检索结果、检查点和费用记录均已保留，可修复后从检查点继续。";
  }
  if (/budget|费用|额度|limit/i.test(value)) {
    return "任务触发费用或额度边界后已安全停止，已完成的进度和调用记录均已保留。";
  }
  if (/57014|statement timeout|canceling statement due to statement timeout/i.test(value)) {
    return "此前因数据库查询超时中断。已完成客户、搜索检查点和费用记录均已保留；重试只会继续未完成项，修复后同类短暂超时将自动从检查点恢复。";
  }
  if (/workflow|fatalerror|failed after|acquisition_screening/i.test(value)) {
    return "任务执行异常，系统已保留完成进度和费用记录，可从检查点安全重试。";
  }
  return "任务执行异常，系统已安全停止并保留完成进度；可重试，若仍失败请联系管理员。";
}

export function acquisitionFailureStage(message?: string | null) {
  const value = String(message || "");
  if (/ACQUISITION_SCREENING_ITEMS_FAILED/i.test(value)) return "候选核验技术失败";
  if (/google_place_id.*does not exist|42703/i.test(value)) return "候选保存失败";
  if (/screening/i.test(value)) return "AI核验失败";
  if (/budget|费用|额度|limit/i.test(value)) return "费用边界停止";
  if (/57014|statement timeout|canceling statement due to statement timeout/i.test(value)) return "数据库查询超时";
  return "执行异常";
}
