import assert from "node:assert/strict";
import {
  customerIndexIdentityKeys,
  customerLookupIdentityKeys,
  normalizeGoogleIdentity,
  normalizeIdentityPhone,
  normalizeIdentityUrl,
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

const rich = { company_name: "Same Shop", phone: "+48 123 456 789", website: "https://same.example/" };
const sparse = { company_name: "Same Shop", website: "https://www.same.example/?utm_source=x" };
assert.ok(customerIndexIdentityKeys(rich).some((key) => customerLookupIdentityKeys(sparse).includes(key)));

const branchA = { company_name: "Shared Brand", phone: "+48 111 111 111", website: "https://brand.example" };
const branchB = { company_name: "Shared Brand", phone: "+48 222 222 222", website: "https://brand.example" };
assert.equal(customerLookupIdentityKeys(branchA).some((key) => customerLookupIdentityKeys(branchB).includes(key)), false);

console.log("import dedupe regression tests: ok");
