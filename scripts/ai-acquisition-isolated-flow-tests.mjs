import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { evaluateAcquisitionGate } from "../lib/ai-acquisition/quality-gate.ts";
import { remainingAcquisitionTaskLimit } from "../lib/ai-acquisition/cost-budget.ts";

// Hermetic acceptance fixture: no Supabase client, Google request, task row, or customer row.
const geography = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-geography.json", import.meta.url), "utf8"));
const defaultAreas = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-default-areas.json", import.meta.url), "utf8"));
const zhNames = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-geography-zh.json", import.meta.url), "utf8"));
const localAliases = JSON.parse(fs.readFileSync(new URL("../data/ai-acquisition-geography-local-aliases.json", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../lib/ai-acquisition/geography.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", code)((id) => {
  if (id.endsWith("ai-acquisition-geography.json")) return geography;
  if (id.endsWith("ai-acquisition-geography-zh.json")) return zhNames;
  if (id.endsWith("ai-acquisition-geography-local-aliases.json")) return localAliases;
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
const bavaria = [{ types: ["country"], shortText: "DE" }, { types: ["administrative_area_level_1"], longText: "Bayern" }, { types: ["locality"], longText: "München" }];
assert.equal(placeMatchesGeography("DE", [{ regionCode: "02", city: "Munich" }], bavaria), true, "a localized German address must match its canonical region and city");
const multi = normalizeGeographyScopes({ DE: [{ regionCode: "16", city: "Berlin" }, { regionCode: "02", city: "Munich" }], US: [{ regionCode: "CA", city: "Los Angeles" }] }, ["DE", "US"]);
assert.equal(multi.DE.length, 2, "the API must retain multiple selected nodes in one country");
assert.equal(multi.US.length, 1, "the API must retain selections in another country");
assert.ok(planGeographyQueries("DE", "Germany", ["phone repair"], multi.DE).every((query) => !query.endsWith("in Germany")), "a multiselect task must never add a nationwide paid query");
assert.throws(() => normalizeGeographyScopes({ DE: [{ regionCode: "16", city: "Los Angeles" }] }, ["DE"]), /不匹配/, "a city from another region must be rejected by the API");
assert.deepEqual(normalizeGeographyScopes({}, ["DE"]), {}, "historical tasks must retain the nationwide default");
assert.ok(planGeographyQueries("DE", "Germany", ["phone repair"], []).includes("phone repair in Germany"), "unrestricted search must preserve the baseline query");

assert.equal(remainingAcquisitionTaskLimit(0.01, 0.003), 0.007, "discovery charges must reduce the child screening budget");
assert.equal(remainingAcquisitionTaskLimit(0.01, 0.02), 0, "an exhausted task must never gain a negative or renewed allowance");
const verified = { automationStatus: "AUTO_DEVELOP", targetDecision: "VALID", score: 80, identityStatus: "MATCHED", evidenceUrls: [{ source_url: "https://example.test/service", evidence_strength: "STRONG" }], contacts: [{ type: "EMAIL", value_normalized: "sales@example.test", verification_status: "NEW_VERIFIED", identity_match_status: "MATCHED", exact_source_url: "https://example.test/contact" }] };
assert.equal(evaluateAcquisitionGate(verified).accepted, true, "a verified target with traceable contact may pass the quality gate");
assert.equal(evaluateAcquisitionGate({ ...verified, contacts: [] }).accepted, false, "a target without traceable contact must not enter the customer pool");

const routeSource = fs.readFileSync(new URL("../app/api/ai-acquisition/tasks/route.ts", import.meta.url), "utf8");
const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const routeModule = { exports: {} };
let insertedTask = null;
let dispatched = 0;
const taskRow = { id: "isolated-task", user_id: "isolated-user", task_number: "TEST-1", status: "QUEUED", discovered_count: 0 };
const admin = { from(table) {
  if (table === "audit_logs") return { insert: async () => ({ error: null }) };
  assert.equal(table, "ai_acquisition_tasks");
  return {
    select() { return { eq() { return { like() { return { maybeSingle: async () => ({ data: null, error: null }) }; } }; } }; },
    insert(value) { insertedTask = value; return { select() { return { single: async () => ({ data: taskRow, error: null }) }; } }; },
    update() { return { eq() { return this; }, select() { return this; }, single: async () => ({ data: taskRow, error: null }), then(resolve) { return Promise.resolve({ error: null }).then(resolve); } }; },
  };
} };
new Function("require", "module", "exports", routeCode)((id) => {
  if (id === "next/server") return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } };
  if (id === "workflow/api") return { start: async () => { dispatched += 1; return { runId: "isolated-run" }; } };
  if (id === "@/lib/auth/current-user") return { requirePermission: async () => ({ user: { id: "isolated-user" } }) };
  if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
  if (id === "@/lib/ai-acquisition/config") return { DEFAULT_ACQUISITION_DISCOVERY_CEILING: 100, MAX_ACQUISITION_INDUSTRIES: 40, MAX_ACQUISITION_KEYWORDS: 60, normalizeAcquisitionCountries: (items) => (Array.isArray(items) ? items.filter((item) => item === "DE") : []) };
  if (id === "@/lib/ai-acquisition/geography") return { normalizeGeographyScopes };
  if (id === "@/lib/ai/error-normalization") return { normalizeError: (error) => ({ error_message: error.message }) };
  if (id === "@/workflows/ai-acquisition") return { aiAcquisitionWorkflow: () => {} };
  if (id === "@/lib/ai/task-number") return { acquisitionTaskNumberPrefix: () => "TEST", createAcquisitionTaskNumber: () => "TEST-1" };
  if (["@/lib/ai-acquisition/task-center-summary", "@/lib/countries", "@/lib/auth/subordinate-scope"].includes(id)) return {};
  throw new Error(`Unexpected route dependency: ${id}`);
}, routeModule, routeModule.exports);
const taskInput = { name: "隔离验证", industries: ["手机维修店"], keywords: ["phone repair"], countries: ["DE"], geography_scopes: { DE: multi.DE }, cost_mode: "FREE_ONLY", request_key: "11111111-1111-4111-8111-111111111111" };
const created = await routeModule.exports.POST({ json: async () => taskInput });
assert.equal(created.status, 201, "valid scoped task should pass the real create-route validation");
assert.deepEqual(insertedTask.geography_scopes, { DE: multi.DE }, "the route must persist every selected region and city");
assert.equal(insertedTask.task_cost_limit_usd, 0, "free-only mode must persist a zero paid-call limit");
assert.equal(dispatched, 1, "a valid task must dispatch exactly once to the mocked workflow");
insertedTask = null;
const invalid = await routeModule.exports.POST({ json: async () => ({ ...taskInput, geography_scopes: { DE: [{ regionCode: "CA", city: "Berlin" }] } }) });
assert.equal(invalid.status, 400, "cross-country geography must be rejected by the real route");
assert.equal(insertedTask, null, "invalid geography must not insert a task");
assert.equal(dispatched, 1, "invalid geography must not dispatch a workflow");
console.log("AI acquisition isolated flow acceptance passed (no external calls or persistent test data)");
