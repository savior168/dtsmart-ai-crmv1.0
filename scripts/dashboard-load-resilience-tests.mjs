import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../app/api/dashboard/stats/route.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../components/crm-dashboard.tsx", import.meta.url), "utf8");

assert.match(api, /function isTransientError\(/, "API must identify transient upstream/database failures");
assert.match(api, /status === 503 \? "工作台数据暂时繁忙，请稍后重试"/, "transient failures must be reported as retryable, not client errors");
assert.match(api, /Retry-After/ , "transient failures should expose a short retry hint");
assert.match(api, /supplementary stock activity temporarily unavailable/, "supplementary stock feed must degrade without failing core dashboard data");
assert.match(api, /activity_warning: activityWarning/, "a failed supplementary feed must be made visible rather than reported as an empty feed");
assert.match(view, /data\.activity_warning \|\| "暂无最近动态"/, "the activity panel must distinguish a temporary feed failure from no activity");
assert.match(view, /async function fetchDashboard\([\s\S]*attempt < 3/, "dashboard fetch should use bounded retries");
assert.match(view, /response\.status === 429 \|\| response\.status === 503/, "only retry throttling and temporary server errors");
assert.match(view, /signal\.aborted/, "stale filter requests must still be abortable");
assert.match(view, /当前保留上次成功加载的数据/, "refresh failures must not replace already loaded dashboard data");
assert.match(view, /工作台返回数据格式异常/, "malformed success responses must be reported clearly");

console.log("dashboard load resilience checks passed");
