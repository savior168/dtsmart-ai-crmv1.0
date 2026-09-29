import { hasPhoneComputerRepairPartsProductEvidence, hasPhoneComputerRepairPartsTradeEvidence } from "../ai/target-trade-evidence.js";

const VERIFIED_INDUSTRY_BY_ACQUISITION_INDUSTRY: Record<string, Set<string>> = {
  "手机维修店": new Set(["手机维修店", "维修连锁", "混合经营"]),
  "手机维修服务商": new Set(["手机维修店", "维修连锁", "混合经营"]),
  "手机维修连锁店": new Set(["手机维修店", "Apple或MacBook维修店", "电脑维修店", "维修连锁", "混合经营"]),
  "Apple设备维修店": new Set(["Apple或MacBook维修店", "维修连锁", "混合经营"]),
  "手机配件批发商": new Set(["维修内配件批发", "进口商或分销商", "混合经营"]),
  "手机配件零售商": new Set(["维修内配件零售", "维修内配件批发", "混合经营"]),
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

const PHONE_REPAIR_OPERATION = /(?:phone|smartphone|iphone|手机|智能手机)(?:(?!laptop|computer|notebook|macbook|笔记本|电脑)[^。；\n]){0,70}(?:screen|display|battery|charging port|charge port|屏幕|电池|充电口|尾插)[^。；\n]{0,70}(?:repair|replace|replacement|fix|维修|换屏|换电池|更换)|(?:phone|smartphone|iphone|手机|智能手机)[^。；\n]{0,70}(?:repair|replace|replacement|fix|维修|换屏|换电池|更换)[^。；\n]{0,70}(?:screen|display|battery|charging port|charge port|屏幕|电池|充电口|尾插)|(?:screen|display|battery|charging port|charge port|屏幕|电池|充电口|尾插)[^。；\n]{0,70}(?:repair|replace|replacement|fix|维修|换屏|换电池|更换)[^。；\n]{0,70}(?:phone|smartphone|iphone|手机|智能手机)/i;
const NEGATED_FACT = /(?:未发现|未取得|没有|不提供|不销售|无法证明|does not|did not|no (?:verified |clear )?)/i;

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
  const facts = evidenceFacts.join(" ");
  const directFacts = evidenceFacts.map((fact) => String(fact || "").trim()).filter((fact) => fact && !NEGATED_FACT.test(fact));
  const accessoryRetailWithTargetBusiness = verifiedIndustry === "手机外配件零售" && (
    (targetIndustries.some((industry) => ["手机维修店", "手机维修服务商", "手机维修连锁店"].includes(industry))
      && directFacts.some((fact) => PHONE_REPAIR_OPERATION.test(fact)))
    || (targetIndustries.some((industry) => ["手机配件零售商", "手机内配件经销商", "手机维修配件经销商", "手机主板配件经销商"].includes(industry))
      && directFacts.some(hasPhoneComputerRepairPartsProductEvidence))
    || (targetIndustries.some((industry) => ["手机配件批发商", "手机屏幕批发商", "手机电池批发商", "手机维修工具供应商"].includes(industry))
      && hasPhoneComputerRepairPartsTradeEvidence(evidenceFacts))
  );
  const coarseIndustryMatch = knownTargets.some((allowed) => allowed.has(verifiedIndustry)) || accessoryRetailWithTargetBusiness;
  if (!coarseIndustryMatch) return false;
  if (targetIndustries.includes("手机维修连锁店") && !targetIndustries.some((industry) => industry !== "手机维修连锁店")) {
    // A primary industry label is not evidence of either phone repair or
    // multiple locations. Both must be supported by the verified facts.
    return /(?:手机维修|手机换屏|手机屏幕更换|iPhone维修|phone repair|smartphone repair|mobile repair|screen replacement)/i.test(facts)
      && /(?:多门店|连锁经营|连锁门店|分店|加盟|chain|franchise|multiple locations|multiple branches|multi.location)/i.test(facts);
  }
  if (verifiedIndustry === "进口商或分销商") return hasPhoneComputerRepairPartsTradeEvidence(evidenceFacts);
  return true;
}
