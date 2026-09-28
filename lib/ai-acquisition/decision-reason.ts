/** Explain the final task-specific gate without changing the customer's value score. */
export function acquisitionIndustryMismatchReason(targetIndustries: string[], verifiedIndustry?: string | null) {
  const industry = String(verifiedIndustry || "未知").trim() || "未知";
  if (targetIndustries.length === 1 && targetIndustries[0] === "手机维修连锁店") {
    return `已核验“${industry}”业务，但缺少手机维修及多门店或连锁经营的直接证据，未达到本任务的连锁店目标`;
  }
  return `已核验行业“${industry}”缺少与本任务目标行业直接匹配的经营证据，未进入客户公海`;
}
