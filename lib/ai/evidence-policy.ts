import type { AiStrategy } from "./task-types";

export const PRIMARY_INDUSTRIES = [
  "MOBILE_PHONE_RETAILER", "USED_PHONE_RETAILER", "MOBILE_NETWORK_OPERATOR_STORE",
  "MOBILE_PHONE_REPAIR_SHOP", "APPLE_DEVICE_REPAIR_SHOP", "COMPUTER_REPAIR_SHOP",
  "MOBILE_ACCESSORY_RETAILER", "MOBILE_REPAIR_PARTS_RETAILER",
  "MOBILE_REPAIR_PARTS_WHOLESALER", "IMPORTER_DISTRIBUTOR", "REPAIR_CHAIN",
  "ELECTRONICS_RETAILER", "ECOMMERCE_SELLER", "SOFTWARE_OR_IT_SERVICE",
  "OTHER_REPAIR_BUSINESS", "MIXED_BUSINESS", "CLOSED_BUSINESS", "UNKNOWN",
] as const;

export type PrimaryIndustry = (typeof PRIMARY_INDUSTRIES)[number];
export type IdentityStatus = "MATCHED" | "LIKELY_MATCHED" | "AMBIGUOUS" | "CONFLICTED" | "NOT_FOUND";
export type AutomationStatus = "AUTO_DEVELOP" | "AUTO_REJECT" | "AUTO_HOLD" | "ANALYSIS_FAILED";
export type EvidenceStrength = "STRONG_DIRECT" | "MEDIUM_CORROBORATING" | "WEAK_HINT";

export type PolicyEvidence = {
  sourceId?: string;
  channel: string;
  sourceUrl: string;
  fact: string;
  kind: "支持" | "矛盾" | "中性";
  confidence: number;
  strength?: EvidenceStrength;
};

const industryMap: Record<string, PrimaryIndustry> = {
  "手机成品零售": "MOBILE_PHONE_RETAILER",
  "二手或翻新手机销售": "USED_PHONE_RETAILER",
  "运营商营业厅": "MOBILE_NETWORK_OPERATOR_STORE",
  "手机维修店": "MOBILE_PHONE_REPAIR_SHOP",
  "Apple或MacBook维修店": "APPLE_DEVICE_REPAIR_SHOP",
  "手机外配件零售": "MOBILE_ACCESSORY_RETAILER",
  "维修内配件零售": "MOBILE_REPAIR_PARTS_RETAILER",
  "维修内配件批发": "MOBILE_REPAIR_PARTS_WHOLESALER",
  "进口商或分销商": "IMPORTER_DISTRIBUTOR",
  "维修连锁": "REPAIR_CHAIN",
  "综合电子产品零售": "ELECTRONICS_RETAILER",
  "电商卖家": "ECOMMERCE_SELLER",
  "软件或IT服务": "SOFTWARE_OR_IT_SERVICE",
  "其他维修行业": "OTHER_REPAIR_BUSINESS",
  "混合经营": "MIXED_BUSINESS",
  "已关闭": "CLOSED_BUSINESS",
  "手机配件批发商": "MOBILE_REPAIR_PARTS_WHOLESALER",
  "手机配件零售商": "MOBILE_REPAIR_PARTS_RETAILER",
  "手机进口商": "IMPORTER_DISTRIBUTOR",
  "电脑维修店": "COMPUTER_REPAIR_SHOP",
  "电脑配件批发商": "MOBILE_REPAIR_PARTS_WHOLESALER",
  "其他": "UNKNOWN",
};

export function primaryIndustryFor(value?: string | null): PrimaryIndustry {
  if (!value) return "UNKNOWN";
  if (PRIMARY_INDUSTRIES.includes(value as PrimaryIndustry)) return value as PrimaryIndustry;
  return industryMap[value] || "UNKNOWN";
}

