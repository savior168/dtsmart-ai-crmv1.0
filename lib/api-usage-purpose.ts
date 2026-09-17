export type UsagePurpose = {
  provider: "GOOGLE_PLACES" | "OPENAI" | string;
  purpose: string;
  calls: number;
  tokens: number;
  cost_usd: number;
};

type PurposeSource = {
  provider: string;
  operation?: string | null;
  quantity?: number | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  amount_usd?: number | null;
  metadata?: Record<string, unknown> | null;
};

export function googlePurpose(operation?: string | null) {
  const value = String(operation || "").trim();
  if (value.includes("目标商家搜索")) return "目标商家发现";
  if (value.includes("联系方式")) return "商家详情与联系方式";
  if (value.includes("评论") || value.includes("经营说明")) return "评论与经营说明";
  if (value.includes("基础详情")) return "商家基础资料核验";
  if (value.includes("搜索")) return "主体与地址匹配搜索";
  return "其他或历史未细分调用";
}

export function openAiPurpose(operation?: string | null, metadata?: Record<string, unknown> | null) {
  const channel = String(metadata?.channel || "").trim();
  if (channel === "final_escalation" || String(operation || "").includes("final_escalation")) return "证据冲突升级复核";
  if (channel === "all_available_sources") return "多来源证据综合与目标判断";
  if (channel === "cross_user_result_reuse") return "历史分析结果复用";
  return "客户主体、行业与质量综合分析";
}

export function summarizeUsagePurposes(rows: PurposeSource[]) {
  const grouped = new Map<string, UsagePurpose>();
  for (const row of rows) {
    const purpose = row.provider === "GOOGLE_PLACES"
      ? googlePurpose(row.operation)
      : row.provider === "OPENAI"
        ? openAiPurpose(row.operation, row.metadata)
        : "其他第三方调用";
    const key = `${row.provider}:${purpose}`;
    const current = grouped.get(key) || { provider: row.provider, purpose, calls: 0, tokens: 0, cost_usd: 0 };
    current.calls += Math.max(0, Number(row.quantity || 1));
    current.tokens += Math.max(0, Number(row.input_tokens || 0)) + Math.max(0, Number(row.output_tokens || 0));
    current.cost_usd += Number(row.amount_usd || 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => right.calls - left.calls || right.tokens - left.tokens || left.purpose.localeCompare(right.purpose, "zh-CN"));
}
