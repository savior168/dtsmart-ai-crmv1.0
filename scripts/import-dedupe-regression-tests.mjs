import assert from "node:assert/strict";
import {
  customerIndexIdentityKeys,
  customerLookupIdentityKeys,
  normalizeGoogleIdentity,
  normalizeIdentityPhone,
  normalizeIdentityUrl,
  classifyExistingCustomer,
} from "../lib/import-dedupe.ts";

const sparseGoogle = { company_name: "iDestiny", google_url: "https://www.google.com/maps/place/iDestiny/?entry=ttu" };
assert.deepEqual(customerLookupIdentityKeys(sparseGoogle), ["google:idestiny|google.com/maps/place/idestiny"]);
assert.deepEqual(customerLookupIdentityKeys(sparseGoogle), customerLookupIdentityKeys({ ...sparseGoogle }));

assert.equal(normalizeIdentityPhone("+48 (935) 854-13"), "4893585413");
assert.equal(normalizeIdentityPhone("0048 935 854 13"), "4893585413");
assert.equal(normalizeIdentityUrl("HTTPS://WWW.Example.com/index.html?utm_source=x"), "example.com/");
assert.equal(
  normalizeGoogleIdentity("https://www.google.com/maps/place/Test/data=!4m6!3m5!1s0x123:0xABC!8m2"),
  "place:0x123:0xabc",
);

const strongContactNameVariantA = { company_name: "Eur Mobile", phone: "+48 123 456 789", email: "sales@example.com" };
const strongContactNameVariantB = { company_name: "Euro Mobile", phone: "0048 123456789", email: "SALES@example.com" };
assert.ok(customerLookupIdentityKeys(strongContactNameVariantA).some((key) => customerIndexIdentityKeys(strongContactNameVariantB).includes(key)), "电话或邮箱相同即为全局确认重复，不得依赖客户名称");

const whatsappVariant = { company_name: "Mobile Example", whatsapp: "+48 123 456 789" };
assert.ok(customerLookupIdentityKeys(whatsappVariant).includes("phone:48123456789"), "whatsapp必须纳入全局强身份去重");

const rich = { company_name: "Same Shop", phone: "+48 123 456 789", website: "https://same.example/" };
const sparse = { company_name: "Same Shop", website: "https://www.same.example/?utm_source=x" };
assert.ok(customerIndexIdentityKeys(rich).some((key) => customerLookupIdentityKeys(sparse).includes(key)));

const branchA = { company_name: "Shared Brand", phone: "+48 111 111 111", website: "https://brand.example" };
const branchB = { company_name: "Shared Brand", phone: "+48 222 222 222", website: "https://brand.example" };
assert.equal(customerLookupIdentityKeys(branchA).some((key) => customerLookupIdentityKeys(branchB).includes(key)), false);

assert.equal(classifyExistingCustomer({ owner_id: "u1", acquisition_scope: "PRIVATE", pool_status: "CLAIMED", status: "CLAIMED" }, "u1"), "OWN_CUSTOMER");
assert.equal(classifyExistingCustomer({ owner_id: null, acquisition_scope: "PUBLIC_POOL", pool_status: "AVAILABLE", status: "UNCLAIMED" }, "u1"), "PUBLIC_POOL_AVAILABLE");
assert.equal(classifyExistingCustomer({ owner_id: "u2", acquisition_scope: "PUBLIC_POOL", pool_status: "CLAIMED", status: "CLAIMED" }, "u1"), "OTHER_OWNED_CUSTOMER");
assert.equal(classifyExistingCustomer({ owner_id: null, acquisition_scope: "PRIVATE", pool_status: "PENDING_ALLOCATION", status: "UNCLAIMED" }, "u1"), "UNOWNED_REVIEW_REQUIRED");

console.log("import dedupe regression tests: ok");
