const stepLabels: Record<string, string> = {
  WAITING: "等待分析",
  NORMALIZED: "客户数据已标准化",
  CUSTOMER_LOADED: "客户资料已读取",
  COLLECTING_EVIDENCE: "正在读取公开渠道证据",
  EVIDENCE_COLLECTED: "公开渠道证据已读取",
  SOURCES_COLLECTED: "公开来源已汇总",
  ANALYZING: "正在进行AI综合分析",
  MODEL_COMPLETED: "AI综合分析已完成",
  RESULT_SAVED: "分析结果已保存",
  EVIDENCE_SAVED: "分析依据已保存",
  WRITTEN_BACK: "结果已写回客户档案",
  CUSTOMER_WRITTEN_BACK: "结果已写回客户档案",
  CONTACTS_SAVED: "新增联系方式已保存",
  CACHE_SAVED: "可复用分析结果已保存",
  REUSED_RESULT_SAVED: "复用结果已保存",
  REUSED_RESULT: "已复用历史有效分析结果",
  COMPLETED: "分析完成",
  FAILED: "分析失败",
};

const errorCodeLabels: Record<string, string> = {
  AI_EVIDENCE_INSUFFICIENT: "有效经营证据不足",
  AI_EVIDENCE_NOT_AVAILABLE: "未取得可核验公开证据",
  AI_EVIDENCE_GATE_NOT_SATISFIED: "证据未达到自动判断门槛",
  AI_EVIDENCE_ROWS_EMPTY: "分析依据保存为空",
  AI_ANALYSIS_FAILED: "AI分析执行失败",
  OPENAI_TIMEOUT: "AI接口响应超时",
  OPENAI_NOT_CONFIGURED: "OpenAI密钥未配置",
  OPENAI_API_ERROR: "OpenAI接口调用失败",
  OPENAI_NETWORK_ERROR: "OpenAI网络连接失败",
  OPENAI_INVALID_JSON: "AI返回结果格式无效",
  OPENAI_INVALID_INDUSTRY: "AI返回行业分类无效",
  OPENAI_EMPTY_RESPONSE: "AI未返回分析结果",
  GOOGLE_MAPS_NOT_CONFIGURED: "Google Maps接口未配置",
  GOOGLE_MAPS_API_KEY_NOT_CONFIGURED: "Google Maps接口密钥未配置",
  INCOMPLETE_ANALYSIS_PIPELINE: "分析流程未完整保存",
  UNKNOWN_ERROR: "未识别的系统错误",
};

export function aiStepLabel(step?: string | null) {
  const value = String(step || "").trim().toUpperCase();
  if (!value) return "-";
  if (stepLabels[value]) return stepLabels[value];
  if (value.startsWith("ANALYZED_")) return "渠道证据分析已完成";
  return "处理中";
}

export function aiErrorCodeLabel(code?: string | null) {
  const value = String(code || "AI_ANALYSIS_FAILED").trim().toUpperCase();
  if (errorCodeLabels[value]) return errorCodeLabels[value];
  if (value.startsWith("HTTP_")) return `接口请求失败（${value.replace("HTTP_", "HTTP ")}）`;
  return "AI分析执行失败";
}

export function aiErrorMessageZh(code?: string | null, message?: string | null) {
  const label = aiErrorCodeLabel(code);
  const raw = String(message || "").trim();
  if (!raw || /^[A-Z0-9_:\-\s.]+$/.test(raw)) return label;
  return raw
    .replace(/OPENAI_API_ERROR/gi, "OpenAI接口调用失败")
    .replace(/OPENAI_TIMEOUT/gi, "AI接口响应超时")
    .replace(/AI_EVIDENCE_INSUFFICIENT/gi, "有效经营证据不足")
    .replace(/UNKNOWN_ERROR/gi, "未识别的系统错误")
    .replace(/fetch failed/gi, "公开页面读取失败");
}
