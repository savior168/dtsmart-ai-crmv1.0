export function acquisitionErrorMessageZh(message?: string | null) {
  const value = String(message || "").trim();
  if (!value) return "";
  if (/google_place_id.*does not exist|42703/i.test(value)) {
    return "候选客户保存时检测到数据字段不一致，任务已安全停止。已完成的检索结果、检查点和费用记录均已保留，可修复后从检查点继续。";
  }
  if (/budget|费用|额度|limit/i.test(value)) {
    return "任务触发费用或额度边界后已安全停止，已完成的进度和调用记录均已保留。";
  }
  if (/workflow|fatalerror|failed after|acquisition_screening/i.test(value)) {
    return "任务执行异常，系统已保留完成进度和费用记录，可从检查点安全重试。";
  }
  return "任务执行异常，系统已安全停止并保留完成进度；可重试，若仍失败请联系管理员。";
}

export function acquisitionFailureStage(message?: string | null) {
  const value = String(message || "");
  if (/google_place_id.*does not exist|42703/i.test(value)) return "候选保存失败";
  if (/screening/i.test(value)) return "AI核验失败";
  if (/budget|费用|额度|limit/i.test(value)) return "费用边界停止";
  return "执行异常";
}
