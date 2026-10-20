import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") }, jsx: { runtime: "automatic" } });
const { CustomerForm, PotentialDuplicateCandidate } = await jiti.import(resolve("components/customer-form.tsx"));
const { CUSTOMER_LIST_DEFAULT_COLUMNS, migrateMyCustomerDefaultColumns, normalizeCustomerListColumns } = await jiti.import(resolve("lib/customers/list-fields.ts"));
const { displayAddressList, normalizeAddressPayload } = await jiti.import(resolve("lib/customers/address-list.ts"));
const formSource = await readFile(new URL("../components/customer-form.tsx", import.meta.url), "utf8");
const editApi = await readFile(new URL("../app/api/customers/[id]/route.ts", import.meta.url), "utf8");
const createApi = await readFile(new URL("../app/api/customers/route.ts", import.meta.url), "utf8");
const detailSource = await readFile(new URL("../components/customer-crm-detail-view.tsx", import.meta.url), "utf8");
const poolSource = await readFile(new URL("../components/customer-public-pool-view.tsx", import.meta.url), "utf8");
const listSource = await readFile(new URL("../components/customers-view.tsx", import.meta.url), "utf8");
const followupApiSource = await readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8");
const followupViewSource = await readFile(new URL("../components/followups-view.tsx", import.meta.url), "utf8");
const dashboardApiSource = await readFile(new URL("../app/api/dashboard/stats/route.ts", import.meta.url), "utf8");
const dashboardViewSource = await readFile(new URL("../components/crm-dashboard.tsx", import.meta.url), "utf8");
const profileGrants = await readFile(new URL("../supabase/migrations/20261019010000_customer_profile_column_privileges.sql", import.meta.url), "utf8");
const addressMigration = await readFile(new URL("../supabase/migrations/20261019035957_customer_address_lists.sql", import.meta.url), "utf8");
const taskRuntime = await readFile(new URL("../components/task-runtime.tsx", import.meta.url), "utf8");
const noop = () => undefined;

