import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") }, jsx: { runtime: "automatic" } });
const { manualContactValues, manualContactColumns, normalizeManualContacts, splitManualContacts } = await jiti.import(resolve("lib/contacts/manual-contact-list.ts"));
const { CustomerForm } = await jiti.import(resolve("components/customer-form.tsx"));
const { CustomerContactSummary } = await jiti.import(resolve("components/customer-contact-summary.tsx"));
const read = (file) => readFileSync(resolve(file), "utf8");

assert.equal(normalizeManualContacts(["+49 699 043 1261", "+49 699 043 1262"], "phone"), "+49 699 043 1261; +49 699 043 1262");
assert.equal(normalizeManualContacts(["A@Example.com", "a@example.com", "B@example.com"], "email"), "A@Example.com; B@example.com");
assert.equal(normalizeManualContacts(["wechat-one", "wechat-two"], "wechat"), "wechat-one; wechat-two");
assert.equal(normalizeManualContacts(["+49 699 043 1261", "+49 699 043 1262"], "whatsapp"), "+49 699 043 1261; +49 699 043 1262");
assert.deepEqual(splitManualContacts("a@example.com; b@example.com"), ["a@example.com", "b@example.com"]);
assert.deepEqual(manualContactValues("a@example.com", ["a@example.com", "b@example.com"]), ["a@example.com", "b@example.com"]);
assert.deepEqual(manualContactColumns({ phone: "+49 699 043 1261; +49 699 043 1262" }).phone_numbers, ["+49 699 043 1261", "+49 699 043 1262"]);
assert.equal(normalizeManualContacts("a@example.com；b@example.com", "email"), "a@example.com; b@example.com");
assert.equal(normalizeManualContacts("+49 699 043 1261;+49 699 043 1262", "phone"), "+49 699 043 1261; +49 699 043 1262");
assert.equal(normalizeManualContacts("wechat-one;wechat-two", "wechat"), "wechat-one; wechat-two");
assert.equal(normalizeManualContacts("+49 699 043 1263;+49 699 043 1264", "whatsapp"), "+49 699 043 1263; +49 699 043 1264");
assert.throws(() => normalizeManualContacts(["valid@example.com", "bad-email"], "email"), /邮箱格式/);
assert.throws(() => normalizeManualContacts(["+49 699 043 1261", "bad-number"], "phone"), /联系电话格式/);

const customer = {
  id: "test", company_name: "Demo", contact_name: "Contact", country: "德国", status: "CLAIMED",
  phone: "+49 699 043 1261; +49 699 043 1262",
  email: "a@example.com; b@example.com",
  whatsapp: "+49 699 043 1263; +49 699 043 1264",
  wechat: "wechat-one; wechat-two",
};
for (const destination of ["PRIVATE", "PUBLIC_POOL"]) {
  const markup = renderToStaticMarkup(createElement(CustomerForm, { customer, destination, editBasicOnly: true, onDone() {}, onCancel() {} }));
  for (const [label, values] of [["联系电话", splitManualContacts(customer.phone)], ["邮箱", splitManualContacts(customer.email)], ["WhatsApp号码", splitManualContacts(customer.whatsapp)], ["微信号码", splitManualContacts(customer.wechat)]]) {
    for (const [index, value] of values.entries()) {
      assert.ok(markup.includes(`aria-label="${label}${index + 1}"`), `${destination} ${label}${index + 1} editable`);
      assert.ok(markup.includes(value), `${destination} ${label}${index + 1} echoed`);
    }
    assert.ok(markup.includes(`aria-label="添加${label}2"`));
    assert.ok(markup.includes(`aria-label="删除${label}1"`));
  }
}
const structuredOnly = { ...customer, phone: "", email: "", whatsapp: "", wechat: "", phone_numbers: ["+49 699 043 1261"], email_addresses: ["a@example.com"], whatsapp_numbers: ["+49 699 043 1263"], wechat_numbers: ["wechat-one"] };
const structuredMarkup = renderToStaticMarkup(createElement(CustomerForm, { customer: structuredOnly, destination: "PRIVATE", editBasicOnly: true, onDone() {}, onCancel() {} }));
for (const value of ["+49 699 043 1261", "a@example.com", "+49 699 043 1263", "wechat-one"]) assert.ok(structuredMarkup.includes(value), `legacy JSONB contact echoed: ${value}`);
const detail = renderToStaticMarkup(createElement(CustomerContactSummary, { customer, source: "original" }));
for (const value of [...splitManualContacts(customer.phone), ...splitManualContacts(customer.email), ...splitManualContacts(customer.whatsapp)]) {
  assert.ok(detail.includes(value), `customer detail shows ${value}`);
}
const structuredDetail = renderToStaticMarkup(createElement(CustomerContactSummary, { customer: structuredOnly, source: "original" }));
for (const value of ["+49 699 043 1261", "a@example.com", "+49 699 043 1263", "wechat-one"]) assert.ok(structuredDetail.includes(value), `structured contact detail shows ${value}`);

const claimApi = read("app/api/customers/public-pool/claim/route.ts");
const claimView = read("components/customer-public-pool-view.tsx");
assert.match(claimApi, /customerStageContactError\(stage, customer\.data\)/, "intention or deal claim requires one of four contacts");
assert.match(claimApi, /先认领为潜在客户/, "missing contacts should guide a potential-stage claim");
assert.doesNotMatch(claimView, /customerHasClaimContacts/, "claim UI must not block missing contacts");
assert.match(claimApi, /requirePermission\("customers\.claim"\)/);
assert.match(claimApi, /ai_score < 60/);
assert.match(claimApi, /stage !== "CLAIMED" && !\(fileValue instanceof File\)/, "intent/deal still require evidence");

const createApi = read("app/api/customers/route.ts");
const editApi = read("app/api/customers/[id]/route.ts");
for (const api of [createApi, editApi]) assert.match(api, /normalizeManualContacts/, "both create and edit normalize every manual contact");
const importApi = read("app/api/import/route.ts");
for (const api of [createApi, editApi, importApi]) assert.match(api, /manualContactColumns/, "all manual writes preserve structured contact columns");
const importView = read("components/import-view.tsx");
for (const source of [importApi, importView]) {
  assert.match(source, /for \(const kind of \["phone", "email", "wechat", "whatsapp"\] as const\)/, "import must process all four contact columns");
  assert.match(source, /normalizeManualContacts\(item\[kind\], kind\)/, "import must split, validate and preserve each contact");
}
const migration = read("supabase/migrations/20261030170000_customer_manual_multi_contact_identity.sql");
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /lock_keys && public\.customer_manual_identity_keys/, "each saved value must be checked for global duplicates");
console.log("customer manual contacts tests passed");
