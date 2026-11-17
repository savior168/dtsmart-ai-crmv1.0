import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/api/ai-acquisition/geography-probe/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
let authenticated = true;
let duplicate = false;
let fetches = 0;
const writes = [];
const admin = { from(table) {
  assert.equal(table, "api_cost_ledger", "probe must never write a customer or task table");
  return { insert: async (row) => {
    writes.push(row);
    return { error: duplicate && row.model_or_sku === "PROBE_RESERVATION" ? { code: "23505" } : null };
  } };
} };
new Function("require", "module", "exports", code)((id) => {
  if (id === "node:crypto") return { randomUUID: () => "probe-request-id" };
  if (id === "next/server") return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } };
  if (id === "@/lib/auth/current-user") return { requireAdmin: async () => {
    if (!authenticated) throw new Error("FORBIDDEN");
    return { user: { id: "00000000-0000-4000-8000-000000000001" } };
  } };
  if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
  if (id === "@/lib/api-cost-budget") return { reserveApiCostBudget: async () => ({ allowed: true, reservationId: "reservation" }), releaseApiCostBudget: async () => {} };
  if (id === "@/lib/ai-acquisition/geography") return { placeMatchesGeography: (_country, _scopes, components) => components?.some((part) => part.types?.includes("locality") && part.longText === "München") };
  throw new Error(`Unexpected dependency ${id}`);
}, module, module.exports);
const oldEnvironment = process.env.VERCEL_ENV;
const oldKey = process.env.GOOGLE_MAPS_API_KEY;
const oldFetch = globalThis.fetch;
try {
  process.env.GOOGLE_MAPS_API_KEY = "fixture-only";
  globalThis.fetch = async (_url, options) => {
    fetches += 1;
    assert.match(options.body, /Handyreparatur in Munich, Bavaria, Germany/);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ places: [
      { addressComponents: [{ types: ["country"], shortText: "DE" }, { types: ["locality"], longText: "München" }] },
      { addressComponents: [{ types: ["country"], shortText: "DE" }, { types: ["locality"], longText: "Berlin" }] },
    ] }) };
  };
  process.env.VERCEL_ENV = "production";
  assert.equal((await module.exports.POST()).status, 404);
  process.env.VERCEL_ENV = "preview";
  authenticated = false;
  assert.equal((await module.exports.POST()).status, 403);
  authenticated = true;
  duplicate = true;
  assert.equal((await module.exports.POST()).status, 409);
  assert.equal(fetches, 0, "denied and repeated requests must not reach Google");
  duplicate = false;
  const result = await module.exports.POST();
  assert.equal(result.status, 200);
  assert.equal(fetches, 1, "successful probe must issue exactly one request");
  assert.equal(result.body.in_selected_region_and_city, 1);
  assert.equal(result.body.out_of_scope_or_unverifiable, 1);
  assert.equal(writes.filter((row) => row.model_or_sku === "PLACES_TEXT_SEARCH_PRO").length, 1);
} finally {
  globalThis.fetch = oldFetch;
  if (oldEnvironment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldEnvironment;
  if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = oldKey;
}
console.log("One-shot geography probe isolation tests passed");