const newCustomer = renderToStaticMarkup(createElement(CustomerForm, { onDone: noop, onCancel: noop }));
for (const [before, after] of [["客户名称", "国家/地区"], ["国家/地区", "公司名称"], ["公司名称", "公司税号"]]) {
  assert.ok(newCustomer.indexOf(before) < newCustomer.indexOf(after), `${before}应排在${after}之前`);
}
assert.match(newCustomer, />官网<\/span>/, "客户表单官网字段应简洁显示为官网");
assert.match(newCustomer, /客户名称[\s\S]*国家\/地区[\s\S]*公司名称[\s\S]*公司税号/, "新增与编辑表单的前四项顺序应一致");
assert.doesNotMatch(newCustomer, /客户类型|原始商家类别/, "AI原始分类不得作为客户手工编辑字段");
assert.match(newCustomer, /理货要求<\/span><textarea[^>]*rows="5"[\s\S]*备注<\/span><textarea[^>]*rows="5"/, "理货要求与备注应同排使用多行输入框");
assert.match(newCustomer, /客户阶段/, "手动新增我的客户必须能选择客户阶段");
assert.match(newCustomer, /value="CLAIMED"[^>]*>潜在客户/, "新增客户默认潜在客户");
assert.match(newCustomer, /value="FOLLOWING"[^>]*>意向客户/, "新增客户可选择意向客户");
assert.match(newCustomer, /value="DEAL"[^>]*>已成交客户/, "新增客户可选择已成交客户");
for (const label of ["公司名称", "公司税号", "客户名称", "客户等级", "公司地址", "客户收货地址", "货代地址"]) {
  assert.ok(newCustomer.includes(label), `新增客户表单应显示${label}`);
}
assert.doesNotMatch(newCustomer, />其他地址</, "客户表单不应再展示其他地址");
assert.ok(newCustomer.indexOf("客户等级") < newCustomer.indexOf("客户阶段"), "客户阶段应紧随客户等级");
for (const grade of ["S", "A", "B", "C", "D"]) {
  assert.match(newCustomer, new RegExp(`value="${grade}"[^>]*>${grade}<`), `客户等级应支持${grade}`);
}
assert.doesNotMatch(newCustomer, /意向佐证凭证/, "默认潜在客户不应要求意向凭证");
assert.match(formSource, /客户阶段[\s\S]*?意向佐证凭证[\s\S]*?input\("phone"/, "意向佐证入口应紧邻客户阶段且排在联系方式之前");
assert.match(formSource, /id="customer-intent-evidence" type="file"[\s\S]*?className="sr-only"/, "意向佐证应使用可访问的定制文件选择入口，不展示浏览器原生控件");
assert.match(formSource, /stageFile \? "更换文件" : "选择文件"/, "已选凭证应可更换并回显文件名");
assert.match(formSource, /const needsBothContacts = !customer && destination === "PRIVATE" && \["FOLLOWING", "DEAL"\]\.includes\(form\.status\)/, "新增意向或成交客户时电话与邮箱必须标为必填");
assert.match(formSource, /stage === "FOLLOWING" && !stageFile/, "新增意向客户必须提交凭证");
assert.match(createApi, /!\["CLAIMED", "DEAL"\]\.includes\(requestedStage\)/, "新增意向客户必须先以潜在客户建立主档，再走凭证阶段流程");
assert.match(createApi, /requestedStage === "DEAL" && \(!String\(body\.phone \|\| ""\)\.trim\(\) \|\| !String\(body\.email \|\| ""\)\.trim\(\)\)/, "服务端必须校验手动新增成交客户的电话与邮箱");
assert.match(createApi, /ownership_disposition: ownership/, "疑似重复候选必须返回服务端核定的归属类型");
assert.match(createApi, /\.from\("users"\)\.select\("id,name"\)\.in\("id", ownerIds\)/, "仅查询已有归属人的内部姓名，不返回员工邮箱");
assert.match(createApi, /owner_name: ownership === "OTHER_OWNED_CUSTOMER"/, "仅向已有归属人的候选返回归属姓名");
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
const namedCandidate = renderToStaticMarkup(createElement(PotentialDuplicateCandidate, { item: { ...candidate, ownership_disposition: "OTHER_OWNED_CUSTOMER", owner_name: "同事甲" } }));
assert.match(namedCandidate, /<span[^>]*>当前归属人：同事甲<\/span>/, "已有归属客户须在状态标签直接展示内部归属人姓名");
assert.doesNotMatch(poolCandidate, /当前归属人/, "公海客户不得显示旧归属人");

const existing = {
  id: "existing-customer", company_name: "回显测试客户", country: "GB", status: "FOLLOWING", followup_status: "WAITING_REPLY",
  phone: "+441234567890", whatsapp: "+447700900123", email: "sales@example.com", contact_name: "联系人甲",
  category: "维修商", address: "测试地址", notes: "已有备注", website: "https://example.com", google_url: "https://maps.google.com/?cid=123",
};
const editCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: existing, onDone: noop, onCancel: noop, editBasicOnly: true }));
for (const value of [existing.company_name, existing.phone, existing.whatsapp, existing.email, existing.contact_name, existing.address, existing.notes, existing.website, existing.google_url]) {
  assert.ok(editCustomer.includes(value.replaceAll("&", "&amp;")), `编辑客户应回显原始字段：${value}`);
}
assert.doesNotMatch(editCustomer, /<span[^>]*>(客户类型|原始商家类别)<\/span>|value="维修商"/, "我的客户编辑不得把原始采集类别误当成可编辑客户类型");
const aiAnalyzedCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: { ...existing, industry: "手机维修店", ai_screening_done: true }, onDone: noop, onCancel: noop, editBasicOnly: true }));
assert.doesNotMatch(aiAnalyzedCustomer, /所属行业|value="手机维修店"/, "我的客户编辑不应回显只读行业字段");
assert.match(editCustomer, /客户等级[\s\S]*客户阶段/, "编辑客户时阶段应紧随客户等级");
assert.match(editCustomer, /<select[^>]*aria-label="变更客户阶段"[^>]*disabled=""/, "无阶段变更权限时不得操作阶段选择");
const editableStageCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: existing, onDone: noop, onCancel: noop, onChangeStage: noop, editBasicOnly: true }));
assert.doesNotMatch(editableStageCustomer, /<select[^>]*aria-label="变更客户阶段"[^>]*disabled=""/, "有阶段变更权限时应能从编辑窗口发起留痕流程");
const publicPoolCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: { ...existing, industry: "手机维修", ai_screening_done: true }, destination: "PUBLIC_POOL", onDone: noop, onCancel: noop, editBasicOnly: true }));
assert.doesNotMatch(publicPoolCustomer, /所属行业|value="手机维修"/, "公海编辑也不应回显行业字段");
assert.doesNotMatch(publicPoolCustomer, /<span[^>]*>(客户类型|原始商家类别)<\/span>|value="维修商"/, "公海编辑不得把原始采集类别放进资料编辑表单");
assert.doesNotMatch(publicPoolCustomer, /客户等级|变更客户阶段/, "公海编辑不得显示我的客户等级和阶段操作");
const unverifiedPublicCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: { ...existing, industry: null, ai_screening_done: false, category: "electronics_store | cell_phone_store" }, destination: "PUBLIC_POOL", onDone: noop, onCancel: noop, editBasicOnly: true }));
assert.doesNotMatch(unverifiedPublicCustomer, /所属行业|手机零售、电子产品零售|尚未经AI核验/, "未核验公海客户也不应回显行业");
assert.match(editCustomer, /aria-label="客户收货地址1"/, "客户收货地址初始应显示第一条输入框");
assert.match(publicPoolCustomer, /aria-label="货代地址1"/, "公海编辑应复用货代地址列表");
assert.match(editCustomer, /\+ 添加客户收货地址[\s\S]*\+ 添加货代地址/, "两种地址都应可追加");
const multiAddressCustomer = renderToStaticMarkup(createElement(CustomerForm, { customer: { ...existing, shipping_addresses: ["收货地址甲", "收货地址乙"], forwarder_addresses: ["货代地址甲", "货代地址乙"] }, onDone: noop, onCancel: noop, editBasicOnly: true }));
for (const label of ["客户收货地址1", "客户收货地址2", "货代地址1", "货代地址2", "删除客户收货地址1", "删除货代地址2"]) assert.ok(multiAddressCustomer.includes(label), `${label}应回显且可维护`);
assert.deepEqual(displayAddressList([], "旧收货地址"), ["旧收货地址"], "历史单地址应回显为第一条");
const addresses = { shipping_addresses: [" 收货地址乙 ", "", "收货地址丙"], forwarder_addresses: ["货代地址甲"] };
normalizeAddressPayload(addresses);
assert.deepEqual(addresses.shipping_addresses, ["收货地址乙", "收货地址丙"], "空地址应移除并按序重新编号");
assert.equal(addresses.shipping_address, "收货地址乙", "PI兼容字段应同步为首条收货地址");
assert.equal(addresses.forwarder_address, "货代地址甲", "旧货代地址字段应同步为首条");
assert.throws(() => normalizeAddressPayload({ shipping_addresses: Array(11).fill("地址") }), /最多可填写 10 条/);
assert.throws(() => normalizeAddressPayload({ shipping_addresses: ["重复", "重复"] }), /不能重复/);
assert.match(formSource, /const payload=editBasicOnly\?Object\.fromEntries\(editableKeys/, "编辑基本资料不得在 PATCH 中直接改阶段");
assert.match(formSource, /destination==="PUBLIC_POOL"\?basicKeys\.filter\(\(key\)=>key!=="manual_grade"\)/, "公海编辑保存不得覆盖我的客户等级");
const editableFields = formSource.match(/const basicKeys=\[[^\]]+\]/)?.[0] || "";
assert.doesNotMatch(editableFields, /"category"/, "基础资料保存不得覆盖原始商家类别");
for (const field of ["company_name", "contact_name", "country", "phone", "whatsapp", "wechat", "email", "tax_number", "manual_grade", "website", "google_url", "address", "shipping_address", "forwarder_address", "shipping_addresses", "forwarder_addresses", "tally_requirements", "notes", "facebook_url", "instagram_url", "tiktok_url", "linkedin_url", "other_public_urls"]) {
  assert.ok(editableFields.includes(`"${field}"`), `编辑保存必须包含${field}`);
}
assert.doesNotMatch(editableFields, /"other_address"/, "编辑保存不应覆盖已隐藏的历史其他地址");
assert.doesNotMatch(editCustomer, />其他地址</, "我的客户编辑不应展示其他地址");
assert.doesNotMatch(publicPoolCustomer, />其他地址</, "公海客户编辑不应展示其他地址");
assert.doesNotMatch(detailSource, /<Row label="其他地址">/, "客户详情不应展示已移除的其他地址");
assert.match(detailSource, /onDirtyChange={setEditingDirty}/, "客户编辑必须监听未保存修改");
assert.match(detailSource, /<ConfirmDialog open=\{Boolean\(pendingEditExit\)\}/, "关闭客户编辑时必须确认放弃修改");
assert.match(poolSource, /CustomerForm destination="PUBLIC_POOL" onDirtyChange=\{setCreateDirty\}/, "公海新增客户也必须监听草稿变更");
assert.match(poolSource, /<ConfirmDialog open=\{confirmCreateExit\}/, "公海新增客户有未保存修改时必须提示确认");
assert.match(formSource, /x-dtsmart-toast":"manual-error"/, "客户表单错误已在表单内展示时不应再弹全局重复错误toast");
assert.match(taskRuntime, /toastMode === "manual-error" && !response\.ok/, "manual-error只抑制重复失败toast，不影响统一成功反馈");
assert.match(editApi, /const writable = \[[\s\S]*"company_name", "contact_name", "country", "phone", "whatsapp", "email"/, "服务端应允许编辑对应原始字段");
const editableCustomerFields = editApi.match(/const writable = \[[\s\S]*?\];/)?.[0] || "";
assert.doesNotMatch(editableCustomerFields, /product_image|store_name|store_score|review_count/,
  "客户编辑更新及返回字段不能包含 customers 表不存在的商城字段");
assert.match(detailSource, /CustomerForm customer=\{customer\} destination=\{publicReadOnly\?"PUBLIC_POOL":"PRIVATE"\} editBasicOnly onDirtyChange=\{setEditingDirty\} onChangeStage=\{data\.can_change_stage\?[\s\S]*setStageOpen\(true\)/, "编辑窗口应区分公海与私有客户，阶段选择必须进入留痕流程");
assert.match(detailSource, /CustomerEditWorkflowSummary customer=\{customer\}[\s\S]*onFollowup=\{\(\)=>exitEditing\("followup"\)\}/, "编辑窗口进入跟进留痕前也须检查未保存修改");
assert.match(detailSource, /客户名称[\s\S]*国家\/地区[\s\S]*公司名称[\s\S]*公司税号[\s\S]*客户等级/, "客户详情前五项应与编辑表单顺序一致");
assert.match(detailSource, /displayAddressList\(customer\.shipping_addresses, customer\.shipping_address\)/, "详情须读取完整收货地址列表并兼容旧字段");
assert.match(detailSource, /displayAddressList\(customer\.forwarder_addresses, customer\.forwarder_address\)/, "详情须读取完整货代地址列表并兼容旧字段");
assert.match(detailSource, /客户收货地址\$\{index \+ 1\}[\s\S]*货代地址\$\{index \+ 1\}/, "两种地址须逐行编号回显");
assert.match(addressMigration, /new\.shipping_address := nullif\(btrim\(new\.shipping_addresses\[1\]\)/, "数据库须同步首条收货地址供PI默认使用");
assert.match(addressMigration, /new\.forwarder_address := nullif\(btrim\(new\.forwarder_addresses\[1\]\)/, "数据库须同步首条货代地址至旧字段");
assert.match(addressMigration, /grant select \(shipping_addresses, forwarder_addresses\)/, "新地址字段须有显式列授权");
assert.match(detailSource, /\{\["FOLLOWING","DEAL"\]\.includes\(stageForm\.status\)\?<div><label[\s\S]*上传真实凭证（必传）/, "意向及成交阶段才应展示必传凭证入口");
assert.match(listSource, /\.xlsx · 含字段说明和示例数据/, "客户列表的下载模板格式应与实际 xlsx 文件一致");
for (const field of ["manual_grade", "wechat", "tax_number", "tally_requirements", "forwarder_address", "other_address", "shipping_address"]) {
  assert.match(profileGrants, new RegExp(`\\b${field}\\b`), `客户资料新字段 ${field} 应有显式列授权`);
}
assert.doesNotMatch(profileGrants, /grant\s+select\s+on\s+(?:table\s+)?public\.customers/i, "不得为修复客户列表而授予整表读取权限");
assert.match(profileGrants, /company_scale_evidence.*SELECT/, "权限迁移须验证敏感 AI 证据列仍不可读取");
assert.deepEqual(CUSTOMER_LIST_DEFAULT_COLUMNS.slice(0, 3), ["contact_name", "company_name", "country"], "我的客户应先显示对接人，再显示公司和国家");
const previousDefault = CUSTOMER_LIST_DEFAULT_COLUMNS.filter((key) => key !== "contact_name");
assert.deepEqual(normalizeCustomerListColumns(migrateMyCustomerDefaultColumns(previousDefault)).slice(0, 3), ["contact_name", "company_name", "country"], "旧版默认列顺序应自动升级");
assert.deepEqual(migrateMyCustomerDefaultColumns(["company_name", "phone", "country"]), ["contact_name", "company_name", "phone", "country"], "旧账号应补全客户名称，同时保留其他字段的顺序");
assert.deepEqual(migrateMyCustomerDefaultColumns(["company_name", "contact_name", "phone"]), ["contact_name", "company_name", "phone"], "客户名称已有设置时应移动到最前且不重复");
assert.match(followupApiSource, /customer_followup_queue[\s\S]*\.select\("[^"]*company_name,contact_name,country/, "跟进待办接口应读取已有的对接人字段");
assert.match(followupApiSource, /customer_followup_history[\s\S]*\.select\("[^"]*company_name,contact_name,country/, "历史跟进接口也应读取对接人字段");
assert.match(followupViewSource, /客户名称 \/ 公司名称/, "跟进列表应明确显示对接人与企业主体");
assert.match(followupViewSource, /item\.customer\?\.contact_name\|\|"—"[\s\S]*item\.customer\?\.company_name\|\|"—"/, "跟进列表应按对接人在前、公司在后的顺序显示，空值不冒用公司名");
assert.match(dashboardApiSource, /customer_followup_queue[\s\S]*\.select\("[^"]*company_name,contact_name,phone/, "工作台待跟进数据应读取对接人字段");
assert.match(dashboardViewSource, /客户名称 \/ 公司名称[\s\S]*item\.customer_name \|\| "—"[\s\S]*item\.company_name \|\| "—"/, "工作台待跟进应对接人在前、公司在后");
assert.match(poolSource, /tab === "claimed" && !row\.contact_masked && row\.contact_name/, "公海已认领记录仅在未隐藏联系人时展示对接人");
console.log("手动新增与编辑客户表单回显、必填和工作流边界回归测试通过。");
