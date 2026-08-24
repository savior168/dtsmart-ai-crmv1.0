import assert from "node:assert/strict";
import { analyzeCustomer } from "../lib/ai/customer-analysis";

const googleUrl = process.argv[2] || "https://www.google.com/maps/place/Mundo+Display+-+Reparaciones+En+Vivo+-+CCI/@-0.1772914,-78.4851124,17z/data=!3m1!4b1!4m6!3m5!1s0x91d59a85be2f2187:0x94a6d3edcb8b9a92!8m2!3d-0.1772914!4d-78.4851124!16s%2Fg%2F11fz9x7lxf?entry=ttu";
const result = await analyzeCustomer({
  customer_name: "Mundo Display - Reparaciones En Vivo - CCI",
  country: "厄瓜多尔",
  google_url: googleUrl,
  evidence: {
    google_place: {
      configured: false,
      query: "Mundo Display - Reparaciones En Vivo - CCI 厄瓜多尔",
      types: [],
      reviews: [],
      emails: [],
      error: "谷歌地图结构化数据服务未配置，本次改用公开网页检索。",
    },
  },
}, { tier: "fast", timeoutMs: 25_000 });

assert.ok(result.evidence_summaries.length > 0, "公开网页检索没有返回可追溯证据");
assert.ok(result.evidence_summaries.every((item) => /[\u3400-\u9fff]/.test(item.fact_zh)), "证据必须为中文提炼事实");
assert.ok(result.evidence_summaries.every((item) => /^https?:\/\//i.test(item.source_url)), "每条证据必须包含可核验网址");
assert.ok(result.evidence_summaries.every((item) => !/GOOGLE_MAPS_API_KEY|fetch failed|EXCEL_IMPORT/i.test(item.fact_zh)), "证据不得包含内部错误码或导入标签");
assert.ok(result.evidence_summaries.every((item) => !/\]\(https?:\/\//i.test(item.fact_zh)), "来源链接必须独立保存，不能混进中文事实正文");
console.log(JSON.stringify({
  industry_type: result.industry_type,
  is_target_customer: result.is_target_customer,
  ai_score: result.ai_score,
  confidence_score: result.confidence_score,
  evidence: result.evidence_summaries.map(({ title_zh, fact_zh, source_url }) => ({ title_zh, fact_zh, source_url })),
  usage: result.usage,
}, null, 2));
