import assert from "node:assert/strict";
import { canReadCustomerAiEvidence, presentCustomerAiEvidenceResult } from "../lib/ai/customer-evidence-access.ts";

const base = {
  viewerId: "sales-1",
  viewerRole: "SALES",
  customerOwnerId: "sales-1",
  isDirectReport: false,
  canViewCustomerEvidence: true,
  canViewAiResults: false,
};

assert.equal(canReadCustomerAiEvidence(base), true, "销售可查看当前归属本人客户的依据");
assert.equal(canReadCustomerAiEvidence({ ...base, viewerId: "supervisor-1", viewerRole: "SUPERVISOR", isDirectReport: true }), true, "主管可查看直属下属当前客户的依据");
assert.equal(canReadCustomerAiEvidence({ ...base, viewerId: "supervisor-1", viewerRole: "SUPERVISOR" }), false, "主管不得查看非直属销售客户");
assert.equal(canReadCustomerAiEvidence({ ...base, customerOwnerId: "sales-2", canViewAiResults: true }), false, "AI任务权限不能绕过客户当前归属");
assert.equal(canReadCustomerAiEvidence({ ...base, customerOwnerId: null }), false, "非管理员不能通过公海客户读取依据");
assert.equal(canReadCustomerAiEvidence({ ...base, canViewCustomerEvidence: false }), false, "依据权限被关闭时不可读取");
assert.equal(canReadCustomerAiEvidence({ ...base, viewerRole: "ADMIN", viewerId: "admin-1", customerOwnerId: "sales-2" }), true, "管理员可读取受权限保护的客户依据");

const raw = {
  id: "result-1", customer_id: "customer-1", score: 82, grade: "B",
  ai_reason: "已核验", task_id: "shared-task", task: { name: "混合客户任务" },
  total_tokens: 999, cost_usd: 9.99, pricing_snapshot: { internal_cost: 9.99 },
};
const limited = presentCustomerAiEvidenceResult(raw, false);
assert.equal(limited?.score, 82);
assert.equal(limited?.ai_reason, "已核验");
for (const key of ["task_id", "task", "total_tokens", "cost_usd", "pricing_snapshot"]) {
  assert.equal(Object.hasOwn(limited, key), false, `普通角色不得获得 ${key}`);
}
assert.equal(presentCustomerAiEvidenceResult(raw, true), raw, "仅管理员保留原始分析结果");

console.log("Customer AI evidence access tests passed.");
