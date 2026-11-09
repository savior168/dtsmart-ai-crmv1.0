import assert from "node:assert/strict";
import { listVerifiedVercelProductionDeployments } from "../lib/notifications/vercel-deployments.ts";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const rows = [
  { id: "new", sha: shaA, readyState: "READY", target: "production", created: Date.parse("2026-11-07T03:00:00Z"), url: "dtsmart-current.vercel.app", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaA } },
  { id: "old", readyState: "READY", target: "production", created: Date.parse("2026-11-07T02:00:00Z"), url: "https://dtsmart-old.vercel.app", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaA } },
  { id: "preview", readyState: "READY", target: "preview", created: Date.parse("2026-11-07T04:00:00Z"), url: "https://dtsmart-preview.vercel.app", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaB } },
  { id: "wrong-repo", readyState: "READY", target: "production", created: Date.parse("2026-11-07T04:00:00Z"), url: "https://other.vercel.app", meta: { githubOrg: "someone-else", githubRepo: "other", githubCommitSha: shaB } },
  { id: "invalid-url", readyState: "READY", target: "production", created: Date.parse("2026-11-07T04:00:00Z"), url: "https://example.com", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaB } },
  { id: "not-ready", readyState: "BUILDING", target: "production", created: Date.parse("2026-11-07T04:00:00Z"), url: "https://dtsmart-building.vercel.app", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaB } },
  { id: "outside", readyState: "READY", target: "production", created: Date.parse("2026-11-06T15:59:59Z"), url: "https://dtsmart-before.vercel.app", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaB } },
];
const requested = [];
const fetcher = async (input, init) => {
  requested.push({ url: new URL(String(input)), init });
  if (requested.length === 1) return Response.json({ deployments: rows.slice(0, 4), pagination: { count: 7, next: "1794020400000" } });
  return Response.json({ deployments: [
    { ...rows[0], id: undefined, uid: "new" },
    { id: "second-page", sha: shaB, readyState: "READY", target: "production", created: Date.parse("2026-11-07T05:00:00Z"), url: "https://dtsmart-next.vercel.app", meta: { githubOrg: "savior168", githubRepo: "dtsmart-ai-crmv1.0", githubCommitSha: shaB } },
    ...rows.slice(4),
  ], pagination: { count: 4, next: null } });
};

const config = { repository: "savior168/dtsmart-ai-crmv1.0", from: "2026-11-07", to: "2026-11-07", token: "test-vercel-read-token", projectId: "prj_test", teamId: "team_test", fetcher };
const result = await listVerifiedVercelProductionDeployments(config);
assert.deepEqual(result, [
  { sha: shaB, deploymentUrl: "https://dtsmart-next.vercel.app/", deployedAt: "2026-11-07T05:00:00.000Z" },
  { sha: shaA, deploymentUrl: "https://dtsmart-current.vercel.app/", deployedAt: "2026-11-07T03:00:00.000Z" },
], "all pages are merged, duplicate deployments deduplicated, and only latest matching production READY deployment per commit is retained");
assert.equal(requested.length, 2);
assert.equal(requested[0].url.pathname, "/v7/deployments");
assert.equal(requested[0].url.searchParams.get("target"), "production");
assert.equal(requested[0].url.searchParams.get("state"), "READY");
assert.equal(requested[0].url.searchParams.get("projectId"), "prj_test");
assert.equal(requested[0].url.searchParams.get("teamId"), "team_test");
assert.equal(requested[0].url.searchParams.get("since"), String(new Date("2026-11-07T00:00:00+08:00").getTime()));
assert.equal(requested[1].url.searchParams.get("from"), "1794020400000", "Vercel next cursor is sent as from for subsequent pages");
assert.equal(requested[0].init.headers.Authorization, "Bearer test-vercel-read-token");
assert.equal(requested[0].init.cache, "no-store");

await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, repository: "bad" }), /owner\/repo/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, token: undefined }), /缺少服务端 VERCEL_TOKEN/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, from: "2026-11-08", to: "2026-11-07" }), /发布日期范围无效/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, fetcher: async () => new Response("Forbidden", { status: 403 }) }), /Vercel 部署记录读取权限不足/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, fetcher: async () => Response.json({ deployments: rows, pagination: { next: "not-a-cursor" } }) }), /分页游标无效/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, fetcher: async () => Response.json({ deployments: rows, pagination: { next: "1794020400000" } }) }), /分页游标无效/);
let page = 0;
await assert.rejects(() => listVerifiedVercelProductionDeployments({ ...config, fetcher: async () => {
  page += 1;
  return Response.json({ deployments: [], pagination: { next: String(1794020400000 + page) } });
} }), /超过安全分页上限/);
console.log("Vercel Production READY deployment verification tests passed");
