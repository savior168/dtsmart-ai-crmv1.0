import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") }, jsx: { runtime: "automatic" } });
const { CustomerContactSummary } = await jiti.import(resolve("components/customer-contact-summary.tsx"));
const { formatPhoneInternational } = await jiti.import(resolve("lib/contacts/phone-normalization.ts"));
const render = (customer, display = "phone", source = "all") => renderToStaticMarkup(createElement(CustomerContactSummary, { customer: { country: "GB", ...customer }, source, display }));
const visibleText = (html) => html.replace(/<[^>]*>/g, "");
const phone = (value, type = "PHONE", status = "NEW_VERIFIED", channel = "website") => ({ type, value_raw: value, verification_status: status, source_channel: channel, exact_source_url: "https://example.com/contact" });
const first = "+447428236591", second = "+441142768352", third = "+441915634827";

const several = render({ verified_contacts: [phone(second), phone(first, "WHATSAPP"), phone(third)] });
assert.ok(visibleText(several).includes(formatPhoneInternational(first, "GB")), "首个号码必须完整呈现，并保留已核验WhatsApp优先排序");
assert.ok(!visibleText(several).includes(formatPhoneInternational(second, "GB")), "摘要不再同时挤入第二号码");
assert.ok(!visibleText(several).includes(formatPhoneInternational(third, "GB")), "其余号码留在展开内容");
assert.ok(visibleText(several).includes("另2项"));
assert.match(several, /aria-expanded="false"/);
assert.doesNotMatch(several, /truncate/, "电话摘要不能通过省略号隐藏号码");
assert.match(several, /flex-wrap/, "空间不足时允许展开入口换行");
assert.match(several, /href="https:\/\/wa\.me\/447428236591"/);
assert.match(several, /aria-label="复制官网核验WhatsApp"/);

const sameNumberChannels = render({ verified_contacts: [phone(first), phone(first, "WHATSAPP")] });
assert.ok(visibleText(sameNumberChannels).includes("另1项"), "同号电话与WhatsApp仍按既有规则保留两个联系渠道");
const single = render({ verified_contacts: [phone(first)] });
assert.match(single, /href="https:\/\/example\.com\/contact"/, "单条电话号码仍可打开原有精确来源");
assert.ok(visibleText(single).includes(formatPhoneInternational(first, "GB")));
const singleWhatsapp = render({ verified_contacts: [phone(first, "WHATSAPP")] });
assert.match(singleWhatsapp, /href="https:\/\/wa\.me\/447428236591"/);
assert.match(singleWhatsapp, /href="https:\/\/example\.com\/contact"/, "单条WhatsApp保留对话和来源两个原有入口");

const conflicting = render({ verified_contacts: [phone(first, "WHATSAPP", "CONFLICTING_VERIFIED"), phone(second, "WHATSAPP", "CONFLICTING_VERIFIED")] });
assert.doesNotMatch(conflicting, /https:\/\/wa\.me\//, "冲突WhatsApp摘要不得直接发起联系");
assert.match(conflicting, /来源存在冲突，待人工核对/, "冲突提示不能在摘要中丢失");
const mixed = render({ verified_contacts: [phone(first), phone(second), { type: "EMAIL", value_raw: "sales@example.com", verification_status: "NEW_VERIFIED", source_channel: "website" }] }, "all");
assert.ok(visibleText(mixed).includes(formatPhoneInternational(first, "GB")));
assert.ok(!visibleText(mixed).includes(formatPhoneInternational(second, "GB")), "混合摘要也只能显示一个电话");
assert.ok(visibleText(mixed).includes("sales@example.com"), "混合摘要仍保留邮箱");
const emails = render({ email: "first@example.com", website_email: "second@example.com" }, "email");
assert.match(emails, /truncate/, "邮箱保留原有紧凑显示方式");
assert.ok(visibleText(emails).includes("展开"));
assert.ok(visibleText(render({})).includes("—"));
console.log("电话摘要完整号码、渠道保留、证据入口及冲突保护渲染测试通过。");
