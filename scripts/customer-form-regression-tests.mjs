import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") }, jsx: { runtime: "automatic" } });
const { CustomerForm, PotentialDuplicateCandidate } = await jiti.import(resolve("components/customer-form.tsx"));
const formSource = await readFile(new URL("../components/customer-form.tsx", import.meta.url), "utf8");
const editApi = await readFile(new URL("../app/api/customers/[id]/route.ts", import.meta.url), "utf8");
const createApi = await readFile(new URL("../app/api/customers/route.ts", import.meta.url), "utf8");
const detailSource = await readFile(new URL("../components/customer-crm-detail-view.tsx", import.meta.url), "utf8");
const noop = () => undefined;

const newCustomer = renderToStaticMarkup(createElement(CustomerForm, { onDone: noop, onCancel: noop }));
assert.match(newCustomer, /客户阶段/, "手动新增我的客户必须能选择客户阶段");
assert.match(newCustomer, /value="CLAIMED"[^>]*>潜在客户/, "新增客户默认潜在客户");
assert.match(newCustomer, /value="FOLLOWING"[^>]*>意向客户/, "新增客户可选择意向客户");
assert.match(newCustomer, /value="DEAL"[^>]*>成交客户/, "新增客户可选择成交客户");
assert.doesNotMatch(newCustomer, /意向佐证凭证/, "默认潜在客户不应要求意向凭证");
assert.match(formSource, /const needsBothContacts = !customer && destination === "PRIVATE" && \["FOLLOWING", "DEAL"\]\.includes\(form\.status\)/, "新增意向或成交客户时电话与邮箱必须标为必填");
assert.match(formSource, /stage === "FOLLOWING" && !stageFile/, "新增意向客户必须提交凭证");
assert.match(createApi, /!\["CLAIMED", "DEAL"\]\.includes\(requestedStage\)/, "新增意向客户必须先以潜在客户建立主档，再走凭证阶段流程");
assert.match(createApi, /requestedStage === "DEAL" && \(!String\(body\.phone \|\| ""\)\.trim\(\) \|\| !String\(body\.email \|\| ""\)\.trim\(\)\)/, "服务端必须校验手动新增成交客户的电话与邮箱");
assert.match(createApi, /ownership_disposition: ownership/, "疑似重复候选必须返回服务端核定的归属类型");
assert.match(createApi, /const possibleMatches: Record<string, unknown>\[\] = \[\];[\s\S]*?\.select\("id,company_name,contact_name,country,phone,whatsapp,email,website,google_url,address,owner_id,acquisition_scope,pool_status,status,created_at"\)\s*\.is\("deleted_at", null\)/, "重复客户精确与疑似匹配均不得包含已软删除客户");
const candidate = { id: "11111111-1111-4111-8111-111111111111", company_name: "重复候选", ownership_status: "客户公海待认领" };
const poolCandidate = renderToStaticMarkup(createElement(PotentialDuplicateCandidate, { item: { ...candidate, ownership_disposition: "PUBLIC_POOL_AVAILABLE" } }));
assert.match(poolCandidate, /customers\/pool\?tab=available&amp;customer=11111111-1111-4111-8111-111111111111/, "可认领候选必须定向定位客户公海");
assert.match(poolCandidate, /去客户公海核对并认领/, "可认领候选必须展示明确入口");
const ownCandidate = renderToStaticMarkup(createElement(PotentialDuplicateCandidate, { item: { ...candidate, ownership_disposition: "OWN_CUSTOMER" } }));
assert.match(ownCandidate, /href="\/customers\/11111111-1111-4111-8111-111111111111"/, "自己的候选客户应打开已有客户详情");
const occupiedCandidate = renderToStaticMarkup(createElement(PotentialDuplicateCandidate, { item: { ...candidate, ownership_disposition: "OTHER_OWNED_CUSTOMER" } }));
assert.doesNotMatch(occupiedCandidate, /href="\/customers\/pool/, "他人已归属客户不得错误引导至公海认领");
assert.match(occupiedCandidate, /不在可认领公海/, "他人已归属客户须解释处理路径");

const existing = {
  id: "existing-customer", company_name: "回显测试客户", country: "GB", status: "FOLLOWING", followup_status: "WAITING_REPLY",
  phone: "+441234567890", whatsapp: "+447700900123", email: "sales@example.com", contact_name: "联系人甲",
  category: "维修商", address: "测试地址", notes: "已有备注", website: "https://example.com", google_url: "https://maps.google.com/?cid=123",
};
const editCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: existing, onDone: noop, onCancel: noop, editBasicOnly: true }));
for (const value of [existing.company_name, existing.phone, existing.whatsapp, existing.email, existing.contact_name, existing.category, existing.address, existing.notes, existing.website, existing.google_url]) {
  assert.ok(editCustomer.includes(value.replaceAll("&", "&amp;")), `编辑客户应回显原始字段：${value}`);
}
assert.doesNotMatch(editCustomer, /<select[^>]*value="FOLLOWING"/, "基本资料编辑不能绕过阶段变更留痕");
assert.match(formSource, /const basicKeys=\["company_name","contact_name","country","phone","whatsapp","email","website","google_url","address","category","notes","facebook_url","instagram_url","tiktok_url","linkedin_url","other_public_urls"\]/, "编辑保存必须覆盖可回显的原始资料字段");
assert.match(editApi, /const writable = \[[\s\S]*"company_name", "contact_name", "country", "phone", "whatsapp", "email"/, "服务端应允许编辑对应原始字段");
assert.match(detailSource, /CustomerEditWorkflowSummary customer=\{customer\}[\s\S]*onStage=.*setStageOpen\(true\)[\s\S]*onFollowup=.*setTab\("跟进记录"\)/, "编辑窗口应能进入阶段变更和跟进留痕流程");
console.log("手动新增与编辑客户表单回显、必填和工作流边界回归测试通过。");
