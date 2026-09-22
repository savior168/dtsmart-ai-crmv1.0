import { hasPhoneComputerRepairPartsTradeEvidence } from "../ai/target-trade-evidence.js";

const VERIFIED_INDUSTRY_BY_ACQUISITION_INDUSTRY: Record<string, Set<string>> = {
  "手机维修店": new Set(["手机维修店", "维修连锁", "混合经营"]),
  "手机维修服务商": new Set(["手机维修店", "维修连锁", "混合经营"]),
  "手机维修连锁店": new Set(["手机维修店", "维修连锁", "混合经营"]),
  "Apple设备维修店": new Set(["Apple或MacBook维修店", "维修连锁", "混合经营"]),
  "手机配件批发商": new Set(["维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机内配件经销商": new Set(["维修内配件零售", "维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机维修配件经销商": new Set(["维修内配件零售", "维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机屏幕批发商": new Set(["维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机电池批发商": new Set(["维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机主板配件经销商": new Set(["维修内配件零售", "维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机维修工具供应商": new Set(["维修内配件批发", "进口商或分销商", "混合经营"]),
  "电脑维修店": new Set(["电脑维修店", "Apple或MacBook维修店", "维修连锁", "混合经营"]),
  "笔记本电脑维修店": new Set(["电脑维修店", "Apple或MacBook维修店", "维修连锁", "混合经营"]),
  "电脑配件批发商": new Set(["维修内配件批发", "进口商或分销商", "混合经营"]),
  "笔记本配件经销商": new Set(["维修内配件零售", "维修内配件批发", "进口商或分销商", "混合经营"]),
  "电子设备维修服务商": new Set(["其他维修行业", "手机维修店", "电脑维修店", "Apple或MacBook维修店", "混合经营"]),
};

/** 最终入池行业必须与用户创建任务时选择的目标行业一致。 */
export function acquisitionIndustryMatchesVerifiedResult(
  targetIndustries: string[],
  verifiedIndustry?: string | null,
  evidenceFacts: Array<string | null | undefined> = [],
) {
  if (!verifiedIndustry) return false;
  const knownTargets = targetIndustries
    .map((industry) => VERIFIED_INDUSTRY_BY_ACQUISITION_INDUSTRY[industry])
    .filter((allowed): allowed is Set<string> => Boolean(allowed));
  // 自定义行业暂未进入本映射时，仍由证据门控处理，避免误伤其他业务模块。
  if (!knownTargets.length) return true;
  const coarseIndustryMatch = knownTargets.some((allowed) => allowed.has(verifiedIndustry));
  if (!coarseIndustryMatch) return false;
  if (verifiedIndustry === "进口商或分销商") return hasPhoneComputerRepairPartsTradeEvidence(evidenceFacts);
  return true;
}