export function evidenceStrengthFor(evidence: PolicyEvidence): EvidenceStrength {
  if (evidence.strength) return evidence.strength;
  const channel = evidence.channel.toLowerCase();
  const fact = evidence.fact.toLowerCase();
  const directBusinessFact = /(?:换屏|更换屏幕|换电池|电池更换|尾插维修|维修预约|维修报价|手机维修|电脑维修|计算机维修|电脑硬件维修|macbook维修|手机配件(?:商店|零售|批发)?|电脑配件(?:商店|零售|批发)?|电子设备维修|电子产品维修|lcd|oled|批发|经销|分销|进口|wholesale|\bb2b\b|\bmoq\b|bulk price|trade account|distributor|dealer|reseller|永久关闭|已停业|只销售手机成品|运营商套餐)/i.test(fact);
  const googleRepairCategoryOnly = channel === "google_maps"
    && /(?:分类|类别)/.test(fact)
    && /(?:手机维修|电脑维修|电子产品维修)/.test(fact)
    && !/(?:换屏|屏幕更换|换电池|电池更换|尾插|充电口|主板|维修评论|维修工作台|拆机|内配件)/.test(fact);
  const directRejectFact = /(?:计算机服务|计算机技术支持|IT系统|网络(?:设置|配置|维护|管理|支持)|NAS(?:设置|配置|维护|支持)|服务器(?:设置|配置|维护|支持)|软件开发|云服务|网络托管|运营商套餐|SIM卡|食品批发|铁路工程|铁路安全|电气安全|software|IT support|technical support|managed services|network setup|NAS setup|server maintenance)/i.test(fact);
  // A page path such as /services or /contact is not evidence by itself. Strong
  // evidence requires a concrete business fact from an authoritative source.
  if (googleRepairCategoryOnly) return "MEDIUM_CORROBORATING";
  if (["website", "google_maps", "customs", "exhibition"].includes(channel)
      && (directBusinessFact || (evidence.kind === "矛盾" && directRejectFact))) return "STRONG_DIRECT";
  if (["website", "google_maps", "linkedin", "business_registry", "directory"].includes(channel)) return "MEDIUM_CORROBORATING";
  return "WEAK_HINT";
}

function origin(value: string) {
  try { return new URL(value).origin.toLowerCase(); } catch { return ""; }
}

export function evaluateEvidenceGate(input: {
  strategy: AiStrategy;
  identityStatus: IdentityStatus;
  identityConfidence: number;
  industryConfidence: number;
  decisionConfidence: number;
  score: number;
  industry: PrimaryIndustry;
  evidence: PolicyEvidence[];
  hasCriticalConflict: boolean;
  explicitRejectEvidence?: boolean;
}): { automationStatus: AutomationStatus; reason: string; sufficient: boolean; evidenceIds: string[] } {
  const usable = input.evidence.filter((item) => item.kind !== "中性" && item.confidence >= 60 && /^https?:\/\//i.test(item.sourceUrl));
  const positive = usable.filter((item) => item.kind === "支持");
  const negative = usable.filter((item) => item.kind === "矛盾");
  const sufficient = (items: PolicyEvidence[]) => {
    const strong = items.filter((item) => evidenceStrengthFor(item) === "STRONG_DIRECT");
    const medium = items.filter((item) => evidenceStrengthFor(item) === "MEDIUM_CORROBORATING");
    const independent = new Set(items.map((item) => origin(item.sourceUrl)).filter(Boolean)).size;
    return input.strategy === "DEEP"
      ? strong.length >= 1 || (medium.length >= 3 && independent >= 2)
      : strong.length >= 1 || (medium.length >= 2 && independent >= 2);
  };
  const positiveEnough = sufficient(positive);
  const negativeEnough = sufficient(negative);
  // MATCHED already means the collector found a strong exact-name, domain,
  // phone or address chain. Requiring 90 again rejected exact public entities
  // whose raw score was 80-89, even when an official page supplied direct
  // business facts.
  const identityThreshold = 80;
  const industryThreshold = 82;
  const evidenceIds = usable.map((item) => item.sourceId).filter((item): item is string => Boolean(item));

  if (input.identityStatus !== "MATCHED" || input.identityConfidence < identityThreshold) {
    return { automationStatus: "AUTO_HOLD", reason: "企业主体尚未达到自动判定所需的身份匹配阈值。", sufficient: false, evidenceIds };
  }
  if (input.hasCriticalConflict) {
    return { automationStatus: "AUTO_HOLD", reason: "官网、地图或联系方式存在关键主体冲突，需要等待独立复核。", sufficient: false, evidenceIds };
  }
  if (input.explicitRejectEvidence && negativeEnough && input.decisionConfidence >= industryThreshold) {
    return { automationStatus: "AUTO_REJECT", reason: "已确认同一企业，且存在明确的非目标或停业证据。", sufficient: true, evidenceIds };
  }
  if (!positiveEnough || input.industry === "UNKNOWN" || input.industryConfidence < industryThreshold || input.decisionConfidence < industryThreshold) {
    return { automationStatus: "AUTO_HOLD", reason: "外部证据或行业置信度不足，不能自动判为有效或无效。", sufficient: false, evidenceIds };
  }
  if (input.score >= 60) {
    return { automationStatus: "AUTO_DEVELOP", reason: "企业身份和行业均已核实，目标业务证据达到自动开发阈值。", sufficient: true, evidenceIds };
  }
  return { automationStatus: "AUTO_REJECT", reason: "企业身份和行业均已核实，且明确不符合目标业务。", sufficient: true, evidenceIds };
}

export function compatibilityTargetDecision(status: AutomationStatus) {
  return status === "AUTO_DEVELOP" ? "VALID" : status === "AUTO_REJECT" ? "INVALID" : "REVIEW";
}

