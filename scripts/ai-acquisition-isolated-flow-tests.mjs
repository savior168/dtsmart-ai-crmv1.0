import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { evaluateAcquisitionGate } from "../lib/ai-acquisition/quality-gate.ts";
import { remainingAcquisitionTaskLimit } from "../lib/ai-acquisition/cost-budget.ts";

// Hermetic acceptance fixture: no Supabase client, Google request, task row, or customer row.
const geography = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-geography.json", import.meta.url), "utf8"));
const defaultAreas = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-default-areas.json", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../lib/ai-acquisition/geography.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", code)((id) => {
  if (id.endsWith("ai-acquisition-geography.json")) return geography;
  if (id.endsWith("ai-acquisition-default-areas.json")) return defaultAreas;
  if (id === "./config") return { ACQUISITION_COUNTRY_SEARCH_AREAS: {} };
  throw new Error(`Unexpected fixture dependency: ${id}`);
}, module, module.exports);
const { normalizeGeographyScopes, planGeographyQueries, placeMatchesGeography } = module.exports;

const selected = normalizeGeographyScopes({ DE: [{ regionCode: "16", city: "Berlin" }] }, ["DE"]);
const queries = planGeographyQueries("DE", "Germany", ["phone repair"], selected.DE);
assert.deepEqual(queries, ["phone repair in Berlin, State of Berlin, Germany"], "a scoped task must search only the selected city");
assert.equal(queries.some((query) => query === "phone repair in Germany"), false, "city scope must not silently add a nationwide paid request");
const berlin = [{ types: ["country"], shortText: "DE" }, { types: ["administrative_area_level_1"], longText: "Berlin" }, { types: ["locality"], longText: "Berlin" }];
const outside = [{ types: ["country"], shortText: "DE" }, { types: ["administrative_area_level_1"], longText: "Brandenburg" }, { types: ["locality"], longText: "Berlin" }];
assert.equal(placeMatchesGeography("DE", selected.DE, berlin), true, "a real Berlin address must survive the state alias check");
assert.equal(placeMatchesGeography("DE", selected.DE, outside), false, "a same-name city outside the chosen state must not pass");
assert.deepEqual(normalizeGeographyScopes({}, ["DE"]), {}, "historical tasks must retain the nationwide default");
assert.ok(planGeographyQueries("DE", "Germany", ["phone repair"], []).includes("phone repair in Germany"), "unrestricted search must preserve the baseline query");

assert.equal(remainingAcquisitionTaskLimit(0.01, 0.003), 0.007, "discovery charges must reduce the child screening budget");
assert.equal(remainingAcquisitionTaskLimit(0.01, 0.02), 0, "an exhausted task must never gain a negative or renewed allowance");
const verified = { automationStatus: "AUTO_DEVELOP", targetDecision: "VALID", score: 80, identityStatus: "MATCHED", evidenceUrls: [{ source_url: "https://example.test/service", evidence_strength: "STRONG" }], contacts: [{ type: "EMAIL", value_normalized: "sales@example.test", verification_status: "NEW_VERIFIED", identity_match_status: "MATCHED", exact_source_url: "https://example.test/contact" }] };
assert.equal(evaluateAcquisitionGate(verified).accepted, true, "a verified target with traceable contact may pass the quality gate");
assert.equal(evaluateAcquisitionGate({ ...verified, contacts: [] }).accepted, false, "a target without traceable contact must not enter the customer pool");
console.log("AI acquisition isolated flow acceptance passed (no external calls or persistent test data)");
