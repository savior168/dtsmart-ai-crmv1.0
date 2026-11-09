import assert from "node:assert/strict";
import { listVerifiedVercelProductionDeployments } from "../lib/notifications/github-deployments.ts";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const shaC = "c".repeat(40);
const deployments = [
  { id: 1, sha: shaA, environment: "Production", production_environment: true, created_at: "2026-11-07T02:00:00Z" },
  { id: 2, sha: shaA, environment: "Production", production_environment: true, created_at: "2026-11-07T03:00:00Z" },
  { id: 3, sha: shaB, environment: "Production", production_environment: true, created_at: "2026-11-07T04:00:00Z" },
  { id: 4, sha: shaC, environment: "Production", production_environment: true, created_at: "2026-11-07T05:00:00Z" },
  { id: 5, sha: "d".repeat(40), environment: "Preview", production_environment: false, created_at: "2026-11-07T06:00:00Z" },
  { id: 6, sha: "e".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-06T15:59:59Z" },
  { id: 7, sha: "f".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T16:00:00Z" },
];
const requested = [];
const statuses = {
  1: [{ state: "success", created_at: "2026-11-07T02:01:00Z", environment_url: "https://dtsmart-old.vercel.app" }],
  2: [{ state: "success", created_at: "2026-11-07T03:01:00Z", environment_url: "https://dtsmart-current.vercel.app" }],
  3: [{ state: "success", created_at: "2026-11-07T04:01:00Z", environment_url: "https://example.com/not-vercel" }],
  4: [
    { state: "success", created_at: "2026-11-07T05:01:00Z", environment_url: "https://dtsmart-failed.vercel.app" },
    { state: "failure", created_at: "2026-11-07T05:02:00Z", environment_url: "https://dtsmart-failed.vercel.app" },
  ],
  6: [{ state: "success", created_at: "2026-11-06T15:59:59Z", environment_url: "https://dtsmart-before.vercel.app" }],
  7: [{ state: "success", created_at: "2026-11-07T16:00:00Z", environment_url: "https://dtsmart-after.vercel.app" }],
};
const fetcher = async (input, init) => {
  const url = new URL(String(input));
  requested.push({ url, init });
  if (url.pathname.endsWith("/deployments")) return Response.json(deployments);
  const id = Number(url.pathname.match(/\/deployments\/(\d+)\/statuses$/)?.[1]);
  return Response.json(statuses[id] || []);
};

const result = await listVerifiedVercelProductionDeployments({
  repository: "savior168/dtsmart-ai-crmv1.0", from: "2026-11-07", to: "2026-11-07",
  token: "test-github-read-token", fetcher,
});
assert.deepEqual(result, [{ sha: shaA, deploymentUrl: "https://dtsmart-current.vercel.app", deployedAt: "2026-11-07T03:01:00Z" }], "only the latest successful Vercel production deployment per commit is retained");
assert.ok(requested.every(item => item.init.headers.Accept === "application/vnd.github+json"));
assert.ok(requested.every(item => item.init.headers.Authorization === "Bearer test-github-read-token"));
assert.equal(requested[0].url.searchParams.get("environment"), "Production");
assert.ok(requested.every(item => item.init.cache === "no-store"));

await assert.rejects(() => listVerifiedVercelProductionDeployments({ repository: "bad", from: "2026-11-07", to: "2026-11-07", fetcher }), /owner\/repo/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ repository: "savior168/dtsmart-ai-crmv1.0", from: "2026-11-07", to: "2026-11-07", fetcher: async () => new Response("Not Found", { status: 404 }) }), /返回 404.*私有仓库.*GITHUB_TOKEN/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({ repository: "savior168/dtsmart-ai-crmv1.0", from: "2026-11-08", to: "2026-11-07", fetcher }), /发布日期范围无效/);
console.log("GitHub-deployment backed Vercel production verification tests passed");
