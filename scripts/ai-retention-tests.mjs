import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/ai/retention.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/cron/ai-retention/route.ts", import.meta.url), "utf8");
const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
assert.ok(config.crons.some((cron) => cron.path === "/api/cron/ai-retention"), "AI 清理须由平台定时触发");
assert.match(route, /!secret \|\| request\.headers\.get\("authorization"\) !== `Bearer \$\{secret\}`/, "清理入口必须要求 CRON_SECRET");
assert.doesNotMatch(source, /\.from\("(?:customers|ai_screening_results|api_cost_ledger)"\)\s*\.delete\(/, "清理不得触及客户、筛选结果或费用账本");

const calls = [];
const admin = { from(table) {
  const state = { table, op: "select", filters: [], limit: null, payload: null };
  calls.push(state);
  const builder = {
    select() { return builder; },
    delete() { state.op = "delete"; return builder; },
    update(payload) { state.op = "update"; state.payload = payload; return builder; },
    lt(column, value) { state.filters.push(["lt", column, value]); return builder; },
    eq(column, value) { state.filters.push(["eq", column, value]); return builder; },
    neq(column, value) { state.filters.push(["neq", column, value]); return builder; },
    in(column, value) { state.filters.push(["in", column, value]); return builder; },
    order() { return builder; },
    limit(value) { state.limit = value; return builder; },
    then(resolve) {
      const data = table === "ai_analysis_reuse_cache"
        ? [{ id: "expired-cache" }]
        : [{ task_id: "completed-task", country: "DE", query_text: "repair in Berlin" }];
      return Promise.resolve(resolve({ data, error: null }));
    },
  };
  return builder;
} };
const module = { exports: {} };
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("require", "module", "exports", code)((id) => id === "@/lib/supabase/admin" ? { createAdminClient: () => admin } : null, module, module.exports);
const result = await module.exports.cleanExpiredAiData(new Date("2026-11-16T12:00:00Z"));
assert.deepEqual(result, { deletedCacheRows: 1, clearedCheckpoints: 1 });
assert.equal(calls[0].limit, 400);
assert.ok(calls[0].filters.some(([op, column]) => op === "lt" && column === "expires_at"));
assert.equal(calls[1].op, "delete");
assert.ok(calls[1].filters.some(([op, column]) => op === "in" && column === "id"));
assert.equal(calls[2].limit, 100);
assert.ok(calls[2].filters.some(([op, column, value]) => op === "eq" && column === "task.status" && value === "COMPLETED"));
assert.ok(calls[2].filters.some(([op, column]) => op === "lt" && column === "task.finished_at"));
assert.equal(calls[3].op, "update");
assert.deepEqual(calls[3].payload, { results: [], next_page_token: null });
assert.ok(calls[3].filters.some(([op, column, value]) => op === "eq" && column === "task_id" && value === "completed-task"));
console.log("AI retention bounded cleanup tests passed");
