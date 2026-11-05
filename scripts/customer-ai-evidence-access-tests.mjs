import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canReadCustomerAiEvidence, presentCustomerAiEvidenceResult } from "../lib/ai/customer-evidence-access.ts";

const base = {
  viewerId: "sales-1",
  viewerRole: "SALES",
  customerOwnerId: "sales-1",
  isDirectReport: false,
  canViewCustomerEvidence: true,
  canViewAiResults: false,
};

assert.equal(canReadCustomerAiEvidence(base), true, "管理员授权后销售可查看本人客户依据");
assert.equal(canReadCustomerAiEvidence({ ...base, viewerId: "supervisor-1", viewerRole: "SUPERVISOR", isDirectReport: true }), true, "授权主管可查看直属下属客户依据");
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

const customerRoute = await readFile(new URL("../app/api/customers/[id]/route.ts", import.meta.url), "utf8");
const customerListRoute = await readFile(new URL("../app/api/customers/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202610100004_customer_ai_evidence_column_privileges.sql", import.meta.url), "utf8");
assert.match(customerRoute, /company_scale_evidence: account\.role === "ADMIN" \? data\.company_scale_evidence : null/, "单客户接口不得向普通角色返回原始规模依据");
assert.match(customerRoute, /\.update\(payload\)[\s\S]*?\.select\(\["id", "status", \.\.\.writable\]\.join\(","\)\)/, "客户编辑返回不得使用暴露敏感列的通配选择");
assert.match(customerListRoute, /exportMode \? customerExportFields : customerListFields/, "客户导出不得使用通配选择");
assert.match(customerListRoute, /account\.role === "ADMIN"[\s\S]*?select\("id,company_scale_evidence"\)/, "管理员导出仍可通过服务端读取规模依据");
assert.match(migration, /revoke select, insert, update on table public\.customers from anon, authenticated/i, "迁移必须先移除客户端整表权限");
assert.match(migration, /a\.attname <> 'company_scale_evidence'/, "客户端字段授权必须排除原始规模依据");
assert.match(migration, /has_column_privilege\('authenticated', 'public\.customers', 'company_scale_evidence', 'SELECT'\)/, "迁移必须自检敏感列不可直读");
assert.doesNotMatch(migration, /\bupdate\s+public\.customers\b/i, "权限迁移不得修改现有客户数据");

console.log("Customer AI evidence access tests passed.");
