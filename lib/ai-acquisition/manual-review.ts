export type ManualReviewInput = {
  score: number;
  targetDecision: "VALID" | "INVALID";
  industry: string;
  reason: string;
  evidenceIds: string[];
};

export const MANUAL_REVIEW_INDUSTRIES = [
  "手机成品零售", "二手或翻新手机销售", "运营商营业厅", "手机维修店", "Apple或MacBook维修店",
  "电脑维修店", "手机外配件零售", "维修内配件零售", "维修内配件批发", "进口商或分销商",
  "维修连锁", "综合电子产品零售", "电商卖家", "软件或IT服务", "其他维修行业", "混合经营",
  "电子烟或烟草零售", "食品批发或餐饮供应", "铁路或电气工程", "电器或家电维修",
  "拍卖或资产处置", "药房或医疗零售", "其他",
] as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function manualScoreLevel(score: number) {
  return score >= 85 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D";
}

export function parseManualReview(value: unknown): ManualReviewInput {
  if (!value || typeof value !== "object") throw new Error("请填写人工复核结论");
  const input = value as Record<string, unknown>;
  const score = input.score;
  const targetDecision = input.targetDecision;
  const industry = typeof input.industry === "string" ? input.industry.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const evidenceIds = Array.isArray(input.evidenceIds) ? input.evidenceIds : [];
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) throw new Error("人工评分必须是 0–100 的整数");
  if (targetDecision !== "VALID" && targetDecision !== "INVALID") throw new Error("请选择是否为目标客户");
  if (targetDecision === "VALID" && score < 60) throw new Error("确认目标客户时人工评分须达到 60 分；请按证据重新评分");
  if (targetDecision === "INVALID" && score >= 60) throw new Error("确认非目标客户时人工评分须低于 60 分；请按证据重新评分");
  if (!MANUAL_REVIEW_INDUSTRIES.some((item) => item === industry)) throw new Error("请选择核实后的标准经营行业");
  if (reason.length < 10 || reason.length > 1000) throw new Error("请填写 10–1000 字的具体复核依据与改分理由");
  if (evidenceIds.length > 20 || evidenceIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))) throw new Error("所选证据无效或数量超过 20 条");
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error("不能重复选择同一条证据");
  if (targetDecision === "VALID" && evidenceIds.length === 0) throw new Error("确认目标客户须选择至少一条可追溯经营证据");
  return { score, targetDecision, industry, reason, evidenceIds };
}
