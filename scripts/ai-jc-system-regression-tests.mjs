import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { evidenceDomain } = await jiti.import(resolve("lib/ai/web-enrichment.ts"));
const { hasUsableCollectedEvidence, recoveryRecordMatchesEntity } = await jiti.import(resolve("lib/ai/run-customer-analysis.ts"));

for (const value of [undefined, null, "", "   "]) assert.equal(evidenceDomain(value), "");
assert.equal(evidenceDomain("https://www.example.org/contact"), "example.org");
const map = { channel: "google_maps", status: "COLLECTED", evidence: {
  name: "JC System", identity_status: "MATCHED", identity_confidence: 100,
  types: ["Services", "service", "point_of_interest", "establishment"], reviews: [],
} };
assert.equal(hasUsableCollectedEvidence([map]), false, "Matching identity and generic types must still trigger source recovery");
assert.equal(hasUsableCollectedEvidence([{ ...map, evidence: { ...map.evidence, description: "Laptop screen replacement" } }]), true);
assert.equal(hasUsableCollectedEvidence([{ ...map, evidence: { ...map.evidence, reviews: ["Replaced my laptop battery"] } }]), true);
const customer = { company_name: "JC System", country: "IE", phone: "353876464810", address: "Summerhill Lane Portlaoise R32 RX5K Ireland" };
const social = { channel: "facebook", status: "COLLECTED", source_url: "https://www.facebook.com/example", evidence: {
  url: "https://www.facebook.com/example", reachable: true, title: "JC System", headings: [], phones: [],
  text_excerpt: "Computer repair services", emails: [],
} };
assert.equal(recoveryRecordMatchesEntity(customer, [], social), false, "Same name alone must not admit another company's profile");
assert.equal(recoveryRecordMatchesEntity(customer, [], { ...social, evidence: { ...social.evidence, phones: ["+353 87 646 4810"] } }), true);
assert.equal(recoveryRecordMatchesEntity(customer, [], { ...social, evidence: { ...social.evidence, text_excerpt: "JC System Summerhill Lane Portlaoise R32 RX5K Ireland" } }), true);
assert.equal(recoveryRecordMatchesEntity(customer, [], { ...social, evidence: { ...social.evidence, text_excerpt: "JC System Summerhill Lane Portlaoise R32 ABCD Ireland" } }), false);
console.log("JC System source recovery, missing-domain and social identity regressions passed.");
