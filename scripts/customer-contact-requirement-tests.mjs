import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customerStageContactError, hasCustomerContactMethod } from "../lib/customer-contact-requirement.ts";

const form = readFileSync(new URL("../components/customer-form.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/customers/route.ts", import.meta.url), "utf8");

const channels = ["phone", "email", "wechat", "whatsapp"];
for (const channel of channels) {
  assert.equal(hasCustomerContactMethod({ [channel]: " contact " }), true, `${channel} 单独填写即可通过`);
  assert.equal(customerStageContactError("FOLLOWING", { [channel]: " contact " }), null, `${channel} 单独填写即可认领意向客户`);
  assert.equal(customerStageContactError("DEAL", { [channel]: " contact " }), null, `${channel} 单独填写即可认领成交客户`);
}
assert.equal(customerStageContactError("FOLLOWING", { has_customer_contact_method: true }), null, "customer_contacts 中保存的任一渠道也应被认可");
assert.match(customerStageContactError("FOLLOWING", {}), /电话、邮箱、微信或 WhatsApp 其中一项/);
assert.match(customerStageContactError("DEAL", { phone: " ", email_addresses: ["", "  "] }), /至少填写/);
assert.equal(customerStageContactError("CLAIMED", {}), null, "潜在客户认领不要求联系方式");
assert.match(form, /\["FOLLOWING", "DEAL"\]\.includes\(stage\) && !stageFile/, "手动新增意向和成交客户都必须上传凭证");
assert.match(form, /\["FOLLOWING", "DEAL"\]\.includes\(form\.status\)[\s\S]*阶段佐证凭证/, "意向和成交阶段都应显示凭证上传入口");
assert.match(form, /status:"CLAIMED",requested_stage:stage/, "新客户须先以潜在客户安全落库，再通过凭证工作流升级");
assert.match(form, /evidence\.set\("status", stage\)/, "手动新增后凭证工作流必须使用所选目标阶段");
assert.match(api, /requestedStage !== "CLAIMED"[\s\S]*requestedStage === "DEAL" \? "成交客户必须先创建潜在客户/, "API 必须拒绝绕过凭证直接创建成交客户");
assert.match(api, /requestedStage === "CLAIMED" && \["FOLLOWING", "DEAL"\]\.includes\(intendedStage\)/, "API 仅允许有凭证工作流的目标阶段从潜在客户升级");
assert.match(api, /return NextResponse\.json\(\{ \.\.\.data, created: true \}/, "新增结果应明确标记为新建，避免重复客户被错误阶段升级");
console.log("customer contact requirement tests passed");
